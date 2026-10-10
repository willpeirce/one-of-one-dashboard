import { SpendWorker, type SpendWorkerOptions } from './ad-spend/worker.js';
import { readCampaignSync, readMetaCampaigns, spendFacts, spendHealth } from './ad-spend/store.js';
import { readEstimates } from './fulfilment/store.js';
import { dataset } from './shopify/metrics.js';
import { registerFulfilment, seedFulfilment } from './fulfilment/routes.js';
import { fulfilmentSummary, refreshFulfilment } from './fulfilment/store.js';
import { errorCode } from './diagnostics.js';
import { ImportError } from './fulfilment/parser.js';
import Fastify from 'fastify';
import { appConfig } from './config.js';
import { applyShopifyDashboard, readWatchdogContext } from './shopify/dashboard.js';
import { shopifyHero } from './shopify/metrics.js';
import { updateObservation, evaluateWatchdogs } from './shopify/watchdogs.js';
import { ShopifyWorker } from './shopify/worker.js';
import { registerShopifyWebhooks } from './shopify/webhooks.js';
import cookie from '@fastify/cookie';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Database } from './db.js';
import { Auth } from './auth.js';
import { getSourceStates, readSourceHealth, syncSourceHealth } from './sources.js';
import { loginPage, sourceHealthPage, auditPage } from './views.js';
import type { RuntimeConfig } from './runtime.js';
import { dashboardPage } from './dashboard-view.js';
import { getSampleDashboard } from './sample-dashboard.js';
import { HeroRangeError, validateHeroRange, ukToday } from './hero-range.js';
import { registerDashboardEvents } from './events.js';
import { readSettings, saveSettings, SettingsValidationError, SettingsConflictError } from './settings.js';
import { settingsPage } from './settings-view.js';

declare module 'fastify' {
  interface FastifyInstance { startBackgroundWork(): Promise<void> }
}

export async function createApp(db: Database, config: RuntimeConfig, sourceEnv: NodeJS.ProcessEnv = {}, shopifyOptions: ConstructorParameters<typeof ShopifyWorker>[3] = {}, adOptions:SpendWorkerOptions = {}) {
  // Request/error logging is deliberately off: authentication bodies contain private material.
  const app = Fastify({ logger: false, bodyLimit: 32_768, trustProxy: false, requestTimeout: 15_000 });
  await app.register(cookie);
  const auth = await Auth.create(db, config);
  await auth.cleanup();
  await syncSourceHealth(db, sourceEnv);
  const shopify = new ShopifyWorker(db, sourceEnv, config.origin, shopifyOptions);
  await shopify.initialize();
  if (shopify.mode === 'sample') await shopify.tick();
  const sourceNow = () => shopifyOptions.clock?.() ?? (shopify.mode === 'sample' ? new Date(appConfig.shopify.sampleNow) : new Date());
  async function runWatchdogs() {
    const facts = await shopify.store.facts();
    const [settings, health, context] = await Promise.all([readSettings(db), readSourceHealth(db), readWatchdogContext(db, facts)]);
    const now = sourceNow();
    const observation = await updateObservation(db, shopify.mode, facts, now);
    const checks = evaluateWatchdogs(facts, now, settings.values, observation, context.holidays, health);
    await db.query('UPDATE pulse.shopify_watchdog_state SET data = data || $2::jsonb WHERE mode = $1', [shopify.mode, JSON.stringify({ checks, evaluatedAt: now.toISOString() })]);
  }
  await seedFulfilment(db, shopify.mode, sourceNow());
  const ads=new SpendWorker(db,sourceEnv,adOptions);
  let observationRun: Promise<unknown> | undefined;
  let observationTimer: ReturnType<typeof setInterval> | undefined;
  let startupRun: Promise<void> | undefined;
  function observe(): Promise<unknown> {
    if (!observationRun) observationRun = runWatchdogs().catch(error => {
      console.error(`Watchdog observation failed (code: ${errorCode(error)}).`);
    }).finally(() => { observationRun = undefined; });
    return observationRun;
  }
  // Called by server.ts after listen resolves; repeated calls share the same run.
  function startBackgroundWork(): Promise<void> {
    if (startupRun) return startupRun;
    ads.start();
    observationTimer = setInterval(() => { void observe(); }, 60_000);
    observationTimer.unref();
    startupRun = (async () => {
      const parcelModes = await db.query<{mode:'sample'|'live'}>('SELECT DISTINCT mode FROM pulse.fulfilment_parcels');
      for (const {mode} of parcelModes.rows) {
        await refreshFulfilment(db, mode, sourceNow()).catch(error => {
          console.error(`Startup fulfilment rebuild failed (code: ${errorCode(error)}).`);
        });
      }
      await observe();
    })().catch(error => {
      console.error(`Startup background work failed (code: ${errorCode(error)}).`);
    });
    return startupRun;
  }
  app.addHook('onClose', async () => {
    if (observationTimer) clearInterval(observationTimer);
    await ads.stop();
    await startupRun;
    await observationRun;
  });
  app.addHook('onReady', async () => { shopify.start(); });
  app.addHook('onClose', async () => { await shopify.stop(); });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; font-src 'self'; connect-src 'self'; img-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (config.secureCookies) reply.header('Strict-Transport-Security', 'max-age=31536000');
    if (request.method === 'POST' && request.url === appConfig.shopify.webhookPath) return;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      if (request.headers.origin !== config.origin) return reply.code(403).send({ error: 'Request origin is not allowed.' });
      if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') {
        return reply.code(415).send({ error: 'Use a JSON request.' });
      }
    }
  });
  await registerShopifyWebhooks(app, db, sourceEnv, () => shopify.triggerInbox());
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ImportError) return reply.code(400).send({ error: error.message });
    if (error instanceof HeroRangeError) return reply.code(400).send({ error: 'Invalid date range.' });
    if (error instanceof SettingsValidationError) {
      return reply.code(400).send({ error: error.message, fields: error.fields });
    }
    if (error instanceof SettingsConflictError) return reply.code(409).send({ error: error.message });
    if (request.method === 'POST' && request.routeOptions.url === '/api/settings') {
      console.error(`Settings save failed (code: ${errorCode(error)}).`);
    }
    const code = error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : undefined;
    const status = typeof code === 'number' && code >= 400 && code < 500 ? code : 500;
    reply.code(status).send({ error: status === 500 ? 'The service is temporarily unavailable.' : 'Invalid request.' });
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'Not found.' }));

  app.get('/health', async (_request, reply) => {
    try { await db.query('SELECT 1'); return { status: 'ok' }; }
    catch { return reply.code(503).send({ status: 'unavailable' }); }
  });
  app.get('/login', async (request, reply) => {
    if (await auth.session(request)) return reply.redirect('/');
    return reply.type('text/html; charset=utf-8').send(loginPage(Boolean(config.setupCode)));
  });
  async function heroInputs(facts:Awaited<ReturnType<typeof shopify.store.facts>>,settings:Awaited<ReturnType<typeof readSettings>>['values']) {
    const today=ukToday(sourceNow());
    return {spend:await spendFacts(db,settings,sourceEnv,shopify.mode,dataset(facts,today).min,today),costs:await shopify.store.costHistory(),estimates:await readEstimates(db,shopify.mode)};
  }
  let unconfirmedCampaigns: { scope: string; count: number } | undefined;
  async function snapshot() {
    const [settings, sourceHealth] = await Promise.all([readSettings(db), readSourceHealth(db)]);
    const facts=await shopify.store.facts();
    const adInputs=await heroInputs(facts,settings.values);
    const result = await applyShopifyDashboard({ ...getSampleDashboard(settings.values), generatedAt: new Date().toISOString(), sourceHealth }, db, facts, settings.values, sourceHealth, sourceNow(), adInputs, shopifyOptions.clock?.() ?? new Date());
    const campaignScope = JSON.stringify([settings.values.metaAdAccountId, getSourceStates(sourceEnv).find(source => source.source === 'meta')!.mode]);
    try {
      unconfirmedCampaigns = { scope: campaignScope, count: (await readMetaCampaigns(db, settings.values, sourceEnv)).filter(campaign => !campaign.confirmed).length };
    } catch (error) {
      console.error(`Meta campaign summary failed (code: ${errorCode(error)}).`);
    }
    if (unconfirmedCampaigns?.scope === campaignScope) result.metaCampaigns = { unconfirmedCount: unconfirmedCampaigns.count };
    result.fulfilment = await fulfilmentSummary(db, shopify.mode, sourceNow());
    result.shopify?.needs.push(...result.fulfilment.needs.map(n => ({ ...n, state: 'warn' as const, source: 'j-and-j' as const })));
    return result;
  }
  const events = registerDashboardEvents(app, auth, snapshot);
  registerFulfilment(app, db, auth, shopify.mode, sourceNow, () => events.publish());
  app.get('/', async (request, reply) => {
    if (!await auth.session(request)) return reply.redirect('/login');
    return reply.type('text/html; charset=utf-8').send(dashboardPage(await snapshot()));
  });
  app.get('/api/dashboard', async (request, reply) => {
    if (!await auth.session(request)) return reply.code(401).send({ error: 'Sign in to continue.' });
    return await snapshot();
  });
  app.get('/api/hero', async (request, reply) => {
    if (!await auth.session(request)) return reply.code(401).send({ error: 'Sign in to continue.' });
    const query = request.query as Record<string, unknown>;
    if (Object.keys(query).some((key) => key !== 'from' && key !== 'to')) throw new HeroRangeError();
    const { from, to } = validateHeroRange(query.from, query.to);
    const settings = await readSettings(db);
    const facts=await shopify.store.facts();
    return shopifyHero(facts, ukToday(sourceNow()), from, to, settings.values,undefined,undefined,await heroInputs(facts,settings.values),sourceNow());
  });
  app.get('/sources', async (request, reply) => {
    if (!await auth.session(request)) return reply.redirect('/login');
    const [dashboard, imports, costs, settings] = await Promise.all([snapshot(), shopify.store.summary(), shopify.store.costSummary(), readSettings(db)]);
    return reply.type('text/html; charset=utf-8').send(sourceHealthPage(dashboard.sourceHealth ?? [], imports, costs, await spendHealth(db, sourceEnv, settings.values), {
      summary: dashboard.banner ?? '', shopify: dashboard.shopify!, checkedAt: sourceNow().toISOString(), campaigns: await readCampaignSync(db, settings.values, sourceEnv),
    }));
  });
  app.get('/api/shopify', async (request, reply) => {
    if (!await auth.session(request)) return reply.code(401).send({ error: 'Sign in to continue.' });
    return shopify.store.summary();
  });
  app.get('/settings', async (request, reply) => {
    if (!await auth.session(request)) return reply.redirect('/login');
    const settings = await readSettings(db);
    return reply.type('text/html; charset=utf-8').send(settingsPage(settings, await shopify.store.latestCosts(), shopify.mode, new Date(), await readMetaCampaigns(db, settings.values, sourceEnv), await readCampaignSync(db, settings.values, sourceEnv)));
  });
  app.get('/api/settings', async (request, reply) => {
    if (!await auth.session(request)) return reply.code(401).send({ error: 'Sign in to continue.' });
    return await readSettings(db);
  });
  app.post('/api/settings', { bodyLimit: 1_048_576 }, async (request, reply) => {
    const credentialId = await auth.session(request);
    if (!credentialId) return reply.code(401).send({ error: 'Sign in to continue.' });
    const saved = await saveSettings(db, request.body, credentialId);
    if (saved.changedFields.length) { await refreshFulfilment(db, shopify.mode, sourceNow()); await events.publish(); }
    return saved;
  });
  app.get('/audit', async (request, reply) => {
    if (!await auth.session(request)) return reply.redirect('/login');
    const result = await db.query<{ event: string; occurred_at: Date; field: string | null }>(`
      SELECT audit.event, audit.occurred_at, changes.field
      FROM pulse.audit_log audit LEFT JOIN pulse.settings_changes changes ON changes.audit_id = audit.id
      ORDER BY audit.occurred_at DESC, audit.id DESC LIMIT 100`);
    return reply.type('text/html; charset=utf-8').send(auditPage(result.rows));
  });
  // Fixed paths only; the server never exposes repository or environment files.
  const assets = [
    ...['browser.js', 'dashboard.js', 'settings.js', 'fulfilment.js'].map(name => [name, 'text/javascript; charset=utf-8'] as const),
    ...['styles.css', 'dashboard.css', 'settings.css', 'fulfilment.css', 'fonts.css', 'pull-refresh.css'].map(name => [name, 'text/css; charset=utf-8'] as const),
    ...['logo.png', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'].map(name => [name, 'image/png'] as const),
    ...['outfit', 'plus-jakarta-sans'].flatMap(name => [
      [`fonts/${name}-latin-wght-normal.woff2`, 'font/woff2'] as const,
      [`fonts/${name}-LICENSE.txt`, 'text/plain; charset=utf-8'] as const,
    ]),
  ];
  for (const [name, type] of assets) {
    const path = fileURLToPath(new URL(`../dist/public/${name}`, import.meta.url));
    app.get(`/assets/${name}`, async (_request, reply) => reply.type(type).send(await readFile(path)));
  }
  app.get('/manifest.webmanifest', async (_request, reply) => reply.type('application/manifest+json').send(
    await readFile(new URL('../dist/public/manifest.webmanifest', import.meta.url)),
  ));
  auth.registerRoutes(app);
  const cleanup = setInterval(() => { void auth.cleanup().catch(() => {}); }, 60 * 60 * 1000);
  cleanup.unref();
  app.addHook('onClose', async () => { clearInterval(cleanup); });
  app.decorate('startBackgroundWork', startBackgroundWork);
  return app;
}
