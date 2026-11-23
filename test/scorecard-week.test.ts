import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adSources } from '../src/ad-spend/model.js';
import { addDays, dayCount } from '../src/hero-range.js';
import { compareScorecardWeeks, scorecardWeek, type WeekMarketInput } from '../src/scorecard/metrics.js';

const now = new Date('2032-01-04T00:20:00Z');
const window = scorecardWeek(undefined, now);
const dateList = (from: string) => Array.from({ length: 7 }, (_, index) => addDays(from, index));
const dates = [...dateList(window.earlierFrom), ...dateList(window.from)];

test('the default is seven complete UK dates and the comparison aligns weekdays across a year end', () => {
  assert.equal(window.from, '2031-12-28');
  assert.equal(window.to, '2032-01-03');
  assert.equal(dayCount(window.from, window.to), 7);
  assert.equal(dayCount(window.earlierFrom, window.from), 365);
  assert.deepEqual(dateList(window.from).map(day => new Date(day).getUTCDay()), dateList(window.earlierFrom).map(day => new Date(day).getUTCDay()));
  assert.equal(scorecardWeek('2031-12-24', now).to, '2031-12-24');
  assert.throws(() => scorecardWeek('2032-01-04', now), { statusCode: 400 });
  assert.throws(() => scorecardWeek('2031-02-29', now), { statusCode: 400 });
});

function marketInput(market: 'uk' | 'us'): WeekMarketInput {
  return { mode: 'live', market, salesCoverage: dates, orderCoverage: dates,
    dailySales: dates.map(day => ({ day, netSales: 10 })),
    dailyOrders: market === 'uk' ? dates.map(day => ({ day, orders: 2 })) : [],
    spend: { mode: 'live', sources: adSources.map(source => ({ source, live: true, ready: true, status: 'live', fetchedAt: now.toISOString() })),
      days: dates.flatMap(day => adSources.map(source => ({ day, source }))),
      rows: dates.map(day => ({ source: 'meta', accountId: 'invented-account', campaignId: 'invented-campaign',
        campaignName: 'Invented UK Test', adSetId: null, adSetName: null, owner: 'ours', market: 'uk', day, amount: '2.34', currency: 'GBP' })),
    },
  };
}

test('partial earlier coverage stays unknown by metric and platform with a covered current week', () => {
  const input = marketInput('uk');
  const initial = dates[0]!;
  const [result] = compareScorecardWeeks(window, [{
    ...input, salesCoverage: dates.slice(1), spend: { ...input.spend,
      days: input.spend.days.filter(day => !(day.day === initial && day.source === 'meta')) },
  }]);
  assert.equal(result!.current.netSales, 70);
  assert.equal(result!.current.orders, 14);
  assert.equal(result!.current.spend[0]!.amount, 16.38);
  assert.equal(result!.earlier.netSales, null);
  assert.equal(result!.earlier.orders, 14);
  assert.equal(result!.earlier.spend[0]!.amount, null);
  assert.equal(result!.earlier.spend[1]!.amount, 0);
});

test('a fully covered market with no orders shows measured zero on both sides', () => {
  const input = marketInput('us');
  const [row] = compareScorecardWeeks(window, [{ ...input, dailySales: [] }]);
  assert.deepEqual([row!.current.orders, row!.earlier.orders, row!.current.netSales, row!.earlier.netSales], [0, 0, 0, 0]);
  assert.equal(row!.current.spend[0]!.amount, 0);
});
