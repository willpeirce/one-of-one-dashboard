import assert from 'node:assert/strict';
import test from 'node:test';
import { dashboardPage } from '../src/dashboard-view.js';
import { buildHeroRange } from '../src/hero-range.js';
import { formatDollars, formatNumber, formatLike, formatMetricNumber, formatPounds } from '../src/money.js';
import { getSampleDashboard } from '../src/sample-dashboard.js';

test('shared money formatting puts loss signs first and preserves precision and grouping', () => {
  assert.equal(formatPounds(-10), '-£10.00');
  assert.equal(formatPounds(10), '£10.00');
  assert.equal(formatPounds(0), '£0.00');
  assert.equal(formatPounds(-1234.5), '-£1,234.50');
  assert.equal(formatPounds(1234.5), '£1,234.50');
  assert.equal(formatPounds(-10.129), '-£10.13');
  assert.equal(formatPounds(0.123456, value => formatNumber(value, 6)), '£0.123456');
  assert.equal(formatMetricNumber(-10, { pre: '£', dp: 2 }), '-£10.00');
  assert.equal(formatMetricNumber(-1234.5, { pre: '£' }), '-£1,234');
  assert.equal(formatMetricNumber(1234.5, { pre: '£' }), '£1,235');
  assert.equal(formatMetricNumber(-12.34, { dp: 1, suf: '%' }), '-12.3%');
  assert.equal(formatMetricNumber(2.34, { dp: 2, suf: '×' }), '2.34×');
});

test('dial and history labels use the same sign rule, including a negative currency example', () => {
  for (const example of ['£0', '-£10.00']) {
    const format = formatLike(example);
    assert.equal(format(-10), '-£10');
    assert.equal(format(10), '£10');
    assert.equal(format(-1234.567), '-£1,234.567');
    assert.equal(format(1234.567), '£1,234.567');
    assert.equal(format(-10.129), '-£10.13');
  }
  assert.equal(formatLike('0%')(-10), '-10%');
});

test('server-rendered net sales and profit use the same formatter as browser metric updates', () => {
  const snapshot = getSampleDashboard();
  snapshot.hero.today.net.n = -10;
  snapshot.hero.today.net.dp = 2;
  snapshot.hero.today.profit.n = -10;
  const html = dashboardPage(snapshot);
  for (const key of ['net', 'profit'] as const) {
    const tile = new RegExp(`<button[^>]*data-k="${key}"[^>]*>([\\s\\S]*?)</button>`).exec(html)?.[1];
    assert.ok(tile);
    assert.ok(tile.includes(formatMetricNumber(-10, snapshot.hero.today[key])));
    assert.ok(tile.includes('-£10.00'));
    assert.ok(!tile.includes('£-'));
  }
});

test('negative net sales in range descriptions keep the sign before pounds', () => {
  const hero = buildHeroRange([{ date: '2026-09-30', net: -10, o: 1, uk: 1, us: 0,
    sess: 10, ukS: 10, ukM: 0, usM: 0, g: 0, ours: 0 }], '2026-09-30', '2026-09-30', { today: '2026-10-09' });
  assert.match(hero.net.d.why, /-£10/);
  assert.match(hero.profit.d.why, /-£7\.50/);
  assert.deepEqual(hero.profit.d.extra, [
    ['Net sales', '-£10.00'], ['Contribution', '-£7.50'], ['Ad spend', '£0.00'],
    ['After ad spend', '-£7.50'], ['Net profit', '-£7.50'],
  ]);
});

test('en-GB display grouping covers decimal money, counts and both currencies', () => {
  for (const [value, expected] of [[0, '0'], [999, '999'], [1000, '1,000'], [1234567.89, '1,234,567.89'], [-1234, '-1,234']] as const)
    assert.equal(formatNumber(value), expected);
  assert.equal(formatNumber(1560, 0), '1,560');
  assert.equal(formatNumber(1.23456789), '1.23456789');
  assert.equal(formatPounds(1234567.89), '£1,234,567.89');
  assert.equal(formatMetricNumber(1234567.89, { pre: '£', dp: 2 }), '£1,234,567.89');
  assert.equal(formatPounds(-1234), '-£1,234.00');
  assert.equal(formatDollars(1234567.89), '$1,234,567.89');
  assert.equal(formatDollars(-1234), '-$1,234.00');
});


test('server-rendered order counts and decimal money are grouped before hydration', () => {
  const snapshot = getSampleDashboard();
  snapshot.hero.today.orders.n = 1560;
  snapshot.hero.today.net.n = 1234567.89;
  snapshot.hero.today.net.dp = 2;
  const html = dashboardPage(snapshot);
  assert.match(html, /1,560<\/span>/);
  assert.match(html, /£1,234,567\.89<\/span>/);
});
