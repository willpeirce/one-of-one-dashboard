import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import type { SpendReader } from '../src/ad-spend/clients.js';
import type { SpendRow } from '../src/ad-spend/model.js';
import { saveSpend, spendFacts, spendHealth } from '../src/ad-spend/store.js';
import { SpendWorker, SPEND_POLL_INTERVAL_MS, SPEND_STALE_AFTER_MS } from '../src/ad-spend/worker.js';
import { defaultSettings } from '../src/settings.js';
import { syncSourceHealth } from '../src/sources.js';
import { createTestDatabase } from './helpers/database.js';

const now = new Date('2026-10-10T12:00:00Z');
const day = '2026-10-10';
const settings = () => ({ ...defaultSettings(), metaAdAccountId: '9000000000' });
const env = () => ({ META_ACCESS_TOKEN: randomBytes(16).toString('hex') });
const row = (): SpendRow => ({
  source: 'meta', accountId: settings().metaAdAccountId,
  campaignId: '900000000901', campaignName: 'Invented Hazel UK',
  adSetId: '900000000902', adSetName: 'Invented Hazel audience',
  market: 'uk', owner: 'ours', day, amount: '16.000000', currency: 'GBP',
});

test('ad freshness uses three missed polls, shares Source health status and gives failures precedence', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  const s = settings(), e = env();
  await db.query('INSERT INTO pulse.ad_spend_jobs(source,account_id,backfill_done) VALUES ($1,$2,true)', ['meta', s.metaAdAccountId]);
  const firstAttempt = new Date(now.getTime() - SPEND_STALE_AFTER_MS - 60_000);
  await db.query('UPDATE pulse.ad_spend_jobs SET last_poll_at=$1', [firstAttempt]);
  const pending = (await spendFacts(db, s, e, 'live', day, day, now)).sources[0]!;
  assert.equal(pending.status, 'first sync pending');
  assert.equal(pending.stale, false);
  assert.equal(pending.fetchedAt, null);
  assert.equal(pending.lastAttemptAt, firstAttempt.toISOString());
  await saveSpend(db, 'meta', s.metaAdAccountId, day, day, [row()], now);
  assert.equal(SPEND_STALE_AFTER_MS, 3 * SPEND_POLL_INTERVAL_MS);
  for (const minutes of [89, 90, 91]) {
    const success = new Date(now.getTime() - minutes * 60_000);
    await db.query('UPDATE pulse.ad_spend_jobs SET last_success_at=$1', [success]);
    const source = (await spendFacts(db, s, e, 'live', day, day, now)).sources[0]!;
    const health = (await spendHealth(db, e, s, now))[0]!;
    assert.equal(source.stale, minutes > 90);
    assert.equal(source.ready, true);
    assert.equal(source.fetchedAt, success.toISOString());
    assert.equal(source.status, minutes > 90 ? 'stale · last fetched 10 Oct 2026, 11:29 UK' : 'live');
    assert.equal(health.status, source.status);
    assert.equal(health.fetchedAt, source.fetchedAt);
  }
  await db.query('UPDATE pulse.ad_spend_jobs SET failures=1');
  const unavailable = (await spendFacts(db, s, e, 'live', day, day, now)).sources[0]!;
  assert.equal(unavailable.status, 'source unavailable');
  assert.equal(unavailable.failures, 1);
  assert.equal(unavailable.stale, true);
  const health = (await spendHealth(db, e, s, now))[0]!;
  assert.equal(health.status, unavailable.status);
  assert.equal(health.failures, unavailable.failures);
});

test('a stale source is ready only for a stored range, including a successfully fetched zero-spend day', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  const s = settings(), e = env(), success = new Date(now.getTime() - SPEND_STALE_AFTER_MS - 60_000);
  await db.query('INSERT INTO pulse.ad_spend_jobs(source,account_id,last_success_at,backfill_done) VALUES ($1,$2,$3,true)', ['meta', s.metaAdAccountId, success]);
  assert.equal((await spendFacts(db, s, e, 'live', day, day, now)).sources[0]!.ready, false);
  await saveSpend(db, 'meta', s.metaAdAccountId, day, day, [row()], success);
  assert.equal((await spendFacts(db, s, e, 'live', day, day, now)).sources[0]!.ready, true);
  await saveSpend(db, 'meta', s.metaAdAccountId, day, day, [], success);
  const zero = await spendFacts(db, s, e, 'live', day, day, now);
  assert.equal(zero.rows.length, 0);
  assert.equal(zero.days.length, 1);
  assert.equal(zero.sources[0]!.ready, true);
  assert.equal((await spendFacts(db, s, e, 'live', '2026-10-09', '2026-10-09', now)).sources[0]!.ready, false);
});

test('wrapping a spend reader with a throwing extra read preserves committed rows, live health and poll cadence', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  const s = settings(), e = env(), calls: string[] = [], logs: string[] = [];
  const extraObservations: { rows: number; status: string }[] = [];
  let clock = now;
  t.mock.method(console, 'error', (message: string) => logs.push(message));
  await syncSourceHealth(db, e);
  await db.query('INSERT INTO pulse.settings(values) VALUES($1)', [JSON.stringify(s)]);
  await db.query('INSERT INTO pulse.ad_spend_jobs(source,account_id,backfill_done,failures) VALUES ($1,$2,true,2)', ['meta', s.metaAdAccountId]);
  const primary: SpendReader = { read: async () => { calls.push('spend'); return [row()]; } };
  const wrapped: SpendReader = {
    ...primary,
    readCampaigns: async () => {
      calls.push('extra');
      extraObservations.push({
        rows: (await db.query('SELECT * FROM pulse.ad_spend')).rowCount,
        status: (await spendHealth(db, e, s, clock))[0]!.status,
      });
      throw new Error('invented extra read failure');
    },
  };
  const worker = new SpendWorker(db, e, { clock: () => clock, readers: { meta: wrapped } });
  t.after(() => worker.stop());
  await worker.tick('meta');
  assert.deepEqual(calls, ['spend', 'extra']);
  clock = new Date(now.getTime() + SPEND_POLL_INTERVAL_MS - 1);
  await worker.tick('meta');
  assert.deepEqual(calls, ['spend', 'extra'], 'the gate suppresses both reads before the next poll');
  clock = new Date(now.getTime() + SPEND_POLL_INTERVAL_MS);
  await worker.tick('meta');
  assert.deepEqual(calls, ['spend', 'extra', 'spend', 'extra']);
  assert.deepEqual(extraObservations, [{ rows: 1, status: 'live' }, { rows: 1, status: 'live' }]);
  const facts = await spendFacts(db, s, e, 'live', day, day, clock);
  assert.equal(facts.rows[0]!.amount, row().amount);
  assert.equal(facts.sources[0]!.status, 'live');
  assert.equal(facts.sources[0]!.fetchedAt, clock.toISOString());
  assert.equal(facts.sources[0]!.failures, 0);
  const health = (await db.query<{ status: string; consecutive_failures: number }>("SELECT status,consecutive_failures FROM pulse.source_health WHERE source='meta'")).rows[0]!;
  assert.deepEqual(health, { status: 'healthy', consecutive_failures: 0 });
  assert.deepEqual(logs, ['Meta campaigns read failed (unknown).', 'Meta campaigns read failed (unknown).']);
});
