import assert from 'node:assert/strict';
import test from 'node:test';
import { googleShopifyContext } from '../src/google-ads/shopify-coverage.js';
import type { Facts } from '../src/shopify/metrics.js';

function facts(until: string, poll: string | null, continuing = false): Facts {
  return {mode: 'live', sample: false, records: [], noticeDetails: [], counts: {}, notices: [], geoNotice: null, pendingWebhooks: 0, failedWebhooks: [], jobs: [
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

test('paginated Shopify polls keep query coverage separate from recorded freshness across midnight and month end',()=>{
  for(const [bound,finished,through,coveredAfterNextRead] of [
    ['2026-10-31T23:59:00.000Z','2026-11-01T00:02:00.000Z','2026-10-30','2026-10-31'],
    ['2026-10-24T22:59:00.000Z','2026-10-24T23:02:00.000Z','2026-10-23','2026-10-24'],
  ] as const){
    const input=facts('2026-10-02T00:00:00Z',finished);
    input.jobs[1]!.state.query=`updated_at:>=2026-10-01T00:00:00.000Z updated_at:<=${bound}`;
    const context=googleShopifyContext(input,new Date(finished));
    assert.equal(context.through,through);assert.equal(context.lastRead,finished);
    input.jobs[1]!.state.query=`updated_at:>=${bound} updated_at:<=${finished}`;
    assert.equal(googleShopifyContext(input,new Date(finished)).through,coveredAfterNextRead);
  }
});

test('malformed saved poll bounds never fall back to a newer completion time',()=>{
  for(const query of [null,'','updated_at:>=2026-10-01T00:00:00Z','updated_at:<=invalid',
    'updated_at:>=2026-02-01T00:00:00Z updated_at:<=2026-02-30T12:00:00Z',
    'updated_at:>=invalid updated_at:<=2026-11-01T00:00:00Z',
    'updated_at:>=2026-11-02T00:00:00Z updated_at:<=2026-11-01T00:00:00Z',
    'updated_at:<=2026-11-01T00:00:00Z updated_at:<=2026-11-02T00:00:00Z']){
    const input=facts('2026-10-24T12:00:00Z','2026-11-01T00:02:00Z');input.jobs[1]!.state.query=query;
    const context=googleShopifyContext(input,new Date('2026-11-01T00:03:00Z'));
    assert.equal(context.through,'2026-10-23');assert.equal(context.lastRead,'2026-10-24T12:00:00.000Z');
  }
});

test('backfill recorded read time supplies freshness, with a legacy fallback; future reads cannot extend coverage',()=>{
  const now=new Date('2026-10-27T12:00:00Z'),input=facts('2026-10-24T12:00:00Z',null);
  input.jobs[0]!.last_success_at=new Date('2026-10-25T10:00:00Z');
  let context=googleShopifyContext(input,now);assert.equal(context.through,'2026-10-23');assert.equal(context.lastRead,'2026-10-25T10:00:00.000Z');
  input.jobs[0]!.last_success_at=null;context=googleShopifyContext(input,now);assert.equal(context.lastRead,'2026-10-24T12:00:00.000Z');
  input.jobs[1]!.state.query='updated_at:>=2026-10-25T00:00:00Z updated_at:<=2026-10-27T00:00:00Z';
  input.jobs[1]!.last_success_at=new Date('2026-10-28T00:00:00Z');
  context=googleShopifyContext(input,now);assert.equal(context.through,'2026-10-23');assert.equal(context.lastRead,'2026-10-24T12:00:00.000Z');
});

test('a query captured just after the tick timestamp remains valid, but future query bounds stay unknown',()=>{
  const input=facts('2026-10-24T12:00:00Z','2026-10-27T12:00:00.000Z');
  input.jobs[1]!.state.query='updated_at:>=2026-10-27T11:50:00.000Z updated_at:<=2026-10-27T12:00:00.010Z';
  const now=new Date('2026-10-27T12:01:00Z');
  const context=googleShopifyContext(input,now);
  assert.equal(context.through,'2026-10-26');assert.equal(context.lastRead,'2026-10-27T12:00:00.000Z');
  input.jobs[1]!.state.query='updated_at:>=2026-10-27T11:50:00.000Z updated_at:<=2026-10-27T12:02:00.000Z';
  assert.equal(googleShopifyContext(input,now).through,'2026-10-23');
});
