import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import type { Database, QueryResult } from '../src/db.js';
import type { MetaCampaign } from '../src/ad-spend/model.js';
import { invalidateMetaCampaigns } from '../src/ad-spend/campaign-cache.js';
import { readCampaignSync, readMetaCampaigns, recordCampaignSync, saveMetaCampaigns } from '../src/ad-spend/store.js';
import { defaultSettings, readSettings, saveSettings, SettingsConflictError } from '../src/settings.js';
import { createTestDatabase } from './helpers/database.js';

const now = new Date('2026-10-10T08:00:00.000Z');
const later = new Date('2026-10-10T08:30:00.000Z');
const settings = () => ({ ...defaultSettings(), metaAdAccountId: '9000000000' });
const liveEnv = () => ({ META_ACCESS_TOKEN: randomBytes(16).toString('hex') });
const campaign: MetaCampaign = {
  id: '900000000601', name: 'Invented Aurora discovery', status: 'ACTIVE', createdAt: '2026-09-01T08:00:00.000Z',
};

function observedDatabase(base: Database) {
  let reads = 0;
  const db: Database = {
    ...base,
    async query<Row extends Record<string, unknown>>(text: string, values?: unknown[]) {
      if (/SELECT[\s\S]+FROM pulse\.meta_campaigns/.test(text)) reads++;
      return base.query<Row>(text, values);
    },
  };
  return { db, reads: () => reads };
}

test('campaign cache shares concurrent snapshot reads, isolates accounts and databases, and returns fresh projections', async (t) => {
  const base = await createTestDatabase();
  t.after(() => base.close());
  const { db, reads } = observedDatabase(base), s = settings(), env = liveEnv();
  await saveMetaCampaigns(db, s.metaAdAccountId, [campaign], now);
  const lists = await Promise.all(Array.from({ length: 4 }, () => readMetaCampaigns(db, s, env)));
  assert.equal(reads(), 1);
  assert.ok(lists.every((rows) => rows[0]?.name === campaign.name));
  assert.deepEqual(await readCampaignSync(db, s, env), { state: 'success', at: now.toISOString() });
  for (let heartbeat = 0; heartbeat < 3; heartbeat++) await readMetaCampaigns(db, s, env);
  assert.equal(reads(), 1, 'campaign status and repeated snapshots use the same cached database rows');

  lists[0]![0]!.name = 'Changed by caller';
  lists[0]!.push({ ...lists[0]![0]! });
  const ownerChange = { ...s, metaOwners: [{ campaignId: campaign.id, owner: 'freelancer' as const }] };
  const fresh = await readMetaCampaigns(db, ownerChange, env);
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0]!.name, campaign.name);
  assert.equal(fresh[0]!.owner, 'freelancer');
  assert.equal(fresh[0]!.confirmed, true);
  assert.equal((await readMetaCampaigns(db, s, env))[0]!.owner, 'ours');
  assert.equal(reads(), 1, 'read-time owner changes do not require another source-data query');

  assert.deepEqual(await readMetaCampaigns(db, { ...s, metaAdAccountId: '9000000001' }, env), []);
  assert.equal(reads(), 2, 'a different account never receives the first account list');
  const restarted = observedDatabase(base);
  await readMetaCampaigns(restarted.db, s, env);
  assert.equal(restarted.reads(), 1, 'database identities do not share process state');
  const sample = await readMetaCampaigns(db, s, {});
  assert.ok(sample.every((row) => row.mode === 'sample'));
  assert.equal(reads(), 2, 'sample campaigns require no database read');
});

test('successful campaign writes, including empty reads, invalidate rows while keeping campaigns omitted by Meta', async (t) => {
  const base = await createTestDatabase();
  t.after(() => base.close());
  const { db, reads } = observedDatabase(base), s = settings(), env = liveEnv();
  await saveMetaCampaigns(db, s.metaAdAccountId, [campaign], now);
  await readMetaCampaigns(db, s, env);
  await saveMetaCampaigns(db, s.metaAdAccountId, [{ ...campaign, name: 'Invented Aurora renamed' }], later);
  const changed = await readMetaCampaigns(db, s, env);
  assert.equal(changed[0]!.name, 'Invented Aurora renamed');
  assert.equal(changed[0]!.firstSeen, now.toISOString());
  assert.equal(changed[0]!.lastSeen, later.toISOString());
  assert.equal(reads(), 2);
  await saveMetaCampaigns(db, s.metaAdAccountId, [], later);
  assert.deepEqual(await readMetaCampaigns(db, s, env), changed);
  assert.equal(reads(), 3, 'a successful empty list also invalidates, without deleting stored campaigns');
});

test('only a successful owner Settings change invalidates the campaign cache', async (t) => {
  const base = await createTestDatabase();
  t.after(() => base.close());
  const { db, reads } = observedDatabase(base), s = settings(), env = liveEnv(), credential = randomUUID();
  await saveMetaCampaigns(db, s.metaAdAccountId, [campaign], now);
  await readMetaCampaigns(db, s, env);
  const initial = await readSettings(db);
  const accountSaved = await saveSettings(db, { version: initial.version, values: s }, credential);
  await readMetaCampaigns(db, accountSaved.values, env);
  assert.equal(reads(), 1, 'an unrelated Settings save keeps the rows cached');
  const values = { ...s, metaOwners: [{ campaignId: campaign.id, owner: 'freelancer' as const }] };
  await assert.rejects(saveSettings(db, { version: initial.version, values }, credential), SettingsConflictError);
  await readMetaCampaigns(db, accountSaved.values, env);
  assert.equal(reads(), 1, 'a rejected owner save does not invalidate');
  const saved = await saveSettings(db, { version: accountSaved.version, values }, credential);
  const confirmed = await readMetaCampaigns(db, saved.values, env);
  assert.equal(reads(), 2);
  assert.equal(confirmed[0]!.owner, 'freelancer');
  assert.equal(confirmed[0]!.confirmed, true);
  await saveSettings(db, { version: saved.version, values }, credential);
  await readMetaCampaigns(db, saved.values, env);
  assert.equal(reads(), 2, 'a no-op Settings save does not invalidate');
});

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

test('rejected campaign reads can retry and an obsolete rejection does not discard a newer cached read', async () => {
  const requests: ReturnType<typeof deferred<QueryResult<Record<string, unknown>>>>[] = [];
  const db: Database = {
    async query<Row extends Record<string, unknown>>() {
      const request = deferred<QueryResult<Record<string, unknown>>>();
      requests.push(request);
      return await request.promise as QueryResult<Row>;
    },
    transaction: async (fn) => fn(db), close: async () => {},
  };
  const s = settings(), env = liveEnv();
  const failed = readMetaCampaigns(db, s, env);
  const sameFailure = readMetaCampaigns(db, s, env);
  const rejected = Promise.all([assert.rejects(failed, /unavailable/), assert.rejects(sameFailure, /unavailable/)]);
  assert.equal(requests.length, 1);
  requests[0]!.reject(new Error('unavailable'));
  await rejected;

  const oldRead = readMetaCampaigns(db, s, env);
  const oldRejected = assert.rejects(oldRead, /unavailable/);
  assert.equal(requests.length, 2);
  invalidateMetaCampaigns(db, s.metaAdAccountId);
  const newRead = readMetaCampaigns(db, s, env);
  assert.equal(requests.length, 3);
  requests[1]!.reject(new Error('unavailable'));
  await oldRejected;
  requests[2]!.resolve({ rows: [], rowCount: 0 });
  assert.deepEqual(await newRead, []);
  assert.deepEqual(await readMetaCampaigns(db, s, env), []);
  assert.equal(requests.length, 3, 'the older rejection cannot evict the successful replacement');
});

test('campaign sync state covers pending, failed, recovered and successful-empty attempts without losing stored campaigns', async (t) => {
  const base = await createTestDatabase();
  t.after(() => base.close());
  const { db, reads } = observedDatabase(base), s = settings(), env = liveEnv();
  assert.deepEqual(await readCampaignSync(db, s, env), { state: 'pending', at: null });
  assert.deepEqual(await readMetaCampaigns(db, s, env), []);
  assert.equal(reads(), 1);
  recordCampaignSync(db, s.metaAdAccountId, { state: 'error', at: now.toISOString(), code: 'http 400, meta 100/1487694' });
  assert.deepEqual(await readCampaignSync(db, s, env), {
    state: 'error', at: now.toISOString(), code: 'http 400, meta 100/1487694',
  });
  assert.deepEqual(await readCampaignSync(db, { ...s, metaAdAccountId: '9000000001' }, env), { state: 'pending', at: null });

  await saveMetaCampaigns(db, s.metaAdAccountId, [campaign], now);
  recordCampaignSync(db, s.metaAdAccountId, { state: 'success', at: now.toISOString() });
  const recovered = await readCampaignSync(db, s, env);
  assert.deepEqual(recovered, { state: 'success', at: now.toISOString() });
  recovered.at = later.toISOString();
  assert.deepEqual(await readCampaignSync(db, s, env), { state: 'success', at: now.toISOString() });
  const rows = await readMetaCampaigns(db, s, env);
  recordCampaignSync(db, s.metaAdAccountId, { state: 'error', at: later.toISOString(), code: 'timeout' });
  assert.deepEqual(await readMetaCampaigns(db, s, env), rows);
  assert.deepEqual(await readCampaignSync(db, s, env), { state: 'error', at: later.toISOString(), code: 'timeout' });
  assert.deepEqual(await readCampaignSync({ ...db }, s, env), { state: 'success', at: now.toISOString() },
    'restart infers the last stored successful non-empty read');

  await saveMetaCampaigns(db, s.metaAdAccountId, [], later);
  recordCampaignSync(db, s.metaAdAccountId, { state: 'success', at: later.toISOString() });
  assert.deepEqual(await readCampaignSync(db, s, env), { state: 'success', at: later.toISOString() });
  assert.deepEqual(await readMetaCampaigns(db, s, env), rows);
  assert.deepEqual(await readCampaignSync(db, s, {}), { state: 'success', at: '2026-09-30T12:00:00.000Z' });
});
