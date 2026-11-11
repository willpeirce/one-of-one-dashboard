import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import type { Database } from '../src/db.js';
import { createApp } from '../src/app.js';
import { addDays } from '../src/hero-range.js';
import { parseAdSet, saveAdSets } from '../src/meta-adsets/catalogue.js';
import type { MorningSnapshot } from '../src/morning/model-types.js';
import { readRuntime } from '../src/runtime.js';
import { readSettings, saveSettings } from '../src/settings.js';
import { createTestDatabase } from './helpers/database.js';

const now = new Date('2032-04-07T08:00:00Z');
const account = '120000000000081001', campaign = '120000000000081002', setId = '120000000000081003';
const heavyQuery = 'SELECT kind, data, fetched_at FROM pulse.shopify_records WHERE mode = $1';

async function harness(t: TestContext, mode: 'sample' | 'live' | 'mixed' = 'sample') {
  const db = await createTestDatabase();
  let observed = false, heavyReads = 0, failHeavy = false, failControls = false, sourceWrites = 0;
  const logs: string[] = [], timing: string[] = [];
  t.mock.method(console, 'error', (...values: unknown[]) => { logs.push(values.join(' ')); });
  t.mock.method(console, 'info', (...values: unknown[]) => { timing.push(values.join(' ')); });
  const wrap = (connection: Database): Database => ({
    async query(sql, values) {
      if (observed && sql === heavyQuery) {
        heavyReads++;
        if (failHeavy) throw new Error('invented-private-heavy-failure');
      }
      if (observed && failControls && /^SELECT\b/.test(sql) && /pulse\.(meta_ad_sets|meta_actions)\b/.test(sql))
        throw new Error('invented-private-control-failure');
      return connection.query(sql, values);
    },
    transaction: fn => connection.transaction(tx => fn(wrap(tx))), close: async () => {},
  });
  const env: NodeJS.ProcessEnv = {}, raw = { id: setId, campaign_id: campaign, name: 'Invented UK cache fern',
    status: 'ACTIVE', effective_status: 'ACTIVE', daily_budget: '2000',
    created_time: '2032-03-31T08:00:00Z', updated_time: '2032-03-31T08:00:00Z' };
  if (mode !== 'sample') {
    env.META_ACCESS_TOKEN = randomBytes(24).toString('hex'); env.META_ACTIONS_ENABLED = 'true';
    const previous = process.env.META_ACCESS_TOKEN; process.env.META_ACCESS_TOKEN = env.META_ACCESS_TOKEN;
    t.after(() => { if (previous === undefined) delete process.env.META_ACCESS_TOKEN; else process.env.META_ACCESS_TOKEN = previous; });
    if (mode === 'live') {
      env.SHOPIFY_CLIENT_ID = randomBytes(16).toString('hex'); env.SHOPIFY_CLIENT_SECRET = randomBytes(24).toString('hex');
    }
    const stored = await readSettings(db), settings = { ...stored.values, metaAdAccountId: account,
      metaOwners: [{ campaignId: campaign, owner: 'ours' as const }] };
    await saveSettings(db, { ...stored, values: settings }, 'invented-device');
    await saveAdSets(db, account, [parseAdSet(raw, 'GBP', settings)], settings, now);
    for (let index = 0; index < 7; index++) {
      const day = addDays('2032-03-31', index);
      await db.query(`INSERT INTO pulse.ad_spend(mode,source,account_id,campaign_id,campaign_name,ad_set_id,uk_day,
        spend_amount,currency,market,owner,fetched_at,purchases,adds_to_cart)
        VALUES('live','meta',$1,$2,'Invented UK garden',$3,$4,40,'GBP','uk','ours',$5,1,3)`, [account, campaign, setId, day, now]);
      await db.query(`INSERT INTO pulse.ad_spend_days(source,account_id,uk_day,fetched_at,actions_complete)
        VALUES('meta',$1,$2,$3,true)`, [account, day, now]);
    }
  }
  const config = readRuntime({ DATABASE_URL: 'postgresql://localhost/pulse_invented_cache', APP_ORIGIN: 'https://pulse.example.test' });
  const app = await createApp(wrap(db), config, env, {}, { clock: () => now, fetch: async (_url, init) => {
    if (init?.method === 'POST') {
      sourceWrites++; raw.status = raw.effective_status = new URLSearchParams(String(init.body)).get('status') ?? raw.status;
      return Response.json({ success: true });
    }
    return Response.json(raw);
  }, sleep: async () => {} }, {}, {}, { clock: () => now });
  t.after(async () => { await app.close(); await db.close(); });
  const secret = (await db.query<{ value: Uint8Array }>("SELECT value FROM pulse_private.app_secrets WHERE name='session_hmac'")).rows[0]!;
  const token = randomBytes(32).toString('base64url'), credential = randomBytes(32).toString('base64url');
  await db.query('INSERT INTO pulse_private.credentials(id,public_key) VALUES($1,$2)', [credential, randomBytes(32)]);
  await db.query("INSERT INTO pulse_private.sessions(token_hash,credential_id,expires_at) VALUES($1,$2,now()+interval '30 days')",
    [createHmac('sha256', Buffer.from(secret.value)).update(token).digest('hex'), credential]);
  const headers = { cookie: `__Host-pulse_session=${token}`, origin: config.origin, 'content-type': 'application/json' };
  observed = true;
  return { db, app, headers, logs, timing, reads: () => heavyReads, writes: () => sourceWrites,
    failHeavy: () => { failHeavy = true; }, failControls: () => { failControls = true; },
    read: async () => {
      const response = await app.inject({ url: '/api/morning', headers });
      assert.equal(response.statusCode, 200, response.body); return response.json<MorningSnapshot>();
    } };
}

test('cold concurrent Morning opens build once, Home shares it, and signed-out requests cannot reach either warm or cold snapshots', async t => {
  const h = await harness(t);
  for (const [origin, contentType, status, error] of [
    ['https://invented-other.example.test', 'application/json', 403, 'Request origin is not allowed.'],
    [h.headers.origin, 'text/plain', 415, 'Use a JSON request.'],
  ] as const) {
    const before = h.timing.length;
    const refused = await h.app.inject({ method: 'POST', url: '/api/morning/press',
      headers: { origin, 'content-type': contentType }, payload: '{"invented":"private-body-value"}' });
    assert.equal(refused.statusCode, status); assert.deepEqual(refused.json(), { error });
    assert.equal(h.reads(), 0, 'Early request guards never build or read the expensive snapshot');
    const lines = h.timing.slice(before);
    assert.equal(lines.length, 1, 'An early global rejection still emits exactly one Morning timing line');
    assert.match(lines[0]!, /^Morning request timings: auth=0\.0ms cache=0\.0ms controls=0\.0ms project=0\.0ms state=0\.0ms render=0\.0ms total=\d+\.\dms$/);
  }
  assert.equal((await h.app.inject('/api/morning')).statusCode, 401);
  assert.equal((await h.app.inject('/morning')).statusCode, 302);
  assert.equal((await h.app.inject('/api/dashboard')).statusCode, 401);
  assert.equal(h.reads(), 0);
  const [api, page] = await Promise.all([h.read(), h.app.inject({ url: '/morning', headers: h.headers })]);
  assert.equal(page.statusCode, 200); assert.ok(api.cards.some(card => card.kind === 'meta-kill'));
  assert.equal(h.reads(), 1);
  assert.equal((await h.app.inject({ url: '/api/dashboard', headers: h.headers })).statusCode, 200);
  assert.equal((await h.app.inject({ url: '/?from=morning', headers: h.headers })).statusCode, 200);
  await h.read(); assert.equal(h.reads(), 1, 'Home and Morning use the same stored observations');
  const signedOut = await h.app.inject('/api/morning');
  assert.equal(signedOut.statusCode, 401); assert.doesNotMatch(signedOut.body, /Invented|Sample|cards/);
  assert.equal((await h.app.inject({ method: 'POST', url: '/api/morning/press',
    headers: { origin: h.headers.origin, 'content-type': 'application/json' },
    payload: { cardKey: api.cards[0]!.key, action: 'park' } })).statusCode, 401);
  assert.equal(h.reads(), 1);
  const timing = h.timing.filter(line => line.startsWith('Morning request timings:'));
  assert.equal(timing.length, 9, 'Each Morning page, API read and press emits exactly one timing line, including denied requests');
  for (const line of timing) assert.match(line,
    /^Morning request timings: auth=\d+\.\dms cache=\d+\.\dms controls=\d+\.\dms project=\d+\.\dms state=\d+\.\dms render=\d+\.\dms total=\d+\.\dms$/,
    'Only fixed stage names and durations may enter request timing logs');
});

test('a local press returns its own fresh state and next read while a failed expensive rebuild retains usable observations', async t => {
  const h = await harness(t), initial = await h.read(), card = initial.cards.find(card => card.kind === 'meta-kill')!;
  h.failHeavy();
  const pressed = await h.app.inject({ method: 'POST', url: '/api/morning/press', headers: h.headers,
    payload: { cardKey: card.key, action: 'park' } });
  assert.equal(pressed.statusCode, 200, pressed.body);
  const ownResponse = pressed.json<MorningSnapshot>();
  assert.equal(ownResponse.cards.some(row => row.key === card.key), false); assert.equal(ownResponse.completed, 1);
  const after = await h.read();
  assert.equal(after.cards.some(row => row.key === card.key), false); assert.equal(after.completed, 1);
  assert.ok(after.cards.length > 0); assert.ok(h.reads() >= 2, 'The local write requested a background rebuild');
  assert.ok(h.logs.some(line => /Snapshot rebuild failed/.test(line)));
  assert.ok(h.logs.every(line => !line.includes('invented-private-heavy-failure')));
  const undone = await h.app.inject({ method: 'POST', url: '/api/morning/press', headers: h.headers,
    payload: { cardKey: card.key, action: 'undo' } });
  assert.equal(undone.statusCode, 200); assert.ok(undone.json<MorningSnapshot>().cards.some(row => row.key === card.key));
  assert.equal(h.writes(), 0);
});

test('a confirmed live pause cannot be replayed from cached Active figures or lose its audit after the expensive rebuild fails', async t => {
  const h = await harness(t, 'live'), initial = await h.read(), card = initial.cards.find(card => card.kind === 'meta-kill' && card.subjectId === setId)!;
  assert.ok(card); assert.equal(card.primary.kind, 'live');
  h.failHeavy();
  const paused = await h.app.inject({ method: 'POST', url: `/api/meta/adset/${setId}`, headers: h.headers,
    payload: { action: 'pause', value: 'PAUSED' } });
  assert.equal(paused.statusCode, 200, paused.body); assert.equal(h.writes(), 1);
  const after = await h.read();
  assert.equal(after.cards.some(row => row.subjectId === setId), false);
  assert.ok(after.metaActions.some(action => action.id === paused.json<{ id: string }>().id && action.result === 'success'));
  assert.equal(after.completed, 1);
  assert.equal((await h.app.inject({ method: 'POST', url: `/api/meta/adset/${setId}`, headers: h.headers,
    payload: { action: 'pause', value: 'PAUSED' } })).statusCode, 409);
  assert.equal(h.writes(), 1);
  h.failControls();
  const unavailable = await h.app.inject({ url: '/api/morning', headers: h.headers });
  assert.ok(unavailable.statusCode >= 500); assert.doesNotMatch(unavailable.body, /"cards"|invented-private-control-failure/);
});

test('the shared snapshot preserves live Meta on Home when Shopify is sample and Morning still offers only sample actions', async t => {
  const h = await harness(t, 'mixed');
  const morning = await h.read(); assert.equal(morning.mode, 'sample');
  assert.ok(morning.cards.every(card => [card.primary, card.secondary, ...card.menu].every(button => button?.kind !== 'live')));
  const home = await h.app.inject({ url: '/api/dashboard', headers: h.headers });
  assert.equal(home.statusCode, 200);
  const dashboard = home.json<{ adSets: { mode: string; rows: { set: { id: string } }[] } }>();
  assert.equal(dashboard.adSets.mode, 'live'); assert.ok(dashboard.adSets.rows.some(row => row.set.id === setId));
  assert.equal(h.reads(), 1, 'Mixed source modes still share the one expensive build');
});
