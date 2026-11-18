import assert from 'node:assert/strict';
import {createHmac, randomBytes} from 'node:crypto';
import test from 'node:test';
import {createApp} from '../src/app.js';
import {readRuntime} from '../src/runtime.js';
import type {Database} from '../src/db.js';
import type {DashboardSnapshot} from '../src/dashboard-types.js';
import {defaultSettings} from '../src/settings.js';
import {homeKitsHtml} from '../src/kits/view.js';
import {replaceKitFile} from '../src/kits/store.js';
import {morningInputFromDashboard} from '../src/morning/inputs.js';
import {morningDeck} from '../src/morning/model.js';
import {morningSummaryPayload} from '../src/push/service.js';
import {tickerState} from '../src/ticker/model.js';
import {createTestDatabase} from './helpers/database.js';

const now = new Date('2032-04-07T12:00:00Z');
const chapter = (html: string): string => html.match(/<section class="chapter kits" id="kits"[^>]*>([\s\S]*?)<\/section>/)?.[1] ?? '';

async function session(db: Database): Promise<{cookie: string}> {
  const key = (await db.query<{value: Uint8Array}>("SELECT value FROM pulse_private.app_secrets WHERE name='session_hmac'")).rows[0]!;
  const token = randomBytes(32).toString('base64url'), credential = randomBytes(32).toString('base64url');
  await db.query('INSERT INTO pulse_private.credentials(id,public_key) VALUES($1,$2)', [credential, randomBytes(32)]);
  await db.query("INSERT INTO pulse_private.sessions(token_hash,credential_id,expires_at) VALUES($1,$2,now()+interval '30 days')",
    [createHmac('sha256', Buffer.from(key.value)).update(token).digest('hex'), credential]);
  return {cookie: `__Host-pulse_session=${token}`};
}

async function harness(t: test.TestContext, env: NodeJS.ProcessEnv = {}) {
  const db = await createTestDatabase();
  const config = readRuntime({DATABASE_URL: 'postgresql://localhost/invented_kits', APP_ORIGIN: 'https://pulse.example.test'});
  const app = await createApp(db, config, env, {clock: () => now}, {}, {}, {}, {clock: () => now});
  t.after(async () => {await app.close(); await db.close();});
  return {app, db, headers: await session(db)};
}

test('sample Kits reach Home through its shared renderer and leave Morning decisions and its summary unchanged', async t => {
  const {app, headers, db} = await harness(t);
  const response = await app.inject({url: '/api/dashboard', headers});
  assert.equal(response.statusCode, 200);
  const dashboard = response.json<DashboardSnapshot>();
  assert.ok(dashboard.kits);
  assert.deepEqual(dashboard.kits.cards.map(row => row.name), ['Box A', 'Box B', 'Box C']);
  assert.deepEqual(dashboard.kits.folded.map(row => row.name), ['Box D', 'Box E', 'Box F']);
  const html = homeKitsHtml(dashboard.kits);
  for (const name of ['Box A', 'Box B', 'Box C', 'Box D', 'Box E', 'Box F']) assert.match(html, new RegExp(name));
  assert.match(html, /Sample data/);
  const home = await app.inject({url: '/?check=1', headers});
  assert.equal(home.statusCode, 200);
  assert.equal(chapter(home.body), html, 'Server and browser consume the same Kits markup without extra sample labels');
  const sheet = await app.inject({url: '/api/kits/box-b', headers});
  assert.equal(sheet.statusCode, 200); assert.match(sheet.body, /Box B/);
  assert.equal(sheet.json<{orders: unknown[]}>().orders.length, 5);
  for (const item of ['Printed sample', 'Inner trays', 'Outer cartons', 'Label sheets', 'Packing sleeves']) assert.match(sheet.body, new RegExp(item));
  assert.doesNotMatch(sheet.body, /"supplier"|a supplier|"ref"/);
  const pageSheet = await app.inject({url: '/api/kits/box-b?suppliers=1', headers});
  assert.equal(pageSheet.statusCode, 200);
  assert.equal(pageSheet.json<{orders: {supplier: string}[]}>().orders.filter(row => row.supplier === 'a supplier').length, 5);
  const kits = await app.inject({url: '/kits', headers});
  assert.equal(kits.statusCode, 200);
  for (const name of ['Box A', 'Box B', 'Box C', 'Box D', 'Box E', 'Box F']) assert.ok(kits.body.includes(name));
  assert.match(kits.body, /Sample data/); assert.match(kits.body, /a supplier/);
  assert.equal((await db.query('SELECT 1 FROM pulse.kit_board_kits')).rowCount, 0, 'Samples never seed the live kit table');
  assert.equal((await db.query('SELECT 1 FROM pulse.kit_board_orders')).rowCount, 0, 'Samples never seed the live order table');
  const sources = await app.inject({url: '/sources', headers});
  const sourceDetails = sources.body.match(/<details data-kits-read-health>[\s\S]*?<\/details>/)?.[0] ?? '';
  assert.match(sourceDetails, /GitHub HQ waiting for keys\. No kit file has been read\./);
  assert.doesNotMatch(sourceDetails, /Last read:|Updated:|<time|2032|13:00/, 'Invented sample timestamps never imply that HQ was read');
  const withoutKits = structuredClone(dashboard); delete withoutKits.kits;
  const ticker = tickerState([], [], now, 'sample');
  const build = (snapshot: DashboardSnapshot) => morningDeck(morningInputFromDashboard(snapshot, defaultSettings(), ticker, 'sample'), [], now);
  const before = build(withoutKits), after = build(dashboard);
  assert.deepEqual(after.snapshot, before.snapshot);
  assert.deepEqual(morningSummaryPayload(after), morningSummaryPayload(before));
  assert.doesNotMatch(JSON.stringify(after.candidates), /Box [A-F]/, 'Kits are a view, never a Morning candidate');
});

test('a live Shopify dashboard with no HQ key has no sample Kits, including through the detail endpoint', async t => {
  const env = {SHOPIFY_CLIENT_ID: randomBytes(16).toString('hex'), SHOPIFY_CLIENT_SECRET: randomBytes(32).toString('hex')};
  const {app, headers} = await harness(t, env);
  const dashboard = (await app.inject({url: '/api/dashboard', headers})).json<DashboardSnapshot>();
  assert.equal(dashboard.shopify?.mode, 'live');
  assert.doesNotMatch(JSON.stringify(dashboard.kits), /Box [A-F]|the kit maker/);
  const home = await app.inject({url: '/?check=1', headers});
  assert.match(chapter(home.body), /Not set up yet/); assert.doesNotMatch(chapter(home.body), /Sample data|Box [A-F]/);
  const sheet = await app.inject({url: '/api/kits/box-b', headers});
  assert.equal(sheet.statusCode, 404); assert.doesNotMatch(sheet.body, /Box B/);
  assert.equal((await app.inject({url: '/api/kits/box-b?suppliers=1', headers})).statusCode, 404);
  const kits = await app.inject({url: '/kits', headers});
  assert.equal(kits.statusCode, 200); assert.match(kits.body, /Not set up yet/);
  assert.doesNotMatch(kits.body, /Box [A-F]|the kit maker|a supplier|Sample data/);
});

test('live HQ with a pending or missing kit file shows Not set up yet and never substitutes sample kits', async t => {
  for (const missing of [false, true]) await t.test(missing ? 'missing file' : 'first read pending', async t => {
    const {app, headers, db} = await harness(t, {GITHUB_HQ_TOKEN: randomBytes(32).toString('hex')});
    if (missing) await db.transaction(async tx => {await replaceKitFile(tx, 'kits', null, now); await replaceKitFile(tx, 'kit-orders', null, now);});
    const dashboard = (await app.inject({url: '/api/dashboard', headers})).json<DashboardSnapshot>();
    assert.doesNotMatch(JSON.stringify(dashboard.kits), /Box [A-F]/);
    const home = await app.inject({url: '/?check=1', headers});
    assert.match(chapter(home.body), /Not set up yet/); assert.doesNotMatch(chapter(home.body), /Sample data|Box [A-F]/);
    assert.equal((await app.inject({url: '/api/kits/box-b', headers})).statusCode, 404);
    const kits = await app.inject({url: '/kits', headers});
    assert.equal(kits.statusCode, 200); assert.match(kits.body, /Not set up yet/);
    assert.doesNotMatch(kits.body, /Box [A-F]|a supplier|Sample data/);
    const sources = await app.inject({url: '/sources', headers});
    assert.match(sources.body, /data-kits-read-health/);
    assert.match(sources.body, missing ? /the file is absent; this is not an error/ : /Waiting for the first file read/);
  });
});
