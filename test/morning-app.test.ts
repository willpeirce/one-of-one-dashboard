import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import test from 'node:test';
import type { Database } from '../src/db.js';
import { createApp } from '../src/app.js';
import { readRuntime } from '../src/runtime.js';
import type { MorningSnapshot } from '../src/morning/model-types.js';
import { morningInputFromDashboard } from '../src/morning/inputs.js';
import { morningDeck } from '../src/morning/model.js';
import { tickerState } from '../src/ticker/model.js';
import { defaultSettings } from '../src/settings.js';
import { getSampleDashboard } from '../src/sample-dashboard.js';
import { readCreativeView } from '../src/creatives/routes.js';
import { createTestDatabase } from './helpers/database.js';

test('Morning reuses read-only Home inputs and only mutates its state and audit, including missing Settings', async t => {
  const db = await createTestDatabase(), writes: string[] = [];
  let inspectWrites = false;
  const observed = (connection: Database): Database => ({
    query(sql, values) {
      if (inspectWrites) for (const match of sql.matchAll(/(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(pulse(?:_private)?\.[a-z_]+)/gi)) writes.push(match[1]!);
      return connection.query(sql, values);
    },
    transaction: fn => connection.transaction(tx => fn(observed(tx))),
    close: async () => {},
  });
  const config = readRuntime({ DATABASE_URL: 'postgresql://localhost/pulse_morning_test', APP_ORIGIN: 'https://pulse.example.test' });
  const now = new Date('2032-04-07T08:00:00Z');
  const app = await createApp(observed(db), config, {}, {}, {}, {}, {}, { clock: () => now });
  t.after(async () => { await app.close(); await db.close(); });
  const secret = (await db.query<{ value: Uint8Array }>("SELECT value FROM pulse_private.app_secrets WHERE name='session_hmac'")).rows[0]!;
  const token = randomBytes(32).toString('base64url'), credential = randomBytes(32).toString('base64url');
  await db.query('INSERT INTO pulse_private.credentials(id,public_key) VALUES($1,$2)', [credential, randomBytes(32)]);
  await db.query("INSERT INTO pulse_private.sessions(token_hash,credential_id,expires_at) VALUES($1,$2,now()+interval '30 days')",
    [createHmac('sha256', Buffer.from(secret.value)).update(token).digest('hex'), credential]);
  await db.query('DELETE FROM pulse.settings');
  const headers = { cookie: `__Host-pulse_session=${token}`, origin: config.origin, 'content-type': 'application/json' };
  inspectWrites = true;
  const response = await app.inject({ url: '/api/morning', headers });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  const initial = response.json<MorningSnapshot>();
  assert.equal(initial.day, '2032-04-07');
  assert.equal(initial.mode, 'sample');
  assert.deepEqual(initial.cards.map(card => card.kind), ['meta-kill', 'check-item', 'test-call', 'done-for-you', 'google', 'check-item']);
  assert.equal(initial.brief!.items!.length, 3);
  assert.equal(initial.brief!.items![0]!.tag!.type, 'pause');
  assert.equal(initial.datedFromCheck!.length, 1);
  assert.equal(initial.brief!.allInDeck, false, 'The sample Dated item is in the fine sheet');
  assert.ok(initial.cards.filter(card => card.kind === 'check-item').every(card => card.primary.kind !== 'live'));
  for (const kind of ['dial', 'arms']) assert.ok(initial.cards.some(card => card.figure.kind === kind), `Sample decision deck includes ${kind}`);
  assert.ok(initial.cards.every(card => !['fading', 'make-next', 'date', 'new-verdict', 'meta-watch'].includes(card.kind)));
  const dashboard = getSampleDashboard();
  dashboard.creatives = await readCreativeView(observed(db), defaultSettings(), {}, now, {}, {seedSample: false, briefWindows: true});
  const candidates = morningDeck(morningInputFromDashboard(dashboard, defaultSettings(), tickerState([], [], now, 'sample'), 'sample'), [], now).candidates;
  const brief = candidates.find(card => card.figure.kind === 'brief')!;
  assert.equal(brief.figure.kind, 'brief');
  if (brief.figure.kind === 'brief') for (const variant of Object.values(brief.figure.variants)) {
    for (const bullet of variant.bullets) assert.doesNotMatch(bullet.text, /£|a purchase against|Hook \d+%/);
    assert.doesNotMatch(variant.footer, /£/);
    if (variant.bullets.length) assert.match(variant.text, /£|%/, 'Evidence remains in the full copy/why text');
  }
  assert.doesNotMatch(brief.whyLine!, /£/);
  assert.deepEqual(writes, []);
  const cardKey = initial.cards[0]!.key;
  const saved = await app.inject({ method: 'POST', url: '/api/morning/press', headers, payload: {cardKey, action: 'park'} });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json<MorningSnapshot>().completed, 1);
  assert.deepEqual(writes, ['pulse.morning_card_states', 'pulse.audit_log']);
  writes.length = 0;
  const undone = await app.inject({ method: 'POST', url: '/api/morning/press', headers, payload: {cardKey, action: 'undo'} });
  assert.equal(undone.statusCode, 200);
  assert.deepEqual(undone.json<MorningSnapshot>().cards.map(card => card.key), initial.cards.map(card => card.key));
  assert.deepEqual(writes, ['pulse.morning_card_states', 'pulse.audit_log']);
  assert.equal((await db.query('SELECT 1 FROM pulse.settings')).rows.length, 0);
});

test('a failed Morning read sets the visit marker and its failed projection cannot break Home', async t => {
  const db = await createTestDatabase(); let fail = false;
  const observed: Database = {...db, query(sql, values) {
    if (fail && /^SELECT\b/.test(sql) && sql.includes('pulse.morning_card_states')) throw new Error('Invented Morning storage failure');
    return db.query(sql, values);
  }, transaction: fn => db.transaction(tx => fn({...tx, query(sql, values) {
    if (fail && /^SELECT\b/.test(sql) && sql.includes('pulse.morning_card_states')) throw new Error('Invented Morning storage failure');
    return tx.query(sql, values);
  }}))};
  const config = readRuntime({DATABASE_URL: 'postgresql://localhost/pulse_morning_test', APP_ORIGIN: 'https://pulse.example.test'});
  const now = new Date('2032-04-07T08:00:00Z'), app = await createApp(observed, config, {}, {}, {}, {}, {}, {clock: () => now});
  t.after(async () => {await app.close(); await db.close();});
  const secret = (await db.query<{value: Uint8Array}>("SELECT value FROM pulse_private.app_secrets WHERE name='session_hmac'")).rows[0]!;
  const token = randomBytes(32).toString('base64url'), credential = randomBytes(32).toString('base64url');
  await db.query('INSERT INTO pulse_private.credentials(id,public_key) VALUES($1,$2)', [credential, randomBytes(32)]);
  await db.query("INSERT INTO pulse_private.sessions(token_hash,credential_id,expires_at) VALUES($1,$2,now()+interval '30 days')",
    [createHmac('sha256', Buffer.from(secret.value)).update(token).digest('hex'), credential]);
  await db.query("UPDATE pulse.settings SET values=jsonb_set(values,'{morningOpensFirst}','true')");
  const headers = {cookie: `__Host-pulse_session=${token}`}, logs: string[] = [];
  t.mock.method(console, 'warn', (line: string) => logs.push(line)); fail = true;
  assert.equal((await app.inject({url: '/', headers})).statusCode, 302);
  const broken = await app.inject({url: '/morning', headers}); assert.equal(broken.statusCode, 500);
  const cookies = broken.headers['set-cookie'];
  const marker = (Array.isArray(cookies) ? cookies : [String(cookies)]).find(value => value.startsWith('pulse_morning_day='))!;
  assert.match(marker, /^pulse_morning_day=2032-04-07;/);
  headers.cookie += `; ${marker.split(';')[0]}`;
  assert.equal((await app.inject({url: '/', headers})).statusCode, 200);
  const snapshot = await app.inject({url: '/api/dashboard', headers}); assert.equal(snapshot.statusCode, 200);
  assert.equal(Object.hasOwn(snapshot.json(), 'morningOmissions'), false);
  assert.deepEqual(logs, ['Morning projection failed; Home shows all cards.']);
});
