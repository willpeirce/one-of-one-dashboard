import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import type { Database } from '../src/db.js';
import { Auth } from '../src/auth.js';
import { readRuntime } from '../src/runtime.js';
import { readSettings, saveSettings } from '../src/settings.js';
import { registerCreatives } from '../src/creatives/routes.js';
import type { CreativeReader } from '../src/creatives/model.js';
import type { CreativeSheet, CreativeView } from '../src/creatives/presentation-types.js';
import { readLiveCreativeData, saveCatalogue, saveInsights } from '../src/creatives/store.js';
import { readCreativeLifts, recomputeCreativeLifts } from '../src/creatives/lifts.js';
import { readGroupAttributes, replaceSourceAttributes } from '../src/creatives/attribute-store.js';
import { creativeAd, creativeGroup, creativeInsight } from './helpers/creatives.js';
import { createTestDatabase } from './helpers/database.js';

const account = '424243';
const now = new Date('2026-10-14T12:00:00Z');
const firstGroup = 'invented-route-lift-0';

async function harness(t: TestContext) {
  const db = await createTestDatabase();
  const config = readRuntime({ DATABASE_URL: 'postgresql://localhost/pulse_lift_route_test', APP_ORIGIN: 'https://pulse.example.test' });
  const app = Fastify({ logger: false });
  await app.register(cookie);
  const auth = await Auth.create(db, config);
  const credential = randomBytes(32).toString('base64url'), token = randomBytes(32).toString('base64url');
  const secret = (await db.query<{ value: Uint8Array }>("SELECT value FROM pulse_private.app_secrets WHERE name='session_hmac'")).rows[0]!;
  await db.query('INSERT INTO pulse_private.credentials(id,public_key) VALUES($1,$2)', [credential, randomBytes(32)]);
  await db.query("INSERT INTO pulse_private.sessions(token_hash,credential_id,expires_at) VALUES($1,$2,now()+interval '30 days')",
    [createHmac('sha256', Buffer.from(secret.value)).update(token).digest('hex'), credential]);
  const original = await readSettings(db);
  const { values: settings } = await saveSettings(db, { ...original, values: { ...original.values, metaAdAccountId: account,
    creativeLiftMinimumGroups: 3, creativeLiftMinimumSpendGbp: 150 } }, credential);
  let failReplacement = false, published = 0;
  const wrap = (connection: Database): Database => ({
    query: async (sql, values) => {
      if (failReplacement && sql.startsWith('DELETE FROM pulse.attribute_lifts')) throw new Error('Invented derived-data failure');
      return connection.query(sql, values);
    },
    transaction: fn => connection.transaction(tx => fn(wrap(tx))), close: async () => {},
  });
  const routeDb = wrap(db);
  const reader: CreativeReader = { readCatalogue: async function* () { yield []; }, readInsights: async () => [],
    imageBytes: async () => new Uint8Array(), videoFrames: async () => [],
    videoSource: async () => { throw new Error('Unused invented video read'); } };
  registerCreatives(app, routeDb, auth, { META_ACCESS_TOKEN: randomBytes(24).toString('hex') }, () => now,
    async () => ({ count: 9, mode: 'sample' }), async () => { published += 1; }, reader);
  t.after(async () => { await app.close(); await db.close(); });
  const headers = { cookie: `__Host-pulse_session=${token}`, origin: config.origin, 'content-type': 'application/json' };
  const entries = Array.from({ length: 6 }, (_, index) => {
    const id = `invented-route-lift-${index}`;
    return { ad: creativeAd(`${id}-ad`, id, { accountId: account }),
      media: { ...creativeGroup(id, { lengthSeconds: 10 + index * 2 }), thumbnail: new Uint8Array([0xff, 0xd8, 0xff, index]), poster: null, frames: [] } };
  });
  await saveCatalogue(db, account, entries, now);
  await saveInsights(db, account, '2026-10-14', '2026-10-14', entries.map((entry, index) => creativeInsight(entry.ad.id,
    { day: '2026-10-14', spend: 50, purchases: index < 3 ? 10 : 2, purchaseValue: index < 3 ? 300 : 60 })), now);
  for (const [index, entry] of entries.entries()) await replaceSourceAttributes(db, 'live', account, entry.media.id, 'model',
    { hookType: { value: index < 3 ? 'unboxing' : 'question', confidence: 0.9, reason: 'Invented route fixture' } }, now);
  await recomputeCreativeLifts(db, account, await readLiveCreativeData(db, settings), settings, now);
  return { app, db, headers, failLifts() { failReplacement = true; }, published: () => published };
}

test('an authenticated live tag POST recomputes the stored lift and changes panel and sheet briefs', async t => {
  const h = await harness(t);
  const before = await h.app.inject({ url: '/api/creatives', headers: h.headers });
  assert.equal(before.statusCode, 200);
  const original = before.json<CreativeView>();
  assert.equal(original.mode, 'live'); assert.equal(original.lifts.length, 1);
  assert.equal(original.lifts[0]!.confidence, 'Strong'); assert.match(original.makeNext.video!.brief, /Open with an unboxing/);
  const response = await h.app.inject({ method: 'POST', url: `/api/creatives/${firstGroup}/attributes`,
    headers: h.headers, payload: { key: 'hookType', value: 'question' } });
  assert.equal(response.statusCode, 200); assert.equal(response.json().attribute.source, 'will');
  assert.equal(response.json().attribute.value, 'question'); assert.equal(h.published(), 1);
  assert.deepEqual(await readCreativeLifts(h.db, account, 'live'), [], 'moving one parent under the minimum removes the lift');
  const after = (await h.app.inject({ url: '/api/creatives', headers: h.headers })).json<CreativeView>();
  assert.equal(after.makeNext.video.empty, 'Not enough yet. Scans and spend fill this in.'); assert.equal(after.makeNext.video.bullets.length, 0);
  assert.equal(after.cards.some(card => card.kind === 'decide'), false);
  const sheet = (await h.app.inject({ url: `/api/creatives/${firstGroup}`, headers: h.headers })).json<CreativeSheet>();
  assert.equal(sheet.attributes.find(attribute => attribute.key === 'hookType')!.source, 'will'); assert.equal(sheet.brief, undefined);
  // Tapping the Will value again restores the confident model answer and its derived brief.
  const cleared = await h.app.inject({ method: 'POST', url: `/api/creatives/${firstGroup}/attributes`,
    headers: h.headers, payload: { key: 'hookType', value: 'question' } });
  assert.equal(cleared.statusCode, 200); assert.equal(cleared.json().attribute.source, 'model');
  assert.equal((await readCreativeLifts(h.db, account, 'live', { windowDays: 7, market: 'all' })).length, 1);
});

test('a derived lift replacement failure does not turn a durable tag toggle into a failed save', async t => {
  const h = await harness(t), logs: string[] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => logs.push(args.join(' ')));
  h.failLifts();
  const response = await h.app.inject({ method: 'POST', url: `/api/creatives/${firstGroup}/attributes`,
    headers: h.headers, payload: { key: 'hookType', value: 'question' } });
  assert.equal(response.statusCode, 200); assert.equal(response.json().attribute.value, 'question');
  const attributes = await readGroupAttributes(h.db, 'live', account, firstGroup);
  assert.equal(attributes.find(attribute => attribute.key === 'hookType')!.willValue, 'question');
  assert.equal(h.published(), 1); assert.deepEqual(logs, ['Creative lifts could not be refreshed.']);
  assert.equal((await readCreativeLifts(h.db, account, 'live', { windowDays: 7, market: 'all' })).length, 1, 'failed replacement retains the previous stored derivation');
});
