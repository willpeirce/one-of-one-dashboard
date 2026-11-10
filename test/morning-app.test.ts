import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import test from 'node:test';
import type { Database } from '../src/db.js';
import { createApp } from '../src/app.js';
import { readRuntime } from '../src/runtime.js';
import type { MorningSnapshot } from '../src/morning/model-types.js';
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
  assert.equal(initial.cards.length, 7);
  for (const kind of ['dial', 'thumb', 'brief', 'arms']) assert.ok(initial.cards.some(card => card.figure.kind === kind), `First sample deck includes ${kind}`);
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
