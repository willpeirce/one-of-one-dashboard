import assert from 'node:assert/strict';
import {createHmac, randomBytes} from 'node:crypto';
import test from 'node:test';
import {createApp} from '../src/app.js';
import {readRuntime} from '../src/runtime.js';
import type {Database} from '../src/db.js';
import type {MorningSnapshot} from '../src/morning/model-types.js';
import {gorgiasWeekStart, type GorgiasTicket} from '../src/gorgias/model.js';
import {gorgiasScope} from '../src/gorgias/scope.js';
import {saveGorgiasPoll} from '../src/gorgias/store.js';
import {defaultSettings} from '../src/settings.js';
import {createTestDatabase} from './helpers/database.js';

const homeFlag = (html: string): string => html.match(/<a class="handover-flag"[^>]*>[\s\S]*?<\/a>/)?.[0] ?? '';

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
  const dashboard = (await app.inject({url: '/api/dashboard', headers})).json();
  assert.equal(dashboard.shopify.mode, 'sample');
  assert.deepEqual(dashboard.handover, {mode: 'sample', current: true, open: 4, checkedAt: '2032-04-07T12:00:00.000Z'});
  const home = await app.inject({url: '/?check=1', headers});
  assert.equal(home.statusCode, 200);
  assert.equal(homeFlag(home.body), '<a class="handover-flag" href="/handover" data-handover-flag data-state="decide" data-mode="sample" aria-label="4 open handover tickets, sample data"><span class="hf-figure">◆ 4</span><span class="hf-word"> sample handover</span></a>');
  assert.equal((await db.query('SELECT 1 FROM pulse.gorgias_tickets')).rowCount, 0, 'Sample fixtures never seed live tickets');
});

test('live Shopify excludes keyless Gorgias from dashboard and Morning while Handover retains its sample tickets', async t => {
  const db = await createTestDatabase(), now = new Date('2032-04-07T12:00:00Z');
  const config = readRuntime({DATABASE_URL: 'postgresql://localhost/invented_handover', APP_ORIGIN: 'https://pulse.example.test'});
  const env = {SHOPIFY_CLIENT_ID: randomBytes(16).toString('hex'), SHOPIFY_CLIENT_SECRET: randomBytes(32).toString('hex')};
  const app = await createApp(db, config, env, {clock: () => now}, {}, {}, {}, {clock: () => now});
  t.after(async () => {await app.close(); await db.close();});
  const key = (await db.query<{value: Uint8Array}>("SELECT value FROM pulse_private.app_secrets WHERE name='session_hmac'")).rows[0]!;
  const token = randomBytes(32).toString('base64url'), credential = randomBytes(32).toString('base64url');
  await db.query('INSERT INTO pulse_private.credentials(id,public_key) VALUES($1,$2)', [credential, randomBytes(32)]);
  await db.query("INSERT INTO pulse_private.sessions(token_hash,credential_id,expires_at) VALUES($1,$2,now()+interval '30 days')",
    [createHmac('sha256', Buffer.from(key.value)).update(token).digest('hex'), credential]);
  const headers = {cookie: `__Host-pulse_session=${token}`};
  const dashboard = (await app.inject({url: '/api/dashboard', headers})).json();
  assert.equal(dashboard.shopify.mode, 'live');
  assert.equal(dashboard.shopify.needs.some((need: {source: string}) => need.source === 'gorgias'), false);
  assert.equal(Object.hasOwn(dashboard, 'handover'), false, 'No Gorgias keys: the live snapshot carries no handover count');
  const home = await app.inject({url: '/?check=1', headers});
  assert.equal(home.statusCode, 200);
  assert.equal(homeFlag(home.body), '<a class="handover-flag" href="/handover" data-handover-flag hidden></a>', 'The flag stays hidden and empty');
  assert.doesNotMatch(home.body, /sample handover|open handover ticket/);
  const deck = (await app.inject({url: '/api/morning', headers})).json<MorningSnapshot>();
  assert.equal(deck.mode, 'live');
  assert.equal(deck.cards.some(card => card.subjectId === 'gorgias-handover'), false);
  const handover = await app.inject({url: '/handover', headers});
  assert.equal(handover.statusCode, 200); assert.match(handover.body, /Sample data · four invented tickets/);
  assert.equal((handover.body.match(/data-gorgias-ticket=/g) ?? []).length, 4);
});

test('live Gorgias puts the open handover total on Home as a link, with no ticket detail in the snapshot', async t => {
  const db = await createTestDatabase(), now = new Date('2032-04-07T12:00:00Z');
  const config = readRuntime({DATABASE_URL: 'postgresql://localhost/invented_handover', APP_ORIGIN: 'https://pulse.example.test'});
  const domain = `invented-${randomBytes(6).toString('hex')}`, email = `reader-${randomBytes(6).toString('hex')}@example.invalid`;
  const env = {SHOPIFY_CLIENT_ID: randomBytes(16).toString('hex'), SHOPIFY_CLIENT_SECRET: randomBytes(32).toString('hex'),
    GORGIAS_DOMAIN: domain, GORGIAS_EMAIL: email, GORGIAS_API_KEY: randomBytes(32).toString('hex')};
  const app = await createApp(db, config, env, {clock: () => now}, {}, {}, {}, {clock: () => now});
  t.after(async () => {await app.close(); await db.close();});
  const key = (await db.query<{value: Uint8Array}>("SELECT value FROM pulse_private.app_secrets WHERE name='session_hmac'")).rows[0]!;
  const token = randomBytes(32).toString('base64url'), credential = randomBytes(32).toString('base64url');
  await db.query('INSERT INTO pulse_private.credentials(id,public_key) VALUES($1,$2)', [credential, randomBytes(32)]);
  await db.query("INSERT INTO pulse_private.sessions(token_hash,credential_id,expires_at) VALUES($1,$2,now()+interval '30 days')",
    [createHmac('sha256', Buffer.from(key.value)).update(token).digest('hex'), credential]);
  const headers = {cookie: `__Host-pulse_session=${token}`};
  const pending = (await app.inject({url: '/api/dashboard', headers})).json();
  assert.equal(Object.hasOwn(pending, 'handover'), false, 'Keys present but no completed read yet: no number');
  const ticket = (id: string, change: Partial<GorgiasTicket> = {}): GorgiasTicket => ({id, status: 'open', channel: 'email',
    tags: ['ai_handover'], inHandover: true, viewId: null, aiIntent: null, createdAt: '2032-01-05T09:00:00Z', updatedAt: now.toISOString(),
    lastCustomerMessageAt: '2032-04-06T10:00:00Z', customer: 'Fern L.', subject: 'Invented slab question', ...change});
  // Old and new tickets count alike: the number is the folder's open total, never "new since".
  const saved = await saveGorgiasPoll(db, gorgiasScope(domain, defaultSettings()), {closedThisWeek: 1, tickets: [
    ticket('81001'), ticket('81002', {createdAt: '2032-04-07T11:00:00Z', lastCustomerMessageAt: '2032-04-07T11:30:00Z'}), ticket('81003'),
    ticket('81004', {status: 'closed'})]}, {weekStart: gorgiasWeekStart(now), finishedAt: now, nextRun: new Date(now.getTime() + 120_000)});
  assert.equal(saved, true);
  // A second application reads the stored rows as a restarted deployment would, with no source call.
  const restarted = await createApp(db, config, env, {clock: () => now}, {}, {}, {}, {clock: () => now});
  t.after(async () => {await restarted.close();});
  const dashboard = (await restarted.inject({url: '/api/dashboard', headers})).json();
  assert.deepEqual(dashboard.handover, {mode: 'live', current: true, open: 3, checkedAt: now.toISOString()});
  assert.doesNotMatch(JSON.stringify(dashboard.handover), /Fern|Invented|8100\d/);
  const home = await restarted.inject({url: '/?check=1', headers});
  assert.equal(home.statusCode, 200);
  assert.equal(homeFlag(home.body), '<a class="handover-flag" href="/handover" data-handover-flag data-state="decide" data-mode="live" aria-label="3 open handover tickets"><span class="hf-figure">◆ 3</span><span class="hf-word"> handover</span></a>');
  assert.doesNotMatch(home.body, /Fern L\.|Invented slab question/, 'Home shows the number only; names and subjects stay on Handover');
});
