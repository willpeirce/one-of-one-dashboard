import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { createApp } from '../src/app.js';
import { ConfigError, readRuntime } from '../src/runtime.js';
import { createTestDatabase } from './helpers/database.js';
import type { Database } from '../src/db.js';
import { readSettings } from '../src/settings.js';

test('unexpected Settings database errors log only SQLSTATE and retain the fixed browser response', async t => {
  const db = await createTestDatabase();
  const marker = randomBytes(32).toString('hex');
  let rejectAudit = false;
  const faultDb: Database = {
    ...db,
    transaction: fn => db.transaction(async tx => fn({
      ...tx,
      query: (sql, values) => {
        if (rejectAudit && sql.includes('INSERT INTO pulse.settings_changes')) {
          throw Object.assign(new Error(marker), { code: '23514', detail: marker });
        }
        return tx.query(sql, values);
      },
    })),
  };
  const config = readRuntime({ DATABASE_URL: 'postgresql://localhost/pulse_test', APP_ORIGIN: 'https://pulse.example.test' });
  const app = await createApp(faultDb, config);
  t.after(async () => { await app.close(); await db.close(); });
  const secret = (await db.query<{ value: Uint8Array }>('SELECT value FROM pulse_private.app_secrets WHERE name = $1', ['session_hmac'])).rows[0]!;
  const token = randomBytes(32).toString('base64url');
  const credentialId = randomBytes(32).toString('base64url');
  const hash = createHmac('sha256', Buffer.from(secret.value)).update(token).digest('hex');
  await db.query('INSERT INTO pulse_private.credentials(id, public_key) VALUES ($1, $2)', [credentialId, randomBytes(32)]);
  await db.query("INSERT INTO pulse_private.sessions(token_hash, credential_id, expires_at) VALUES ($1, $2, now() + interval '30 days')", [hash, credentialId]);
  const before = await readSettings(db);
  const logs: string[] = [];
  t.mock.method(console, 'error', (message: string) => logs.push(message));
  rejectAudit = true;
  const response = await app.inject({
    method: 'POST', url: '/api/settings',
    headers: { origin: config.origin, 'content-type': 'application/json', cookie: `__Host-pulse_session=${token}` },
    payload: { version: before.version, values: { ...before.values, metaAdAccountId: '9000000000' } },
  });
  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.json(), { error: 'The service is temporarily unavailable.' });
  assert.deepEqual(logs, ['Settings save failed (code: 23514).']);
  assert.ok(!JSON.stringify(logs).includes(marker));
  assert.ok(!JSON.stringify(logs).includes(token));
  assert.ok(!JSON.stringify(logs).includes('9000000000'));
  assert.deepEqual(await readSettings(db), before);
  assert.equal((await db.query('SELECT * FROM pulse.settings_changes')).rowCount, 0);
});

test('service and authentication boundaries against the database', async t => {
  const db = await createTestDatabase();
  const setupCode = randomBytes(32).toString('base64url');
  const config = readRuntime({ DATABASE_URL: 'postgresql://localhost/pulse_test', APP_ORIGIN: 'https://pulse.example.test', DASHBOARD_SETUP_CODE: setupCode });
  let unavailable = false;
  const faultDb: Database = { ...db, query: (sql, values) => {
    if (unavailable && sql === 'SELECT 1') throw new Error('Private database diagnostics must never be returned');
    return db.query(sql, values);
  } };
  const app = await createApp(faultDb, config);
  t.after(async () => { await app.close(); await db.close(); });
  const headers = { origin: config.origin, 'content-type': 'application/json' };
  const post = (url: string, payload: object = {}, cookie?: string) => app.inject({ method: 'POST', url, headers: { ...headers, ...(cookie ? { cookie } : {}) }, payload });

  await t.test('health exposes status only, including database failure', async () => {
    const healthy = await app.inject('/health');
    assert.equal(healthy.statusCode, 200);
    assert.deepEqual(healthy.json(), { status: 'ok' });
    unavailable = true;
    try {
      const down = await app.inject('/health');
      assert.equal(down.statusCode, 503);
      assert.deepEqual(down.json(), { status: 'unavailable' });
    } finally { unavailable = false; }
    for (const path of ['/', '/audit', '/sources', '/settings']) {
      const response = await app.inject(path);
      assert.equal(response.statusCode, 302);
      assert.equal(response.headers.location, '/login');
    }
    for (const path of ['/api/dashboard', '/api/settings', '/api/events']) {
      assert.equal((await app.inject(path)).statusCode, 401);
    }
    assert.equal((await post('/api/settings')).statusCode, 401);
  });

  await t.test('private pages and assets have restrictive headers and no file traversal', async () => {
    const login = await app.inject('/login');
    assert.equal(login.headers['cache-control'], 'no-store');
    assert.match(String(login.headers['content-security-policy']), /frame-ancestors 'none'/);
    assert.match(String(login.headers['strict-transport-security']), /max-age/);
    assert.equal(login.body.includes(setupCode), false);
    for (const path of ['/.env', '/src/auth.ts', '/assets/..%2f.env']) assert.equal((await app.inject(path)).statusCode, 404);
  });

  await t.test('all authentication writes reject missing/wrong origins and non-JSON requests', async () => {
    for (const url of ['/auth/register/options', '/auth/register/verify', '/auth/login/options', '/auth/login/verify', '/auth/logout', '/api/settings']) {
      for (const origin of [undefined, 'https://untrusted.example.test']) {
        const result = await app.inject({ method: 'POST', url, payload: {}, headers: origin ? { origin } : {} });
        assert.equal(result.statusCode, 403);
      }
      assert.equal((await app.inject({ method: 'POST', url, payload: 'data', headers: { origin: config.origin, 'content-type': 'text/plain' } })).statusCode, 415);
    }
  });

  await t.test('registration requires setup phrase and creates a short, bound challenge', async () => {
    assert.equal((await post('/auth/register/options', { setupCode: randomBytes(24).toString('hex') })).statusCode, 400);
    assert.equal((await post('/auth/register/options', { setupCode })).statusCode, 200);
    const result = await post('/auth/register/options', { setupCode });
    const options = result.json();
    assert.equal(options.rp.id, 'pulse.example.test');
    assert.equal(options.authenticatorSelection.userVerification, 'required');
    assert.equal(options.authenticatorSelection.residentKey, 'required');
    const cookie = result.cookies.find(c => c.name === '__Host-pulse_challenge');
    assert.ok(cookie);
    assert.equal(cookie.httpOnly, true);
    assert.equal(cookie.secure, true);
    assert.equal(cookie.sameSite, 'Strict');
    assert.equal(cookie.maxAge, 300);
    const count = await db.query<{ count: string }>('SELECT count(*)::text AS count FROM pulse_private.challenges');
    assert.equal(count.rows[0]?.count, '2');
  });

  await t.test('challenges are consumed once, invalid and expired WebAuthn cannot add a device', async () => {
    const result = await post('/auth/register/options', { setupCode });
    const challengeCookie = result.cookies.find(c => c.name === '__Host-pulse_challenge')!;
    const cookie = `${challengeCookie.name}=${challengeCookie.value}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      const rejected = await post('/auth/register/verify', { response: {} }, cookie);
      assert.equal(rejected.statusCode, 400);
      assert.equal(rejected.cookies.some(c => c.name === '__Host-pulse_session'), false);
    }
    await db.query("UPDATE pulse_private.challenges SET expires_at = now() - interval '1 second'");
    const login = await post('/auth/login/options');
    assert.equal(login.json().userVerification, 'required');
    const authCookie = login.cookies.find(c => c.name === '__Host-pulse_challenge')!;
    await db.query("UPDATE pulse_private.challenges SET expires_at = now() - interval '1 second'");
    assert.equal((await post('/auth/login/verify', { response: {} }, `${authCookie.name}=${authCookie.value}`)).statusCode, 400);
    assert.equal((await db.query('SELECT id FROM pulse_private.credentials')).rowCount, 0);
  });

  await t.test('setup throttling persists across service restart and ignores spoofed forwarding headers', async () => {
    await db.query('DELETE FROM pulse_private.rate_limits');
    const rejection = { setupCode: randomBytes(24).toString('hex') };
    for (let i = 0; i < 5; i++) assert.equal((await post('/auth/register/options', rejection)).statusCode, 400);
    const restarted = await createApp(db, config);
    try {
      const limited = await restarted.inject({ method: 'POST', url: '/auth/register/options', payload: { setupCode }, headers: { ...headers, 'x-forwarded-for': '192.0.2.55' } });
      assert.equal(limited.statusCode, 429);
      assert.equal(limited.headers['retry-after'], '900');
      await db.query("UPDATE pulse_private.rate_limits SET window_started_at = now() - interval '16 minutes'");
      assert.equal((await restarted.inject({ method: 'POST', url: '/auth/register/options', payload: { setupCode }, headers })).statusCode, 200);
    } finally { await restarted.close(); }
  });

  await t.test('sessions are opaque, survive restart, expire and are revoked on logout', async () => {
    const secret = (await db.query<{ value: Uint8Array }>('SELECT value FROM pulse_private.app_secrets WHERE name = $1', ['session_hmac'])).rows[0]!;
    const token = randomBytes(32).toString('base64url');
    const hash = createHmac('sha256', Buffer.from(secret.value)).update(token).digest('hex');
    const id = randomBytes(32).toString('base64url');
    await db.query('INSERT INTO pulse_private.credentials(id, public_key) VALUES ($1, $2)', [id, randomBytes(32)]);
    await db.query("INSERT INTO pulse_private.sessions(token_hash, credential_id, expires_at) VALUES ($1, $2, now() + interval '30 days')", [hash, id]);
    const cookie = `__Host-pulse_session=${token}`;
    const restarted = await createApp(db, config);
    try {
      const page = await restarted.inject({ url: '/', headers: { cookie } });
      assert.equal(page.statusCode, 200);
      assert.match(page.body, /sample data/);
      assert.equal((await restarted.inject({ url: '/audit', headers: { cookie } })).statusCode, 200);
      const sample = await restarted.inject({ url: '/api/dashboard', headers: { cookie } });
      assert.equal(sample.statusCode, 200);
      assert.equal(sample.headers['cache-control'], 'no-store');
      assert.equal(sample.json().mode, 'sample');
      assert.equal(sample.json().sourceHealth.length, 11);
      const settings = (await restarted.inject({ url: '/api/settings', headers: { cookie } })).json();
      const saved = await restarted.inject({
        method: 'POST', url: '/api/settings', headers: { ...headers, cookie },
        payload: { version: settings.version, values: { ...settings.values, blendedMetaTripwireGbp: 31 } },
      });
      assert.equal(saved.statusCode, 200);
      assert.deepEqual(saved.json().changedFields, ['blendedMetaTripwireGbp']);
      const updated = (await restarted.inject({ url: '/api/dashboard', headers: { cookie } })).json();
      for (const period of ['today', 'yday', '7d']) assert.match(updated.hero[period].ukcpo.s, /£31/);
      const audit = await restarted.inject({ url: '/audit', headers: { cookie } });
      assert.match(audit.body, /settings changed/);
      assert.match(audit.body, /blendedMetaTripwireGbp/);
      for (const url of ['/api/reviews/1/publish', '/api/ads/1/pause']) {
        assert.equal((await restarted.inject({ method: 'POST', url, headers: { ...headers, cookie }, payload: {} })).statusCode, 404);
      }
      assert.equal((await restarted.inject({ url: '/', headers: { cookie: `__Host-pulse_session=${randomBytes(32).toString('base64url')}` } })).statusCode, 302);
    } finally { await restarted.close(); }
    assert.equal((await post('/auth/logout', {}, cookie)).statusCode, 200);
    assert.equal((await app.inject({ url: '/', headers: { cookie } })).statusCode, 302);
    assert.equal((await db.query('SELECT token_hash FROM pulse_private.sessions')).rowCount, 0);
    await db.query("INSERT INTO pulse_private.sessions(token_hash, credential_id, created_at, expires_at) VALUES ($1, $2, now() - interval '31 days', now() - interval '1 second')", [hash, id]);
    assert.equal((await app.inject({ url: '/', headers: { cookie } })).statusCode, 302);
    assert.equal((await db.query('SELECT name FROM pulse_private.app_secrets')).rowCount, 2);
    const auditRows = await db.query('SELECT event, credential_id FROM pulse.audit_log');
    const auditText = JSON.stringify(auditRows.rows);
    assert.equal(auditText.includes(setupCode), false);
    assert.equal(auditText.includes(token), false);
    assert.match(auditText, /sign_out/);
  });

  await t.test('without a setup code enrollment stays closed but the service starts', async () => {
    const { setupCode: _, ...withoutCode } = config;
    const unconfigured = await createApp(db, withoutCode);
    try {
      assert.equal((await unconfigured.inject('/health')).statusCode, 200);
      assert.equal((await unconfigured.inject('/login')).body.includes('id="setup-code"'), false);
      assert.equal((await unconfigured.inject({ method: 'POST', url: '/auth/register/options', headers, payload: { setupCode } })).statusCode, 400);
    } finally { await unconfigured.close(); }
  });
});

test('runtime configuration binds passkeys to an explicit secure production origin', () => {
  const base = { DATABASE_URL: 'postgresql://localhost/pulse_test' };
  assert.equal(readRuntime(base).origin, 'http://localhost:3000');
  assert.throws(() => readRuntime({ ...base, NODE_ENV: 'production' }), /APP_ORIGIN/);
  for (const APP_ORIGIN of ['http://pulse.example.test', 'https://pulse.example.test/path', 'https://user:password@pulse.example.test', 'https://pulse.example.test/?x=1']) {
    assert.throws(() => readRuntime({ ...base, APP_ORIGIN }));
  }
  for (const DASHBOARD_SETUP_CODE of [' '.repeat(30), 'short', 'a'.repeat(1025)]) assert.throws(() => readRuntime({ ...base, DASHBOARD_SETUP_CODE }));
  assert.throws(() => readRuntime({ ...base, PORT: '-1' }));
  assert.throws(() => readRuntime({}));
});

test('configuration errors use fixed messages without exposing supplied values', () => {
  const base = { DATABASE_URL: 'postgresql://localhost/pulse_test' };
  const cases: { env: NodeJS.ProcessEnv; message: string }[] = [
    { env: { APP_ORIGIN: 'https://pulse.example.test' }, message: 'DATABASE_URL is required' },
    { env: { ...base, PORT: 'invalid-port' }, message: 'Invalid PORT' },
    { env: { ...base, NODE_ENV: 'production' }, message: 'APP_ORIGIN is required in production' },
    { env: { ...base, APP_ORIGIN: 'invalid-origin' }, message: 'Invalid APP_ORIGIN' },
    { env: { ...base, APP_ORIGIN: 'https://pulse.example.test/private-path' }, message: 'APP_ORIGIN must contain only a scheme, hostname and optional port' },
    { env: { ...base, NODE_ENV: 'production', APP_ORIGIN: 'http://pulse.example.test' }, message: 'APP_ORIGIN must use HTTPS (HTTP localhost is allowed in development)' },
    { env: { ...base, DASHBOARD_SETUP_CODE: randomBytes(19).toString('hex').slice(0, 19) }, message: 'DASHBOARD_SETUP_CODE must contain 20 to 1024 characters' },
  ];
  for (const { env, message } of cases) {
    assert.throws(() => readRuntime(env), (error: unknown) => {
      assert.ok(error instanceof ConfigError);
      assert.equal(error.message, message);
      for (const [name, value] of Object.entries(env)) {
        if (name !== 'NODE_ENV' && value) assert.equal(error.message.includes(value), false);
      }
      return true;
    });
  }
});
