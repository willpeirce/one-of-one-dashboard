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

test('a paginated poll finishing after month-end or UK midnight covers only its fixed query bound',()=>{
  for(const [bound,finished,known,unknown] of [
    ['2026-10-31T23:59:00.000Z','2026-11-01T00:02:00Z','2026-10-30','2026-10-31'],
    ['2026-10-24T22:59:00.000Z','2026-10-24T23:02:00Z','2026-10-23','2026-10-24'],
  ] as const){
    const input=facts();input.jobs[0]!.state.until='2026-10-02T00:00:00Z';
    input.jobs.push({name:'poll',state:{continuing:false,query:`updated_at:>=2026-10-01T00:00:00.000Z updated_at:<=${bound}`},last_success_at:new Date(finished),failures:0});
    const coverage=scorecardCoverage(input,known,unknown,'all');
    assert.deepEqual(coverage.orderCoverage,[known]);assert.deepEqual(coverage.salesCoverage,[known]);
    input.jobs[1]!.state.query=`updated_at:>=${bound} updated_at:<=${finished}`;
    assert.deepEqual(scorecardCoverage(input,known,unknown,'all').orderCoverage,[known,unknown]);
  }
});

test('a present malformed poll query cannot fall back to completion time and invent coverage',()=>{
  for(const query of [null,'','updated_at:>=2026-10-01T00:00:00Z','updated_at:<=invalid',
    'updated_at:>=2026-02-01T00:00:00Z updated_at:<=2026-02-30T12:00:00Z',
    'updated_at:>=invalid updated_at:<=2026-11-01T00:00:00Z',
    'updated_at:>=2026-11-02T00:00:00Z updated_at:<=2026-11-01T00:00:00Z',
    'updated_at:<=2026-11-01T00:00:00Z updated_at:<=2026-11-02T00:00:00Z']){
    const input=facts();input.jobs[0]!.state.until='2026-10-02T00:00:00Z';
    input.jobs.push({name:'poll',state:{continuing:false,query},last_success_at:new Date('2026-11-01T00:02:00Z'),failures:0});
    assert.deepEqual(scorecardCoverage(input,'2026-10-30','2026-10-31','all'),{salesCoverage:[],orderCoverage:[]});
  }
});
