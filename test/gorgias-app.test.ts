import assert from 'node:assert/strict';
import {createHmac, randomBytes} from 'node:crypto';
import test from 'node:test';
import {createApp} from '../src/app.js';
import {readRuntime} from '../src/runtime.js';
import type {Database} from '../src/db.js';
import type {MorningSnapshot} from '../src/morning/model-types.js';
import {createTestDatabase} from './helpers/database.js';

test('Handover authenticates before loading tickets; its labelled sample decision reaches Morning without source calls', async t => {
  const db = await createTestDatabase();
  let reads = 0;
  const guarded: Database = {...db, query: (sql, values) => {if (sql.includes('pulse.gorgias_')) reads++; return db.query(sql, values);}};
  const config = readRuntime({DATABASE_URL: 'postgresql://localhost/invented_handover', APP_ORIGIN: 'https://pulse.example.test'});
  const app = await createApp(guarded, config, {}, {}, {}, {}, {}, {clock: () => new Date('2032-04-07T12:00:00Z')});
  t.after(async () => {await app.close(); await db.close();});
  assert.equal(reads, 0, 'Application creation performs no ticket work');
  const before = await app.inject('/handover');
  assert.equal(before.statusCode, 302); assert.equal(before.headers.location, '/login'); assert.equal(reads, 0);
  const key = (await db.query<{value: Uint8Array}>("SELECT value FROM pulse_private.app_secrets WHERE name='session_hmac'")).rows[0]!;
  const token = randomBytes(32).toString('base64url'), credential = randomBytes(32).toString('base64url');
  await db.query('INSERT INTO pulse_private.credentials(id,public_key) VALUES($1,$2)', [credential, randomBytes(32)]);
  await db.query("INSERT INTO pulse_private.sessions(token_hash,credential_id,expires_at) VALUES($1,$2,now()+interval '30 days')",
    [createHmac('sha256', Buffer.from(key.value)).update(token).digest('hex'), credential]);
  const headers = {cookie: `__Host-pulse_session=${token}`};
  const response = await app.inject({url: '/handover', headers});
  assert.equal(response.statusCode, 200); assert.equal(response.headers['cache-control'], 'no-store');
  assert.match(response.body, /Sample data · four invented tickets/);
  assert.equal((response.body.match(/data-gorgias-ticket=/g) ?? []).length, 4);
  assert.equal(/mailto:|tel:|message_body/.test(response.body), false);
  const deck = (await app.inject({url: '/api/morning', headers})).json<MorningSnapshot>();
  const need = deck.cards.find(card => card.subjectId === 'gorgias-handover');
  assert.ok(need); assert.equal(need.state, 'decide'); assert.match(need.sourceLine, /sample data/);
  assert.equal(need.primary.kind, 'link');
  if (need.primary.kind === 'link') assert.equal(need.primary.href, '/handover');
  assert.equal((await db.query('SELECT 1 FROM pulse.gorgias_tickets')).rowCount, 0, 'Sample fixtures never seed live tickets');
});
