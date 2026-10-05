import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Database } from './db.js';
import { Auth } from './auth.js';
import { readSourceHealth, syncSourceHealth } from './sources.js';
import { loginPage, sourceHealthPage, auditPage } from './views.js';
import type { RuntimeConfig } from './runtime.js';
import { dashboardPage } from './dashboard-view.js';
import { getSampleDashboard, getSampleHero } from './sample-dashboard.js';
import { HeroRangeError, validateHeroRange } from './hero-range.js';
import { registerDashboardEvents } from './events.js';
import { readSettings, saveSettings, SettingsValidationError, SettingsConflictError } from './settings.js';
import { settingsPage } from './settings-view.js';

export async function createApp(db: Database, config: RuntimeConfig, sourceEnv: NodeJS.ProcessEnv = {}) {
  // Request/error logging is deliberately off: authentication bodies contain private material.
  const app = Fastify({ logger: false, bodyLimit: 32_768, trustProxy: false, requestTimeout: 15_000 });
  await app.register(cookie);
  const auth = await Auth.create(db, config);
  await auth.cleanup();
  await syncSourceHealth(db, sourceEnv);
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; font-src 'self'; connect-src 'self'; img-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (config.secureCookies) reply.header('Strict-Transport-Security', 'max-age=31536000');
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      if (request.headers.origin !== config.origin) return reply.code(403).send({ error: 'Request origin is not allowed.' });
      if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') {
        return reply.code(415).send({ error: 'Use a JSON request.' });
      }
    }
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HeroRangeError) return reply.code(400).send({ error: 'Invalid date range.' });
    if (error instanceof SettingsValidationError) {
      return reply.code(400).send({ error: error.message, fields: error.fields });
    }
    if (error instanceof SettingsConflictError) return reply.code(409).send({ error: error.message });
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
  async function snapshot() {
    const [settings, sourceHealth] = await Promise.all([readSettings(db), readSourceHealth(db)]);
    return { ...getSampleDashboard(settings.values), generatedAt: new Date().toISOString(), sourceHealth };
  }
  const events = registerDashboardEvents(app, auth, snapshot);
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
    return getSampleHero(from, to, settings.values);
  });
  app.get('/sources', async (request, reply) => {
    if (!await auth.session(request)) return reply.redirect('/login');
    return reply.type('text/html; charset=utf-8').send(sourceHealthPage(await readSourceHealth(db)));
  });
  app.get('/settings', async (request, reply) => {
    if (!await auth.session(request)) return reply.redirect('/login');
    return reply.type('text/html; charset=utf-8').send(settingsPage(await readSettings(db)));
  });
  app.get('/api/settings', async (request, reply) => {
    if (!await auth.session(request)) return reply.code(401).send({ error: 'Sign in to continue.' });
    return await readSettings(db);
  });
  app.post('/api/settings', async (request, reply) => {
    const credentialId = await auth.session(request);
    if (!credentialId) return reply.code(401).send({ error: 'Sign in to continue.' });
    const saved = await saveSettings(db, request.body, credentialId);
    if (saved.changedFields.length) await events.publish();
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
    ...['browser.js', 'dashboard.js', 'settings.js'].map(name => [name, 'text/javascript; charset=utf-8'] as const),
    ...['styles.css', 'dashboard.css', 'settings.css', 'fonts.css'].map(name => [name, 'text/css; charset=utf-8'] as const),
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
  return app;
}
