import assert from 'node:assert/strict';
import test from 'node:test';
import { googleShopifyContext } from '../src/google-ads/shopify-coverage.js';
import type { Facts } from '../src/shopify/metrics.js';

function facts(until: string, poll: string | null, continuing = false): Facts {
  return {mode: 'live', sample: false, records: [], noticeDetails: [], counts: {}, notices: [], geoNotice: null, pendingWebhooks: 0, jobs: [
    {name: 'backfill', state: {from: '2026-10-01', until, ordersDone: true}, last_success_at: new Date(until), failures: 0},
    {name: 'poll', state: {continuing}, last_success_at: poll ? new Date(poll) : null, failures: 0},
  ]};
}
test('Google comparison coverage uses completed reads, never a partial poll or an old ready flag', () => {
  const now = new Date('2026-10-27T12:00:00Z');
  const old = facts('2026-10-24T12:00:00Z', '2026-10-27T11:00:00Z', true);
  assert.equal(googleShopifyContext(old, now).ready, true);
  assert.equal(googleShopifyContext(old, now).through, '2026-10-23');
  old.jobs[1]!.state.continuing = false;
  assert.equal(googleShopifyContext(old, now).through, '2026-10-26');
  assert.equal(googleShopifyContext(old, now).lastRead, '2026-10-27T11:00:00.000Z');
  old.jobs[1]!.last_success_at = new Date('2026-10-28T11:00:00Z');
  assert.equal(googleShopifyContext(old, now).through, '2026-10-23');
});
test('completed Shopify days follow UK midnight over the October clock change', () => {
  for (const [at, through] of [['2026-10-24T23:30:00Z', '2026-10-24'], ['2026-10-25T23:30:00Z', '2026-10-24'], ['2026-10-26T00:00:00Z', '2026-10-25']]) {
    assert.equal(googleShopifyContext(facts(at!, null), new Date(at!)).through, through);
  }
});
