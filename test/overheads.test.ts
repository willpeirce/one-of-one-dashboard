import assert from 'node:assert/strict';
import test from 'node:test';
import { monthlyOverheadTotal, overheadsForPeriod, sampleOverheads, type OverheadItem } from '../src/overheads.js';

// All costs and names in this suite are invented examples.
const item = (changes: Partial<OverheadItem> = {}): OverheadItem => ({
  name: 'Invented monthly service', monthlyGbp: 310, startMonth: '', endMonth: '', ...changes,
});
const later = new Date('2028-12-01T12:00:00Z');
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} ≈ ${expected}`);

test('overheads use calendar months with 28, 29, 30 and 31 days, without rounding each share', () => {
  for (const [month, days] of [['2027-02', 28], ['2028-02', 29], ['2027-04', 30], ['2027-01', 31]] as const) {
    const single = overheadsForPeriod([item()], `${month}-03`, `${month}-03`, later);
    close(single.total, 310 / days);
    assert.deepEqual(single.items, [{ name: 'Invented monthly service', total: single.total }]);
    const whole = overheadsForPeriod([item()], `${month}-01`, `${month}-${days}`, later);
    close(whole.total, 310);
  }
});

test('a range across months sums each month share rather than using an average month', () => {
  const result = overheadsForPeriod([item()], '2027-01-30', '2027-02-02', later);
  close(result.total, 20 + 620 / 28);
});

test('start and inclusive end months choose active items and include an active zero cost', () => {
  const items = [
    item({ name: 'Always applied', monthlyGbp: 310 }),
    item({ name: 'Begins in February', monthlyGbp: 280, startMonth: '2027-02' }),
    item({ name: 'Ends in January', monthlyGbp: 310, endMonth: '2027-01' }),
    item({ name: 'Ended before range', monthlyGbp: 310, endMonth: '2026-12' }),
    item({ name: 'Active without cost', monthlyGbp: 0, startMonth: '2027-02', endMonth: '2027-02' }),
  ];
  const result = overheadsForPeriod(items, '2027-01-31', '2027-02-01', later);
  close(result.total, 30 + 310 / 28);
  assert.deepEqual(result.items.map((row) => row.name), [
    'Always applied', 'Begins in February', 'Ends in January', 'Active without cost',
  ]);
  close(result.items.find((row) => row.name === 'Always applied')!.total, 10 + 310 / 28);
  assert.equal(result.items.find((row) => row.name === 'Ends in January')!.total, 10);
  assert.equal(result.items.find((row) => row.name === 'Begins in February')!.total, 10);
  assert.equal(result.items.find((row) => row.name === 'Active without cost')!.total, 0);
  assert.equal(monthlyOverheadTotal(items, '2027-01'), 620);
  assert.equal(monthlyOverheadTotal(items, '2027-02'), 590);
  assert.equal(monthlyOverheadTotal(items, '2027-03'), 590);
  assert.deepEqual(overheadsForPeriod([], '2027-01-01', '2027-01-31', later), { total: 0, items: [] });
});

test('today accrues only elapsed real UK day time, including both clock changes', () => {
  const cases = [
    { day: '2027-01-12', now: '2027-01-12T12:00:00Z', fraction: 1 / 2 },
    { day: '2026-10-25', now: '2026-10-25T12:00:00Z', fraction: 13 / 25 },
    // London's 2027 short day is 28 March; 29 March is an ordinary 24-hour BST day.
    { day: '2027-03-28', now: '2027-03-28T11:00:00Z', fraction: 11 / 23 },
    { day: '2027-03-29', now: '2027-03-29T11:00:00Z', fraction: 1 / 2 },
  ];
  for (const c of cases) {
    const result = overheadsForPeriod([item()], c.day, c.day, new Date(c.now));
    close(result.total, 10 * c.fraction);
    assert.equal(result.items.length, 1);
  }
});

test('UK date and midnight are used rather than the UTC date, and past days remain complete', () => {
  const now = new Date('2027-07-02T23:30:00Z'); // 00:30 UK on 3 July.
  const result = overheadsForPeriod([item()], '2027-07-02', '2027-07-03', now);
  close(result.total, 10 + 10 / 48);
  close(overheadsForPeriod([item()], '2027-07-03', '2027-07-03', new Date('2027-07-02T23:00:00Z')).total, 0);
});

test('sample overheads are explicitly invented fixed items and fresh on each use', () => {
  assert.deepEqual(sampleOverheads(), [
    { name: 'Software subscriptions', monthlyGbp: 180, startMonth: '', endMonth: '' },
    { name: 'Accountant', monthlyGbp: 150, startMonth: '', endMonth: '' },
    { name: 'Office rent', monthlyGbp: 400, startMonth: '', endMonth: '' },
  ]);
  const copy = sampleOverheads();
  copy[0]!.monthlyGbp = 0;
  assert.equal(sampleOverheads()[0]!.monthlyGbp, 180);
});
