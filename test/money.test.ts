import assert from 'node:assert/strict';
import test from 'node:test';
import { dashboardPage } from '../src/dashboard-view.js';
import { buildHeroRange } from '../src/hero-range.js';
import { formatLike, formatMetricNumber, formatPounds } from '../src/money.js';
import { getSampleDashboard } from '../src/sample-dashboard.js';

test('shared money formatting puts loss signs first and preserves precision and grouping', () => {
  assert.equal(formatPounds(-10), '-£10.00');
  assert.equal(formatPounds(10), '£10.00');
  assert.equal(formatPounds(0), '£0.00');
  assert.equal(formatPounds(-1234.5), '-£1234.50');
  assert.equal(formatPounds(1234.5), '£1234.50');
  assert.equal(formatPounds(-10.129), '-£10.13');
  assert.equal(formatPounds(0.123456, value => value.toFixed(6)), '£0.123456');
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
  assert.deepEqual(hero.profit.d.extra, [['Net profit', '-£7.50']]);
});
