import { registerTicker } from './ticker/routes.js';
import { readTicker } from './ticker/store.js';
import { registerMorning } from './morning/routes.js';
import { morningPage } from './morning/view.js';
import { MORNING_DAY_COOKIE, MORNING_DAY_COOKIE_SECONDS, opensMorning, readMorningFirst } from './morning/entry.js';
import { morningInputFromDashboard, readMorningCoverage } from './morning/inputs.js';
import { curateMorningSample } from './morning/sample.js';
import { readHomeMorningOmissions } from './morning/home.js';
import { readMorningStates } from './morning/store.js';
import { activityActors, readActivity } from './meta-adsets/activity.js';
import {readMetaActions} from './meta-adsets/actions.js';
import {registerAdSets} from './meta-adsets/routes.js';
import { registerScorecard } from './scorecard/routes.js';
import {readAdSetsView} from './meta-adsets/presentation.js';
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
import { ReviewsWorker, type ReviewsWorkerOptions } from './judgeme/worker.js';
import { readReviews, readReviewHealth } from './judgeme/store.js';
import { sampleReviews } from './judgeme/sample.js';
import { readCreativeView, registerCreatives } from './creatives/routes.js';
import { creativeHealth } from './creatives/store.js';
import { seedCreativeSample } from './creatives/seed.js';
import { creativeFeatureFlags } from './creatives/config.js';
import { readScanHealth } from './creatives/scan-health.js';
import { dailyRows } from './shopify/metrics.js';
import { GoogleWorker } from './google-ads/worker.js';
import { readGoogleFacts } from './google-ads/store.js';
import { googleHealth } from './google-ads/health.js';
import { applyGoogleDashboard } from './google-ads/dashboard.js';
import { googleShopifyContext } from './google-ads/shopify-coverage.js';
import { MailchimpWorker, type MailchimpWorkerOptions } from './mailchimp/worker.js';
import { readMailchimpFacts } from './mailchimp/store.js';
import { applyMailchimpDashboard, applyMailchimpHero } from './mailchimp/dashboard.js';
import { mailchimpBillingNeeds } from './mailchimp/needs.js';
import { HQWorker } from './github-hq/worker.js';
import { readHQFacts } from './github-hq/store.js';
import type { HQFacts } from './github-hq/model.js';
import { addMorningHq, homeTestsFromHq } from './github-hq/presentation.js';
import { PushService } from './push/service.js';
import { registerPush } from './push/routes.js';
import type { PushTransport } from './push/sender.js';

declare module 'fastify' {
  interface FastifyInstance { startBackgroundWork(): Promise<void> }
}

export async function createApp(db: Database, config: RuntimeConfig, sourceEnv: NodeJS.ProcessEnv = {}, shopifyOptions: ConstructorParameters<typeof ShopifyWorker>[3] = {}, adOptions:SpendWorkerOptions = {}, reviewOptions: ReviewsWorkerOptions = {}, mailchimpOptions: MailchimpWorkerOptions = {}, localOptions: { clock?: () => Date; pushTransport?: PushTransport } = {}) {
  // Request/error logging is deliberately off: authentication bodies contain private material.
  const app = Fastify({ logger: false, bodyLimit: 32_768, trustProxy: false, requestTimeout: 15_000 });
  await app.register(cookie);
  const auth = await Auth.create(db, config);
  const localNow = localOptions.clock ?? (() => new Date());
  await auth.cleanup();
  await syncSourceHealth(db, sourceEnv);
  const hq = new HQWorker(db, sourceEnv, { clock: localNow });
  const shopify = new ShopifyWorker(db, sourceEnv, config.origin, shopifyOptions);
  await shopify.initialize();
  if (shopify.mode === 'sample') await shopify.tick();
  const sourceNow = () => shopifyOptions.clock?.() ?? (shopify.mode === 'sample' ? new Date(appConfig.shopify.sampleNow) : new Date());
  async function runWatchdogs() {
    const facts = await shopify.store.facts(sourceNow());
    const hqNow = localNow();
    const [settings, context, hqFacts] = await Promise.all([readSettings(db), readWatchdogContext(db, facts), readHQFacts(db, hqNow, hq.mode)]);
    const health = await creativeSourceHealth(settings.values);
    const now = sourceNow();
    const observation = await updateObservation(db, shopify.mode, facts, now);
    const checks = evaluateWatchdogs(facts, now, settings.values, observation, context.holidays, health, { entry: hqFacts.report, now: hqNow });
    await db.query('UPDATE pulse.shopify_watchdog_state SET data = data || $2::jsonb WHERE mode = $1', [shopify.mode, JSON.stringify({ checks, evaluatedAt: now.toISOString() })]);
  }
  await seedFulfilment(db, shopify.mode, sourceNow());
  const ads=new SpendWorker(db,sourceEnv,adOptions);
  const googleNow = () => adOptions.clock?.() ?? new Date();
  const google = new GoogleWorker(db, sourceEnv, settings => ads.googleReader(settings), { clock: adOptions.clock });
  const mailchimp = new MailchimpWorker(db, sourceEnv, mailchimpOptions);
  const mailchimpNow = () => mailchimpOptions.clock?.() ?? new Date();
  const creativeNow = () => adOptions.clock?.() ?? (sourceEnv.META_ACCESS_TOKEN ? new Date() : sourceNow());
  async function creativeSourceHealth(settings: Awaited<ReturnType<typeof readSettings>>['values']) {
    const live = !!sourceEnv.META_ACCESS_TOKEN && !!settings.metaAdAccountId;
    return readSourceHealth(db,await readScanHealth(db,settings,{
      accountId: live ? settings.metaAdAccountId : 'sample-meta-account', mode: live ? 'live' : 'sample', now: creativeNow(),
    }));
  }
  const creativeSettings = (await readSettings(db)).values;
  if (!sourceEnv.META_ACCESS_TOKEN || !creativeSettings.metaAdAccountId) await seedCreativeSample(db, creativeSettings, creativeNow());
  const reviews = new ReviewsWorker(db, sourceEnv, reviewOptions);
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
    shopify.start();
    ads.start();
    google.start();
    mailchimp.start();
    hq.start();
    push.start();
    reviews.start();
    void shopify.startOrderCleanup();
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
    await google.stop();
    await mailchimp.stop();
    await hq.stop();
    await push.stop();
    await ads.stop();
    await reviews.stop();
    await startupRun;
    await observationRun;
  });
  app.addHook('onClose', async () => { await shopify.stop(); });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; font-src 'self'; connect-src 'self'; img-src 'self' data:; media-src 'self' https://fbcdn.net https://*.fbcdn.net https://cdninstagram.com https://*.cdninstagram.com https://fbsbx.com https://*.fbsbx.com https://facebook.com https://*.facebook.com; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
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
    const now=sourceNow(), today=ukToday(now), googleAt=googleNow();
    const metaLive = !!settings.metaAdAccountId && getSourceStates(sourceEnv).some(source => source.source === 'meta' && source.mode === 'live');
    const metaActivity = metaLive ? await readActivity(db,settings.metaAdAccountId,settings,creativeNow()) : undefined;
    return {activity:shopify.mode==='live' ? metaActivity?.events ?? [] : [],metaActivity,googleNow:googleAt,google:await readGoogleFacts(db,settings,sourceEnv,googleAt),spend:await spendFacts(db,settings,sourceEnv,shopify.mode,dataset(facts,today).min,today,now),costs:await shopify.store.costHistory(),estimates:await readEstimates(db,shopify.mode),now};
  }
  let unconfirmedCampaigns: { scope: string; count: number } | undefined;
  async function snapshot(options: { morning?: boolean; settings?: Awaited<ReturnType<typeof readSettings>>; hq?: HQFacts } = {}) {
    const settings = options.settings ?? await readSettings(db, { seed: !options.morning });
    const hqNow = localNow(), hqFacts = options.hq ?? await readHQFacts(db, hqNow, hq.mode);
    const sourceHealth = await creativeSourceHealth(settings.values);
    const facts=await shopify.store.facts(sourceNow());
    const adInputs=await heroInputs(facts,settings.values);
    const result = await applyShopifyDashboard({ ...getSampleDashboard(settings.values), generatedAt: new Date().toISOString(), sourceHealth }, db, facts, settings.values, sourceHealth, sourceNow(), adInputs, shopifyOptions.clock?.() ?? new Date(), { entry: hqFacts.report, now: hqNow });
    applyGoogleDashboard(result, adInputs.google, googleShopifyContext(facts,adInputs.now), settings.values, adInputs.metaActivity, adInputs.googleNow, adInputs.spend);
    const mailchimpAt = mailchimpNow(), mailchimpFacts = await readMailchimpFacts(db,mailchimp.mode,mailchimpAt);
    applyMailchimpDashboard(result,mailchimpFacts,settings.values,mailchimpAt);
    result.shopify?.needs.push(...mailchimpBillingNeeds(mailchimpFacts,settings.values,mailchimpAt));
    // Radar describes actual ad connections even when Shopify numbers use sample data.
    result.adSources = await spendHealth(db, sourceEnv, settings.values, adOptions.clock?.() ?? new Date());
    result.reviews = reviews.mode === 'sample' ? sampleReviews() : await readReviews(db, reviewOptions.clock?.() ?? new Date());
    const cardEnv = options.morning && shopify.mode === 'sample' ? {} : sourceEnv;
    result.adSets = await readAdSetsView(db, settings.values, cardEnv, creativeNow());
    result.creatives = await readCreativeView(db, settings.values, cardEnv, creativeNow(), {}, { seedSample: !options.morning, briefWindows: !!options.morning });
    result.banner = result.banner?.replace('reviews and other stages: sample data', `reviews: ${reviews.mode === 'sample' ? 'sample data' : 'live Judge.me'}; Google: ${adInputs.google.mode === 'sample' ? 'sample data' : 'supported tiles use live reads, remaining examples stay labelled sample'}; Mailchimp: ${mailchimp.mode === 'sample' ? 'sample data' : result.widgets.w038?.mode === 'live' ? 'audience uses its own live read; per-flow examples remain labelled sample' : 'audience total pending or unavailable; examples remain labelled sample'}; other stages: sample data`);
    const campaignScope = JSON.stringify([settings.values.metaAdAccountId, getSourceStates(sourceEnv).find(source => source.source === 'meta')!.mode]);
    try {
      unconfirmedCampaigns = { scope: campaignScope, count: (await readMetaCampaigns(db, settings.values, sourceEnv)).filter(campaign => !campaign.confirmed).length };
    } catch (error) {
      console.error(`Meta campaign summary failed (code: ${errorCode(error)}).`);
    }
    if (unconfirmedCampaigns?.scope === campaignScope) result.metaCampaigns = { unconfirmedCount: unconfirmedCampaigns.count };
    result.fulfilment = await fulfilmentSummary(db, shopify.mode, sourceNow());
    result.shopify?.needs.push(...result.fulfilment.needs.map(n => ({ ...n, state: 'warn' as const, source: 'j-and-j' as const })));
    if (!options.morning) {
      if (shopify.mode === 'live') result.tests = homeTestsFromHq(hqFacts, await readMorningStates(db, shopify.mode), hqNow);
      const omissions = await readHomeMorningOmissions(db, result, settings.values, shopify.mode, localNow(),
        { metaNow: creativeNow(), googleNow: googleNow() });
      if (omissions) result.morningOmissions = omissions;
    }
    return result;
  }
  const events = registerDashboardEvents(app, auth, snapshot);
  async function morningInputs(now: Date) {
    const [settings, hqFacts] = await Promise.all([readSettings(db, { seed: false }), readHQFacts(db, now, hq.mode)]);
    const [dashboard, ticker, coverage] = await Promise.all([
      snapshot({ morning: true, settings, hq: hqFacts }), readTicker(db, shopify.mode, now),
      shopify.mode === 'live' ? readMorningCoverage(db, settings.values.metaAdAccountId, creativeNow(),
        { googleAccount: settings.values.googleCustomerId, googleNow: googleNow() }) : undefined,
    ]);
    const input = addMorningHq(morningInputFromDashboard(dashboard, settings.values, ticker, shopify.mode, coverage), hqFacts, now);
    return shopify.mode === 'sample' ? curateMorningSample(input, now) : input;
  }
  const morning = registerMorning(app, db, auth, morningInputs, localNow);
  const push = new PushService(db, {origin: config.origin, clock: localNow, loadMorning: now => morning.summary(now),
    transport: localOptions.pushTransport});
  registerPush(app, db, auth, {clock: localNow, sendTest: credentialId => push.sendTest(credentialId)});
  registerAdSets(app, db, auth, sourceEnv, creativeNow, adOptions, () => events.publish());
  registerScorecard(app, db, auth, shopify.store, sourceEnv, () => shopifyOptions.clock?.() ?? new Date());
  registerFulfilment(app, db, auth, shopify.mode, sourceNow, () => events.publish());
  registerCreatives(app, db, auth, sourceEnv, creativeNow, async (from, to) => {
    const facts = await shopify.store.facts(sourceNow());
    const today = ukToday(creativeNow());
    const data = dataset(facts, today);
    return { mode: shopify.mode, count: !data.ready || from < data.from || to > ukToday(sourceNow()) ? null : dailyRows(facts, today).filter(row => row.date >= from && row.date <= to).reduce((sum, row) => sum + row.o, 0) };
  }, () => events.publish(), adOptions.creativeReader, adOptions.creativeScan);
  app.get('/', async (request, reply) => {
    if (!await auth.session(request)) return reply.redirect('/login');
    if (request.url === '/' && opensMorning(await readMorningFirst(db), request.cookies[MORNING_DAY_COOKIE], request.url, localNow()))
      return reply.redirect('/morning');
    return reply.type('text/html; charset=utf-8').send(dashboardPage(await snapshot()));
  });
  app.get('/morning', async (request, reply) => {
    if (!await auth.session(request)) return reply.redirect('/login');
    const now = localNow(), deck = await morning.read(now);
    reply.setCookie(MORNING_DAY_COOKIE, ukToday(now), { path: '/', httpOnly: true,
      secure: config.secureCookies, sameSite: 'strict', maxAge: MORNING_DAY_COOKIE_SECONDS });
    return reply.type('text/html; charset=utf-8').send(morningPage(deck));
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
    const facts=await shopify.store.facts(sourceNow());
    const hero = shopifyHero(facts, ukToday(sourceNow()), from, to, settings.values,undefined,undefined,await heroInputs(facts,settings.values),sourceNow());
    return applyMailchimpHero(hero, await readMailchimpFacts(db,mailchimp.mode,mailchimpNow()));
  });
  app.get('/sources', async (request, reply) => {
    if (!await auth.session(request)) return reply.redirect('/login');
    const googleAt = googleNow();
    const mailchimpAt = mailchimpNow();
    const [dashboard, imports, costs, settings] = await Promise.all([snapshot(), shopify.store.summary(sourceNow()), shopify.store.costSummary(), readSettings(db)]);
    return reply.type('text/html; charset=utf-8').send(sourceHealthPage(dashboard.sourceHealth ?? [], imports, costs, await spendHealth(db, sourceEnv, settings.values, sourceNow()), {
      orderCleanupIncomplete: shopify.orderCleanupIncomplete,
      channelExclusions: await shopify.store.channelExclusions(),
      google: googleHealth(await readGoogleFacts(db,settings.values,sourceEnv,googleAt),googleAt),
      mailchimp: await readMailchimpFacts(db,mailchimp.mode,mailchimpAt),
      reviewHealth: reviews.mode === 'live' ? await readReviewHealth(db) : {read:dashboard.reviews!.rows.length,waiting:dashboard.reviews!.rows.length,flagged:dashboard.reviews!.rows.filter(r=>r.flagged).length,last:null,mode:'sample'},
      summary: dashboard.banner ?? '', shopify: dashboard.shopify!, checkedAt: sourceNow().toISOString(), adSets: dashboard.adSets, campaigns: await readCampaignSync(db, settings.values, sourceEnv), creatives: await creativeHealth(db, settings.values, sourceEnv, creativeNow()),
    }));
  });
  app.get('/api/shopify', async (request, reply) => {
    if (!await auth.session(request)) return reply.code(401).send({ error: 'Sign in to continue.' });
    return shopify.store.summary(sourceNow());
  });
  app.get('/settings', async (request, reply) => {
    if (!await auth.session(request)) return reply.redirect('/login');
    const settings = await readSettings(db);
    const metaLive = !!settings.values.metaAdAccountId && getSourceStates(sourceEnv).some(source => source.source === 'meta' && source.mode === 'live');
    const actors = metaLive ? activityActors(await readActivity(db, settings.values.metaAdAccountId, settings.values, creativeNow())) : undefined;
    return reply.type('text/html; charset=utf-8').send(settingsPage(settings, await shopify.store.latestCosts(), shopify.mode, new Date(), await readMetaCampaigns(db, settings.values, sourceEnv), await readCampaignSync(db, settings.values, sourceEnv), creativeFeatureFlags(sourceEnv), actors));
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
      SELECT audit.event, audit.occurred_at, COALESCE(changes.field,CASE WHEN ad.audit_id IS NOT NULL THEN concat(ad.ad_set_id,' · ',ad.field,': ',ad.old_value,' → ',ad.new_value) END) AS field
      FROM pulse.audit_log audit LEFT JOIN pulse.settings_changes changes ON changes.audit_id = audit.id
      LEFT JOIN pulse.meta_ad_set_changes ad ON ad.audit_id=audit.id
      ORDER BY audit.occurred_at DESC, audit.id DESC LIMIT 100`);
    return reply.type('text/html; charset=utf-8').send(auditPage(result.rows,await readMetaActions(db)));
  });
  // Fixed paths only; the server never exposes repository or environment files.
  const assets = [
    ...['browser.js', 'dashboard.js', 'settings.js', 'fulfilment.js', 'creatives.js', 'adsets.js', 'ticker.js', 'morning.js'].map(name => [name, 'text/javascript; charset=utf-8'] as const),
    ...['styles.css', 'dashboard.css', 'settings.css', 'fulfilment.css', 'creatives.css', 'fonts.css', 'pull-refresh.css', 'adsets.css', 'scorecard.css', 'home-compact.css', 'home-panels.css', 'decisions.css', 'ticker.css', 'morning.css'].map(name => [name, 'text/css; charset=utf-8'] as const),
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
  app.get('/sw.js', async (_request, reply) => reply.header('Cache-Control', 'no-store').type('text/javascript; charset=utf-8').send(
    await readFile(new URL('../dist/public/sw.js', import.meta.url)),
  ));
  registerTicker(app, db, auth, shopify.mode, localNow);
  auth.registerRoutes(app);
  const cleanup = setInterval(() => { void auth.cleanup().catch(() => {}); }, 60 * 60 * 1000);
  cleanup.unref();
  app.addHook('onClose', async () => { clearInterval(cleanup); });
  app.decorate('startBackgroundWork', startBackgroundWork);
  return app;
}
