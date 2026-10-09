import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import type { DashboardSnapshot, HeroPeriod } from '../src/dashboard-types.js';
import type { Database } from '../src/db.js';
import { readRuntime } from '../src/runtime.js';
import { createTestDatabase } from './helpers/database.js';

function tomorrowInLondon(): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: string) => Number(parts.find((entry) => entry.type === type)!.value);
  return new Date(Date.UTC(part('year'), part('month') - 1, part('day') + 1)).toISOString().slice(0, 10);
}

function assertSampleHero(hero: HeroPeriod, from: string, to: string): void {
  assert.equal(hero.from, from);
  assert.equal(hero.to, to);
  assert.equal(typeof hero.short, 'string');
  assert.ok(hero.short.length > 0);
  assert.ok(Array.isArray(hero.spark) && hero.spark.length > 0);
  assert.ok(hero.spark.every((value) => Number.isFinite(value) && value >= 0));
  for (const key of ['net', 'orders', 'cr', 'spend', 'roas', 'margin', 'ukcpo', 'uscpo'] as const) {
    const metric = hero[key];
    assert.equal(metric.mode, 'sample', `${key} must stay labelled sample`);
    assert.ok(metric.source.length > 0, `${key} must identify its source`);
    assert.ok(metric.source.every((source) => ['shopify', 'meta', 'google-ads', 'tiktok', 'github-hq'].includes(source)));
    assert.ok(Number.isFinite('n' in metric ? metric.n : metric.v), `${key} must have a finite value`);
    assert.ok(metric.d.src.length > 0, `${key} must explain its source`);
    if (['net','orders','cr'].includes(key)) assert.ok(metric.d.hist && metric.d.hist.length > 0, `${key} must include its ingested detail history`);
    else if ('n' in metric) assert.equal(metric.unavailable, false, `${key} uses labelled sample spend with sample Shopify`);
    else if (metric.t==='—') assert.match(metric.d.why, /÷ 0 Shopify orders/);
    else assert.match(metric.t, /^£/);
  }
}

test('hero range API protects sessions, validates fixed errors and serves labelled weighted samples', async (t) => {
  const db = await createTestDatabase();
  const setupCode = randomBytes(32).toString('base64url');
  const config = readRuntime({
    DATABASE_URL: 'postgresql://localhost/pulse_test',
    APP_ORIGIN: 'https://pulse.example.test',
    DASHBOARD_SETUP_CODE: setupCode,
  });
  const privateMarker = randomBytes(24).toString('hex');
  let failSettingsRead = false;
  const faultDb: Database = {
    ...db,
    query: (sql, values) => {
      if (failSettingsRead && sql.includes('SELECT version, values FROM pulse.settings')) {
        throw new Error(`Private SQL connection diagnostic ${privateMarker}`);
      }
      return db.query(sql, values);
    },
  };
  const app = await createApp(faultDb, config);
  t.after(async () => { await app.close(); await db.close(); });
  const secret = (await db.query<{ value: Uint8Array }>(
    "SELECT value FROM pulse_private.app_secrets WHERE name = 'session_hmac'",
  )).rows[0]!;
  const credentialId = randomBytes(32).toString('base64url');
  await db.query('INSERT INTO pulse_private.credentials (id, public_key) VALUES ($1, $2)', [credentialId, randomBytes(32)]);
  const token = randomBytes(32).toString('base64url');
  const hash = createHmac('sha256', Buffer.from(secret.value)).update(token).digest('hex');
  await db.query(`
    INSERT INTO pulse_private.sessions (token_hash, credential_id, expires_at)
    VALUES ($1, $2, now() + interval '30 days')
  `, [hash, credentialId]);
  const cookie = `__Host-pulse_session=${token}`;
  const get = (query: string) => app.inject({ url: `/api/hero${query}`, headers: { cookie } });

  await t.test('authentication precedes validation, including malformed and forged requests', async () => {
    for (const query of ['', '?from=wrong&to=invalid', '?from=2026-09-08&to=2026-09-20']) {
      const anonymous = await app.inject(`/api/hero${query}`);
      assert.equal(anonymous.statusCode, 401);
      assert.deepEqual(anonymous.json(), { error: 'Sign in to continue.' });
    }
    const forged = await app.inject({
      url: '/api/hero?from=2026-09-08&to=2026-09-20',
      headers: { cookie: `__Host-pulse_session=${randomBytes(32).toString('base64url')}` },
    });
    assert.equal(forged.statusCode, 401);
    assert.deepEqual(forged.json(), { error: 'Sign in to continue.' });
  });

  await t.test('all invalid ranges return the same fixed 400 without reflecting input', async () => {
    const future = tomorrowInLondon();
    const queries = [
      '', '?from=2026-09-08', '?to=2026-09-20', '?from=&to=',
      '?from=2026-9-08&to=2026-09-20', '?from=2026-09-08T00:00:00Z&to=2026-09-20',
      '?from=2026-02-29&to=2026-03-01', '?from=2026-04-31&to=2026-05-01',
      '?from=2026-00-01&to=2026-09-20', '?from=2026-13-01&to=2026-13-02',
      '?from=2026-09-00&to=2026-09-20', '?from=2026-09-21&to=2026-09-20',
      `?from=${future}&to=${future}`,
      '?from=2025-09-29&to=2026-09-30',
      '?from=2025-08-01&to=2025-08-02', '?from=2026-09-30&to=2026-10-01',
      '?from=2026-09-08&from=2026-09-09&to=2026-09-20',
      '?from=2026-09-08&to=2026-09-20&to=2026-09-21',
      '?from[]=2026-09-08&to=2026-09-20',
      '?from=2026-09-08&to=2026-09-20&extra=1',
      `?from=${privateMarker}&to=2026-09-20`,
      `?from=${encodeURIComponent("2026-09-08'; SELECT * FROM pulse_private.app_secrets; --")}&to=2026-09-20`,
    ];
    for (const query of queries) {
      const response = await get(query);
      assert.equal(response.statusCode, 400, 'invalid range must be rejected');
      assert.deepEqual(response.json(), { error: 'Invalid date range.' });
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.ok(!response.body.includes(privateMarker));
    }
  });

  await t.test('arbitrary September, single-day and year-to-date ranges carry all eight sample metrics', async () => {
    for (const [from, to] of [
      ['2026-09-08', '2026-09-20'], ['2026-09-08', '2026-09-08'], ['2026-01-01', '2026-09-30'],
    ] as const) {
      const response = await get(`?from=${from}&to=${to}`);
      assert.equal(response.statusCode, 200);
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.match(String(response.headers['content-type']), /^application\/json/);
      const hero = response.json<HeroPeriod>();
      assertSampleHero(hero, from, to);
      assert.ok(!response.body.includes(token));
      assert.ok(!response.body.includes(setupCode));
      assert.ok(!response.body.includes(privateMarker));
    }
  });

  await t.test('custom seven-day aggregation preserves the established totals and thirty days matches its tab', async () => {
    const weekResponse = await get('?from=2026-09-23&to=2026-09-29');
    assert.equal(weekResponse.statusCode, 200);
    const week = weekResponse.json<HeroPeriod>();
    assert.equal(week.net.n, 466.34);
    assert.equal(week.orders.n, 7);
    assert.equal(week.spend.unavailable, false);
    assert.equal(week.spend.n, 7 * 652.60);
    assert.match(week.ukcpo.t, /^£/);
    assert.match(week.uscpo.t, /^£/);
    const dashboardResponse = await app.inject({ url: '/api/dashboard', headers: { cookie } });
    assert.equal(dashboardResponse.statusCode, 200);
    const snapshot = dashboardResponse.json<DashboardSnapshot>();
    assert.deepEqual(Object.keys(snapshot.hero).sort(), ['30d', '7d', 'today', 'yday']);
    assert.deepEqual({ ...week, short: snapshot.hero['7d'].short, eyebrow: snapshot.hero['7d'].eyebrow }, snapshot.hero['7d']);
    const monthResponse = await get('?from=2026-08-31&to=2026-09-29');
    assert.equal(monthResponse.statusCode, 200);
    assert.deepEqual({ ...monthResponse.json<HeroPeriod>(), short: snapshot.hero['30d'].short, eyebrow: snapshot.hero['30d'].eyebrow }, snapshot.hero['30d']);
  });

  await t.test('saved tripwire settings also control a custom range without fetching a source', async () => {
    const sourceFetch = t.mock.method(globalThis, 'fetch', async () => {
      throw new Error('A sample hero request must not fetch a source');
    });
    try {
      const settings = (await app.inject({ url: '/api/settings', headers: { cookie } })).json();
      const saved = await app.inject({
        method: 'POST', url: '/api/settings',
        headers: { cookie, origin: config.origin, 'content-type': 'application/json' },
        payload: { version: settings.version, values: { ...settings.values, blendedMetaTripwireGbp: 31 } },
      });
      assert.equal(saved.statusCode, 200);
      const response = await get('?from=2026-09-08&to=2026-09-20');
      assert.equal(response.statusCode, 200);
      const hero = response.json<HeroPeriod>();
      for (const dial of [hero.ukcpo, hero.uscpo]) {
        assert.equal(dial.mode, 'sample');
        assert.match(dial.s, /£31/);
        assert.ok(dial.z.some(([from, _to, state]) => from === 31 && state === 'decide'));
      }
      assert.equal((await db.query("SELECT * FROM pulse.source_health WHERE last_attempt_at IS NOT NULL OR last_success_at IS NOT NULL")).rowCount, 0);
      assert.equal(sourceFetch.mock.callCount(), 0);
      const write = await app.inject({
        method: 'POST', url: '/api/hero?from=2026-09-08&to=2026-09-20', payload: {},
        headers: { cookie, origin: config.origin, 'content-type': 'application/json' },
      });
      assert.equal(write.statusCode, 404);
    } finally { sourceFetch.mock.restore(); }
  });

  await t.test('unexpected database failures expose no SQL, keys or connection diagnostics', async () => {
    failSettingsRead = true;
    try {
      const response = await get('?from=2026-09-08&to=2026-09-20');
      assert.equal(response.statusCode, 500);
      assert.deepEqual(response.json(), { error: 'The service is temporarily unavailable.' });
      assert.ok(!response.body.includes(privateMarker));
    } finally { failSettingsRead = false; }
  });

  await t.test('expired and explicitly signed-out sessions cannot read custom ranges', async () => {
    await db.query(`
      UPDATE pulse_private.sessions SET created_at = now() - interval '31 days', expires_at = now() - interval '1 second'
      WHERE token_hash = $1
    `, [hash]);
    assert.equal((await get('?from=2026-09-08&to=2026-09-20')).statusCode, 401);
    await db.query("UPDATE pulse_private.sessions SET created_at = now(), expires_at = now() + interval '30 days' WHERE token_hash = $1", [hash]);
    assert.equal((await get('?from=2026-09-08&to=2026-09-20')).statusCode, 200);
    const logout = await app.inject({
      method: 'POST', url: '/auth/logout', payload: {},
      headers: { cookie, origin: config.origin, 'content-type': 'application/json' },
    });
    assert.equal(logout.statusCode, 200);
    const rejected = await get('?from=2026-09-08&to=2026-09-20');
    assert.equal(rejected.statusCode, 401);
    assert.deepEqual(rejected.json(), { error: 'Sign in to continue.' });
  });
});
