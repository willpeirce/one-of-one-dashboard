import assert from 'node:assert/strict';
import test from 'node:test';
import { addDays } from '../src/hero-range.js';
import { calculateSeriesPace, paceDate, sampleSeriesPace, type SeriesPaceDay, type SeriesPaceInput } from '../src/series-pace/model.js';

const today = '2026-10-10';
const days = (sold: number[]): SeriesPaceDay[] => sold.map((quantity, index) => ({
  day: addDays(today, index - sold.length), sold: quantity, source: 'snapshot',
}));
const pace = (sold: number[], overrides: Partial<SeriesPaceInput> = {}) => calculateSeriesPace({
  today, targetDate: addDays(today, 10), stock: 100, days: days(sold), ...overrides,
});
const close = (actual: number | null, expected: number) => assert.ok(actual !== null && Math.abs(actual - expected) < 1e-10, `${actual} differs from ${expected}`);

test('invented UK example stays on pace with the full precision projection and upward trend', () => {
  const result = sampleSeriesPace(`${today}T12:00:00Z`).UK;
  assert.equal(result.daysLeft, 120);
  assert.equal(result.average, 15);
  close(result.needed, 1850 / 120);
  close(result.projectedDays, 1850 / 15);
  assert.equal(result.projectedDate, addDays(today, 123));
  close(result.gap, -10 / 3);
  close(result.needle, -10 / 3);
  assert.equal(result.status, 'on_pace');
  assert.equal(result.state, 'good');
  assert.equal(result.verdict, 'ON PACE');
  assert.match(result.outcome, /50 kits left.*3 days late/);
  assert.equal(result.estimatedKits, 50);
  assert.equal(result.correction, 'sell about 0.4 more a day');
  close(result.trendAverage, 46 / 3);
  assert.equal(result.trend, 'up');
  assert.equal(result.averageLabel, '7-day average');
});

test('invented US example is too slow with the expected deficit, correction and downward trend', () => {
  const result = sampleSeriesPace(`${today}T12:00:00Z`).US;
  assert.equal(result.daysLeft, 90);
  assert.equal(result.average, 17);
  close(result.needed, 2400 / 90);
  close(result.gap, 90 - 2400 / 17);
  assert.equal(result.status, 'too_slow');
  assert.equal(result.state, 'warn');
  assert.equal(result.verdict, 'TOO SLOW');
  assert.match(result.outcome, /870 kits left.*51 days late/);
  assert.equal(result.estimatedKits, 870);
  assert.equal(result.correction, 'sell about 9.7 more a day');
  assert.equal(result.trendAverage, 15);
  assert.equal(result.trend, 'down');
});

test('sample dates follow the UK date of sampleNow and do not require Settings', () => {
  const result = sampleSeriesPace('2026-10-10T23:30:00Z');
  assert.equal(result.UK.today, '2026-10-11');
  assert.equal(result.UK.targetDate, addDays('2026-10-11', 120));
  assert.equal(result.US.targetDate, addDays('2026-10-11', 90));
  assert.deepEqual(result.UK.days.map(day => day.sold), [18, 12, 16, 13, 14, 16, 16]);
});

test('five days either side is on pace, while the full precision gap decides the next band', () => {
  for (const gap of [-5, 0, 5]) {
    const result = pace([100 / (10 - gap)]);
    assert.equal(result.status, 'on_pace');
    assert.equal(result.state, 'good');
  }
  assert.equal(pace([100 / 15.01]).status, 'too_slow');
  const fast = pace([100 / 4.99]);
  assert.equal(fast.status, 'too_fast');
  assert.equal(fast.state, 'warn');
  assert.match(fast.outcome, /5 days early, about 100 kits short/);
  assert.match(fast.correction, /fewer a day$/);
});

test('needles clamp at both ends without changing the actual gap or making a red state', () => {
  const slow = pace([0.1]);
  assert.equal(slow.needle, -90);
  assert.equal(slow.gap, -990);
  const fast = pace([100], { targetDate: addDays(today, 150) });
  assert.equal(fast.needle, 90);
  assert.equal(fast.gap, 149);
  assert.equal(slow.state, 'warn');
  assert.equal(fast.state, 'warn');
});

test('two non-positive complete days pause the card and count only those paused days as zero', () => {
  const result = pace([-7, 10, -3, 0]);
  assert.equal(result.status, 'paused');
  assert.equal(result.verdict, 'PAUSED');
  assert.equal(result.average, 0.75);
  assert.equal(result.trendAverage, 10 / 3);
  assert.deepEqual(result.days.map(day => day.sold), [-7, 10, -3, 0]);
  assert.equal(pace([0, 0]).average, 0);
  assert.equal(pace([-2, -1]).average, 0);
  assert.equal(pace([0]).status, 'too_slow');
});

test('a missing complete day is unknown and does not invent a zero or infer a pause', () => {
  const result = pace([], { days: [
    { day: addDays(today, -3), sold: -5, source: 'snapshot' },
    { day: addDays(today, -1), sold: 0, source: 'shopifyql' },
  ] });
  assert.equal(result.status, 'too_slow');
  assert.equal(result.average, -2.5);
  assert.equal(result.dayCount, 2);
  assert.equal(result.averageLabel, '2-day average');
});

test('zero or negative average without a pause has no sell-out date and keeps all stock as the deficit', () => {
  for (const sold of [[-6, 6], [-8, 3]]) {
    const result = pace(sold, { stock: 107 });
    assert.equal(result.status, 'too_slow');
    assert.equal(result.needle, -90);
    assert.equal(result.projectedDays, null);
    assert.equal(result.projectedDate, null);
    assert.equal(result.gap, null);
    assert.equal(result.estimatedKits, 107);
    assert.match(result.outcome, /no sell-out at this pace.*107 kits left/);
  }
});

test('the target date reaching today or passing removes the pace verdict', () => {
  for (const offset of [0, -1]) {
    const result = pace([10], { targetDate: addDays(today, offset) });
    assert.equal(result.daysLeft, offset);
    assert.equal(result.status, 'target_reached');
    assert.equal(result.verdict, 'Target date reached');
    assert.equal(result.needed, null);
    assert.equal(result.correction, '');
  }
});

test('zero and negative stock are sold out in amber, including before or after the target', () => {
  for (const stock of [0, -2]) {
    const result = pace([], { stock });
    assert.equal(result.status, 'sold_out');
    assert.equal(result.state, 'warn');
    assert.equal(result.verdict, 'Sold out');
    assert.equal(result.outcome, '10 days before the target');
  }
  assert.equal(pace([10], { stock: 0, targetDate: today }).outcome, 'On the target date');
  assert.equal(pace([10], { stock: 0, targetDate: addDays(today, -2) }).outcome, '2 days after the target');
});

test('without a complete day the card waits, and missing stock is never treated as sold out', () => {
  const result = pace([], { days: [{ day: today, sold: 500, source: 'shopifyql' }] });
  assert.equal(result.status, 'waiting');
  assert.equal(result.verdict, 'Waiting for the first complete day');
  assert.equal(result.average, null);
  assert.equal(result.projectedDate, null);
  assert.equal(result.dayCount, 0);
  assert.equal(result.trendAverage, null);
  assert.equal(pace([10], { stock: null }).status, 'stock_unknown');
});

test('only the last seven complete UK calendar days count, even when the input has today and older days', () => {
  const facts: SeriesPaceDay[] = [
    { day: addDays(today, -8), sold: 900, source: 'shopifyql' },
    ...days([10, 11, 9]),
    { day: today, sold: 700, source: 'snapshot' },
    { day: addDays(today, 1), sold: 800, source: 'snapshot' },
  ];
  const result = pace([], { days: facts.slice().reverse() });
  assert.equal(result.average, 10);
  assert.equal(result.dayCount, 3);
  assert.equal(result.averageLabel, '3-day average');
  assert.equal(result.completeThrough, '2026-10-09');
  assert.deepEqual(result.days, days([10, 11, 9]));
});

test('deficits round to the nearest ten and corrections to one decimal only for display', () => {
  const below = pace([11.49]);
  const tie = pace([11.5]);
  assert.equal(below.estimatedKits, 10);
  assert.equal(tie.estimatedKits, 20);
  assert.equal(below.correction, 'sell about 1.5 fewer a day');
  close(below.correctionPerDay, 1.49);
  assert.equal(pace([10.04]).correction, 'hold this pace');
  assert.equal(pace([9.96]).correction, 'hold this pace');
  assert.equal(pace([9.94]).correction, 'sell about 0.1 more a day');
  assert.equal(pace([10.06]).correction, 'sell about 0.1 fewer a day');
});

test('the trend needs three days, compares at one decimal, and never changes the verdict', () => {
  assert.equal(pace([10, 20]).trendAverage, null);
  const equal = pace([10.01, 9.99, 10, 10]);
  assert.equal(equal.trend, null);
  const up = pace([9, 10, 10, 11]);
  const down = pace([11, 10, 10, 9]);
  assert.equal(up.average, down.average);
  assert.equal(up.status, down.status);
  assert.equal(up.trend, 'up');
  assert.equal(down.trend, 'down');
});

test('UK date arithmetic does not lose a day across autumn or spring clock changes', () => {
  for (const dates of [
    { today: '2026-10-24', targetDate: '2026-10-26' },
    { today: '2027-03-27', targetDate: '2027-03-29' },
  ]) assert.equal(pace([10], dates).daysLeft, 2);
  assert.equal(paceDate('2027-03-29'), '29 Mar 2027');
});
