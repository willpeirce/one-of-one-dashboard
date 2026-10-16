import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { AdError, type MetaCampaign, type SpendRow } from '../src/ad-spend/model.js';
import { SPEND_POLL_INTERVAL_MS, SpendWorker } from '../src/ad-spend/worker.js';
import type { CreativeReader } from '../src/creatives/model.js';
import type { Database } from '../src/db.js';
import { defaultSettings } from '../src/settings.js';
import { syncSourceHealth } from '../src/sources.js';
import { createTestDatabase } from './helpers/database.js';

// All account, campaign and spend fixtures are invented; no source requests are made.
const account = '900000007001';
const now = new Date('2026-10-14T12:00:00Z');
const env = () => ({ META_ACCESS_TOKEN: randomBytes(16).toString('hex') });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
const creativeReader = (readCatalogue: CreativeReader['readCatalogue']): CreativeReader => ({
  readCatalogue,
  readInsights: async () => [],
  imageBytes: async () => new Uint8Array(),
  videoFrames: async () => [],
  videoSource: async () => { throw new Error('Unused invented reader'); },
});
const spend = (poll: number): SpendRow => ({
  source: 'meta', accountId: account, campaignId: 'invented-campaign', campaignName: 'Invented UK campaign',
  adSetId: 'invented-ad-set', adSetName: 'Invented UK audience', owner: 'ours', market: 'uk',
  day: '2026-10-14', amount: `${poll * 10}.000000`, currency: 'GBP',
});
const campaign = (poll: number): MetaCampaign => ({
  id: 'invented-campaign', name: `Invented campaign poll ${poll}`, status: 'ACTIVE',
  createdAt: '2026-10-01T12:00:00Z',
});
async function setup(db: Database, sourceEnv: NodeJS.ProcessEnv) {
  await syncSourceHealth(db, sourceEnv);
  await db.query('INSERT INTO pulse.settings(values) VALUES($1)', [JSON.stringify({ ...defaultSettings(), metaAdAccountId: account })]);
  await db.query("INSERT INTO pulse.ad_spend_jobs(source,account_id,backfill_done) VALUES('meta',$1,true)", [account]);
  await db.query('INSERT INTO pulse.creative_jobs(account_id,backfill_done,nightly_day) VALUES($1,true,$2)', [account, '2026-10-14']);
}
async function assertCommittedPoll(db: Database, poll: number, at: Date) {
  const rows = await db.query<{ spend_amount: string; fetched_at: Date | string }>(
    "SELECT spend_amount::text,fetched_at FROM pulse.ad_spend WHERE source='meta' AND account_id=$1", [account],
  );
  assert.equal(rows.rowCount, 1);
  assert.equal(Number(rows.rows[0]!.spend_amount), poll * 10);
  assert.equal(new Date(rows.rows[0]!.fetched_at).toISOString(), at.toISOString());
  const health = (await db.query<{ status: string; last_success_at: Date | string; consecutive_failures: number }>(
    "SELECT status,last_success_at,consecutive_failures FROM pulse.source_health WHERE source='meta'",
  )).rows[0]!;
  assert.equal(health.status, 'healthy');
  assert.equal(health.consecutive_failures, 0);
  assert.equal(new Date(health.last_success_at).toISOString(), at.toISOString());
  const saved = (await db.query<{ name: string; last_seen: Date | string }>(
    'SELECT name,last_seen FROM pulse.meta_campaigns WHERE account_id=$1', [account],
  )).rows[0]!;
  assert.equal(saved.name, campaign(poll).name);
  assert.equal(new Date(saved.last_seen).toISOString(), at.toISOString());
}

test('a pending creative pass lets the next 30-minute spend and campaign poll finish, skips overlap, then restarts next poll', async (t) => {
  const db = await createTestDatabase(), e = env();
  const started = deferred(), release = deferred();
  let worker: SpendWorker | undefined;
  t.after(async () => { release.resolve(); await worker?.stop(); await db.close(); });
  await setup(db, e);
  let clock = now, spendReads = 0, campaignReads = 0, catalogueReads = 0, insightsReads = 0;
  const logs: string[] = [];
  t.mock.method(console, 'info', (line: string) => logs.push(line));
  const source = creativeReader(async function* () {
    catalogueReads++;
    started.resolve();
    await release.promise;
    yield [];
  });
  source.readInsights = async () => { insightsReads++; return []; };
  worker = new SpendWorker(db, e, {
    clock: () => clock, creativeReader: source,
    readers: { meta: {
      read: async () => [spend(++spendReads)],
      readCampaigns: async () => [campaign(++campaignReads)],
    } },
  });
  await worker.waitForCreatives(); // Idle callers do not have to special-case the first poll.
  let tickFinished = false;
  const first = worker.tick('meta').then(() => { tickFinished = true; });
  await started.promise;
  await turn();
  assert.equal(tickFinished, true, 'tick must settle while catalogue is still blocked');
  await first;
  await assertCommittedPoll(db, 1, now);
  await worker.waitForCreativeInsights();
  assert.equal(insightsReads, 3, 'daily read plus the two one-time repair chunks');

  let creativeFinished = false;
  const pending = worker.waitForCreatives().then(() => { creativeFinished = true; });
  clock = new Date(now.getTime() + SPEND_POLL_INTERVAL_MS - 1);
  await worker.tick('meta');
  assert.deepEqual([spendReads, campaignReads, catalogueReads], [1, 1, 1]);
  assert.deepEqual(logs, [], 'only a due poll reports a skipped creative pass');

  clock = new Date(now.getTime() + SPEND_POLL_INTERVAL_MS);
  await worker.tick('meta');
  await assertCommittedPoll(db, 2, clock);
  assert.deepEqual([spendReads, campaignReads, catalogueReads], [2, 2, 1]);
  assert.equal(creativeFinished, false);
  await worker.waitForCreativeInsights();
  assert.equal(insightsReads, 4);
  assert.deepEqual(logs, ['Meta creatives tick skipped: pass still running.']);

  release.resolve();
  await pending;
  assert.equal(insightsReads, 4, 'daily reads continue while the catalogue is pending');
  clock = new Date(now.getTime() + 2 * SPEND_POLL_INTERVAL_MS);
  await worker.tick('meta');
  await worker.waitForCreatives();
  await assertCommittedPoll(db, 3, clock);
  assert.deepEqual([spendReads, campaignReads, catalogueReads, insightsReads], [3, 3, 2, 5]);
  assert.equal(logs.length, 1, 'the completed pass releases the creative guard');
});

test('stop waits for both pending spend and the creative pass that spend starts during shutdown', async (t) => {
  const db = await createTestDatabase(), e = env();
  const spendStarted = deferred(), releaseSpend = deferred(), creativeStarted = deferred(), releaseCreative = deferred();
  let worker: SpendWorker | undefined;
  t.after(async () => { releaseSpend.resolve(); releaseCreative.resolve(); await worker?.stop(); await db.close(); });
  await setup(db, e);
  let clock = now, catalogueReads = 0, insightsReads = 0;
  const source = creativeReader(async function* () {
    catalogueReads++;
    creativeStarted.resolve();
    await releaseCreative.promise;
    yield [];
  });
  source.readInsights = async () => { insightsReads++; return []; };
  worker = new SpendWorker(db, e, {
    clock: () => clock, creativeReader: source,
    readers: { meta: {
      read: async () => { spendStarted.resolve(); await releaseSpend.promise; return [spend(1)]; },
      readCampaigns: async () => [campaign(1)],
    } },
  });
  let tickFinished = false;
  const tick = worker.tick('meta').then(() => { tickFinished = true; });
  await spendStarted.promise;
  let stopped = false;
  const stopping = worker.stop().then(() => { stopped = true; });
  await turn();
  assert.equal(stopped, false, 'shutdown waits for spend already in progress');
  releaseSpend.resolve();
  await creativeStarted.promise;
  await turn();
  assert.equal(tickFinished, true, 'the spend tick settles independently during shutdown');
  await tick;
  assert.equal(stopped, false, 'shutdown must also wait for the newly started creative pass');
  await assertCommittedPoll(db, 1, now);
  releaseCreative.resolve();
  await stopping;
  assert.equal(insightsReads, 3, 'daily read plus the two one-time repair chunks');
  assert.equal((await db.query('SELECT error_code FROM pulse.creative_jobs')).rows[0]!.error_code, null);
  clock = new Date(now.getTime() + SPEND_POLL_INTERVAL_MS);
  await worker.tick('meta');
  assert.equal(catalogueReads, 1, 'shutdown prevents subsequent work');
});

test('a detached catalogue failure logs its stage after zero ads and preserves committed spend and healthy source state', async (t) => {
  const db = await createTestDatabase(), e = env();
  let worker: SpendWorker | undefined;
  t.after(async () => { await worker?.stop(); await db.close(); });
  await setup(db, e);
  const logs: string[] = [];
  let insightsReads = 0;
  t.mock.method(console, 'error', (line: string) => logs.push(line));
  const source = creativeReader(async function* () { throw new AdError('http', 400, 100, 1815001); });
  source.readInsights = async () => { insightsReads++; return []; };
  worker = new SpendWorker(db, e, {
    clock: () => now, creativeReader: source,
    readers: { meta: { read: async () => [spend(1)], readCampaigns: async () => [campaign(1)] } },
  });
  await worker.tick('meta');
  await worker.waitForCreatives();
  await assertCommittedPoll(db, 1, now);
  assert.equal(insightsReads, 3, 'daily read plus the two one-time repair chunks');
  assert.deepEqual(logs, ['Meta creatives read failed (http 400, meta 100/1815001 at catalogue after 0 ads).']);
  const job = (await db.query('SELECT error_code,last_success_at FROM pulse.creative_jobs WHERE account_id=$1', [account])).rows[0]!;
  assert.equal(job.error_code, 'http 400, meta 100/1815001 at catalogue after 0 ads');
  assert.equal(new Date(job.last_success_at as string).toISOString(), now.toISOString());
});

test('spend failure still starts creatives and logs promptly while its detached catalogue is blocked', async (t) => {
  const db = await createTestDatabase(), e = env();
  const started = deferred(), release = deferred();
  let worker: SpendWorker | undefined;
  t.after(async () => { release.resolve(); await worker?.stop(); await db.close(); });
  await setup(db, e);
  const logs: string[] = [];
  let campaignReads = 0, catalogueReads = 0;
  t.mock.method(console, 'error', (line: string) => logs.push(line));
  worker = new SpendWorker(db, e, {
    clock: () => now,
    creativeReader: creativeReader(async function* () {
      catalogueReads++;
      started.resolve();
      await release.promise;
      yield [];
    }),
    readers: { meta: {
      read: async () => { throw new AdError('timeout'); },
      readCampaigns: async () => { campaignReads++; return [campaign(1)]; },
    } },
  });
  let tickFinished = false;
  const tick = worker.tick('meta').then(() => { tickFinished = true; });
  await started.promise;
  await turn();
  assert.equal(tickFinished, true);
  await tick;
  assert.deepEqual([campaignReads, catalogueReads], [1, 1]);
  assert.deepEqual(logs, ['Ad spend meta failed (timeout).']);
  assert.equal((await db.query('SELECT * FROM pulse.ad_spend')).rowCount, 0);
  assert.equal((await db.query('SELECT name FROM pulse.meta_campaigns')).rows[0]!.name, campaign(1).name);
  const healthBefore = (await db.query(
    "SELECT status,last_success_at,consecutive_failures FROM pulse.source_health WHERE source='meta'",
  )).rows[0]!;
  assert.deepEqual(healthBefore, { status: 'error', last_success_at: null, consecutive_failures: 1 });
  release.resolve();
  await worker.waitForCreatives();
  assert.deepEqual((await db.query(
    "SELECT status,last_success_at,consecutive_failures FROM pulse.source_health WHERE source='meta'",
  )).rows[0], healthBefore, 'creative success cannot erase the spend failure');
  assert.deepEqual(logs, ['Ad spend meta failed (timeout).']);
});
