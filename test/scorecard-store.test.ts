import assert from 'node:assert/strict';
import test from 'node:test';
import type { Facts } from '../src/shopify/metrics.js';
import { scorecardCoverage } from '../src/scorecard/store.js';

function facts(overrides: Partial<Facts> = {}): Facts {
  return { mode: 'live', sample: false, counts: {}, jobs: [{ name: 'backfill', state: { ordersDone: true, from: '2026-10-01', until: '2026-11-01T00:00:00Z' }, last_success_at: new Date('2026-11-01T00:00:00Z'), failures: 0 }],
    records: [{ kind: 'sales', data: { day: '2026-09-29', netSalesPence: 12500 }, fetched_at: new Date('2026-11-01T00:00:00Z') }], notices: [], noticeDetails: [], geoNotice: null, pendingWebhooks: 0, ...overrides };
}

test('scorecard coverage requires actual aggregate rows and keeps unknown market history separate', () => {
  const all = scorecardCoverage(facts(), '2026-09-29', '2026-10-02', 'all');
  assert.deepEqual(all.salesCoverage, ['2026-09-29', '2026-10-01', '2026-10-02']);
  assert.deepEqual(all.orderCoverage, ['2026-10-01', '2026-10-02']);
  assert.deepEqual(scorecardCoverage(facts(), '2026-09-29', '2026-10-02', 'uk').salesCoverage, all.orderCoverage);
});

test('unfinished backfill and partially read polls cannot claim complete order days', () => {
  const empty = facts({ jobs: [{ name: 'backfill', state: { ordersDone: false, from: '2026-10-01', until: '2026-11-01T00:00:00Z' }, last_success_at: null, failures: 0 }] });
  assert.deepEqual(scorecardCoverage(empty, '2026-10-01', '2026-10-31', 'all'), { salesCoverage: [], orderCoverage: [] });
  const partial = facts(); partial.jobs[0]!.state.until = '2026-10-25T00:00:00Z';
  partial.jobs.push({ name: 'poll', state: { continuing: true }, last_success_at: new Date('2026-11-01T00:00:00Z'), failures: 0 });
  assert.deepEqual(scorecardCoverage(partial, '2026-10-24', '2026-10-26', 'all').orderCoverage, ['2026-10-24']);
  partial.jobs[1]!.state.continuing = false;
  assert.deepEqual(scorecardCoverage(partial, '2026-10-24', '2026-10-26', 'all').orderCoverage, ['2026-10-24', '2026-10-25', '2026-10-26']);
});
