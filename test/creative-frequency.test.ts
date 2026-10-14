import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { buildFrequencyRequests, exactCreativeFrequency, frequencyMembershipKey, refreshCreativeFrequencies } from '../src/creatives/frequency.js';
import { addDays } from '../src/hero-range.js';
import type { CreativeData, CreativeReader } from '../src/creatives/model.js';
import { creativeAd, creativeData, creativeInsight } from './helpers/creatives.js';
import { createTestDatabase } from './helpers/database.js';

const today = '2026-10-13', now = new Date(`${today}T12:00:00Z`);
function history(ids: string[]): CreativeData {
  const data = creativeData(ids);
  data.mode = 'live';
  data.insights = ids.flatMap(id => Array.from({ length: 10 }, (_, index) => creativeInsight(id, { day: addDays(today, -index) })));
  return data;
}
function reader(readFrequency: NonNullable<CreativeReader['readFrequency']>): CreativeReader {
  return { readFrequency, readCatalogue: async function* () { yield []; }, readInsights: async () => [], videoSource: async () => '',
    imageBytes: async () => new Uint8Array(), videoFrames: async () => [] };
}

test('frequency requests deduplicate filter contexts and preserve exact market/owner/live memberships', () => {
  const data = history(['parent']);
  data.ads.push(creativeAd('us-copy', 'parent', { market: 'us', owner: 'freelancer' }),
    creativeAd('paused-copy', 'parent', { effectiveStatus: 'PAUSED' }));
  data.insights.push(...data.insights.map(row => ({ ...row, adId: 'us-copy' })),
    ...data.insights.filter(row => row.adId === 'parent').map(row => ({ ...row, adId: 'paused-copy' })));
  const requests = buildFrequencyRequests(data, today);
  assert.deepEqual(requests.map(row => row.adIds).sort(), [
    ['parent', 'paused-copy', 'us-copy'], ['parent', 'us-copy'], ['parent', 'paused-copy'], ['parent'], ['us-copy'],
  ].sort());
  assert.ok(requests.every(row => row.from === '2026-10-07' && row.to === today));
  const key = frequencyMembershipKey(['one', 'two']);
  assert.equal(key, frequencyMembershipKey(['two', 'one', 'one']));
});

test('frequency requests exclude unseasoned, inactive and no-longer-spending groups', () => {
  const data = history(['old', 'paused', 'new', 'eligible']);
  data.ads.find(ad => ad.id === 'paused')!.effectiveStatus = 'PAUSED';
  data.insights = data.insights.filter(row => row.adId !== 'old' || row.day < '2026-10-12')
    .filter(row => row.adId !== 'new' || row.day >= '2026-10-08');
  assert.deepEqual(buildFrequencyRequests(data, today).map(row => row.adIds), [['eligible']]);
});

test('exact frequency requires the full same membership and dates and preserves unavailable data', () => {
  const data = history(['one']);
  data.frequencyReads = [{ adIds: ['one', 'two'], from: '2026-10-07', to: today, frequency: 3.7 }];
  assert.equal(exactCreativeFrequency(data, ['two', 'one'], '2026-10-07', today), 3.7);
  assert.equal(exactCreativeFrequency(data, ['one'], '2026-10-07', today), null);
  assert.equal(exactCreativeFrequency(data, ['one', 'two'], '2026-10-08', today), null);
  data.frequencyReads[0]!.frequency = null;
  assert.equal(exactCreativeFrequency(data, ['two', 'one'], '2026-10-07', today), null);
});

test('frequency cache is account scoped, bounded to twenty reads, resumable and refreshed every thirty minutes', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const data = history(Array.from({ length: 23 }, (_, index) => `invented-${index}`));
  const calls: string[][] = [];
  const client = reader(async (_account, adIds) => { calls.push(adIds); return 3.4; });
  const first = await refreshCreativeFrequencies(db, client, 'invented-account', data, now);
  assert.deepEqual(first, { requested: 23, refreshed: 20, unavailable: 0 });
  assert.equal(calls.length, 20);
  assert.equal((await refreshCreativeFrequencies(db, client, 'invented-account', data, now)).refreshed, 3);
  assert.equal((await refreshCreativeFrequencies(db, client, 'invented-account', data, now)).refreshed, 0);
  assert.equal(new Set(calls.flat()).size, 23);
  assert.equal((await refreshCreativeFrequencies(db, client, 'invented-account', data,
    new Date(now.getTime() + 30 * 60_000))).refreshed, 20);
  const other = await refreshCreativeFrequencies(db, client, 'another-invented-account', history(['single']), now);
  assert.equal(other.refreshed, 1);
  assert.equal((await db.query('SELECT * FROM pulse.creative_frequencies WHERE account_id=$1', ['invented-account'])).rows.length, 23);
});

test('refused frequency replaces a stale measurement with unavailable, preserves insights and never logs provider text', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const data = history(['clip']);
  await refreshCreativeFrequencies(db, reader(async () => 3.4), 'invented-account', data, now);
  const logs: string[] = [];
  t.mock.method(console, 'info', (...args: unknown[]) => logs.push(args.map(String).join(' ')));
  const inventedToken = randomUUID();
  const result = await refreshCreativeFrequencies(db, reader(async () => { throw new Error(inventedToken); }),
    'invented-account', data, new Date(now.getTime() + 30 * 60_000));
  assert.equal(result.unavailable, 1);
  const rows = (await db.query<{ frequency: number | null }>('SELECT frequency FROM pulse.creative_frequencies')).rows;
  assert.equal(rows[0]!.frequency, null);
  assert.ok(logs.length > 0);
  assert.ok(logs.every(line => !line.includes(inventedToken)));
  assert.equal(data.insights.length, 10);
});

test('frequency cache discards obsolete windows and does no live reads for sample mode', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const data = history(['clip']); let calls = 0;
  const client = reader(async () => { calls++; return 2; });
  await refreshCreativeFrequencies(db, client, 'invented-account', data, now);
  await refreshCreativeFrequencies(db, client, 'invented-account', data, new Date('2026-10-14T12:00:00Z'));
  const dates = (await db.query<{ day: string }>('SELECT to_day::text AS day FROM pulse.creative_frequencies')).rows;
  assert.deepEqual(dates.map(row => row.day), ['2026-10-14']);
  const before = calls; data.mode = 'sample';
  assert.equal((await refreshCreativeFrequencies(db, client, 'invented-account', data, now)).refreshed, 0);
  assert.equal(calls, before);
});
