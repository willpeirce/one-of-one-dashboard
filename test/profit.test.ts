import assert from 'node:assert/strict';
import test from 'node:test';
import { applySpend } from '../src/ad-spend/metrics.js';
import { sampleSpend } from '../src/ad-spend/store.js';
import { addDays, buildHeroRange } from '../src/hero-range.js';
import { profitAndMargin } from '../src/profit.js';
import { defaultSettings } from '../src/settings.js';
import { cleanOrder, type Order } from '../src/shopify/model.js';
import { fixture } from '../src/shopify/sample.js';

test('one unrounded profit total supplies margin without changing the net-sales divisor', () => {
  const result = profitAndMargin({ netSales: 123.45, shippingIncome: 6.25, landedCost: 18.75,
    fulfilment: 7.5, paymentFees: 2.47, adSpend: 15.01, overheads: 300 / 31 });
  const expected = 123.45 + 6.25 - 18.75 - 7.5 - 2.47 - 15.01 - 300 / 31;
  assert.equal(result.profit, expected);
  assert.equal(result.margin, 100 * expected / 123.45);
  assert.equal(profitAndMargin({ netSales: 0, adSpend: 5 }).margin, 0);
  assert.equal(profitAndMargin({ netSales: 0, adSpend: 5 }).profit, -5);
});

test('profit equals the margin numerator for every period and All, UK and US', async (t) => {
  const base = cleanOrder((await fixture('order')).data.order) as Order;
  const settings = { ...defaultSettings(), paymentFeePercent: 2,
    startingCogs: [{ sku: 'invented-profit-kit', unitCostGbp: 10 }],
    overheads: [{ name: 'Invented service', monthlyGbp: 300, startMonth: '', endMonth: '' }],
  };
  const now = new Date('2026-10-09T11:00:00Z'); // Noon UK: exactly half of this day.
  for (const period of [
    { name: 'one day', from: '2026-09-30', to: '2026-09-30' },
    { name: '7 days', from: '2026-10-02', to: '2026-10-08' },
    { name: 'picked range across months', from: '2026-09-28', to: '2026-10-03' },
    { name: 'today so far', from: '2026-10-09', to: '2026-10-09' },
  ]) for (const market of ['all', 'uk', 'us'] as const) await t.test(`${period.name}, ${market}`, () => {
    const dates: string[] = [];
    for (let day = period.from; day <= period.to; day = addDays(day, 1)) dates.push(day);
    const perDayNet = market === 'all' ? 180 : market === 'uk' ? 100 : 80;
    const daily = dates.map((date) => ({ date, net: perDayNet, o: market === 'all' ? 2 : 1,
      uk: market === 'us' ? 0 : 1, us: market === 'uk' ? 0 : 1,
      sess: 20, ukS: 10, ukM: 0, usM: 0, g: 0, ours: 0 }));
    const hero = buildHeroRange(daily, period.from, period.to, { today: '2026-10-09' });
    hero.net.mode = 'live';
    const orders = dates.flatMap((day) => (['uk', 'us'] as const)
      .filter((country) => market === 'all' || country === market)
      .map((country): Order => ({ ...base, id: `invented-profit-${day}-${country}`, day,
        market: country === 'uk' ? 'UK' : 'US', test: false, cancelledAt: null,
        shippingPence: country === 'uk' ? 600 : 700,
        taxPence: 2100, itemTaxPence: 2000, taxesIncluded: country === 'uk',
        lines: [{ ...base.lines[0]!, sku: 'invented-profit-kit', quantity: 1, variantId: null }],
      })));
    const spend = sampleSpend(period.from, period.to);
    spend.mode = 'live';
    spend.sources = spend.sources.map((source) => ({ ...source, live: true, status: 'live', fetchedAt: now.toISOString() }));
    const prototype = spend.rows[0]!;
    spend.rows = dates.flatMap((day) => (['uk', 'us', 'unknown'] as const)
      .filter((country) => market === 'all' || country === market)
      .map((country) => ({ ...prototype, day, market: country,
        campaignId: `invented-profit-${country}`, campaignName: country === 'unknown' ? 'Invented unplaced profit' : `Invented profit ${country.toUpperCase()}`, adSetName: country === 'unknown' ? 'Invented unplaced set' : `Invented profit — ${country.toUpperCase()} — base`, amount: country === 'uk' ? '20.000000' : country === 'us' ? '30.000000' : '3.000000' })));
    applySpend(hero, orders, settings, '2026-10-09', { spend, costs: [], market, now,
      estimates: orders.map((order) => ({ orderId: order.id, costPence: order.market === 'UK' ? 500 : 700, source: 'exact' })) });
    const overhead = market === 'all' ? dates.reduce((sum, day) => sum + 300 / (day.startsWith('2026-09') ? 30 : 31) * (day === '2026-10-09' ? 0.5 : 1), 0) : 0;
    const perDayShipping = market === 'all' ? 12 : market === 'uk' ? 5 : 7;
    const perDayLanded = market === 'all' ? 20 : 10;
    const perDayFulfilment = market === 'all' ? 12 : market === 'uk' ? 5 : 7;
    const perDaySpend = market === 'all' ? 53 : market === 'uk' ? 20 : 30;
    const expected = (perDayNet + perDayShipping - perDayLanded - perDayFulfilment - perDayNet * 0.02 - perDaySpend) * dates.length - overhead;
    assert.ok(Math.abs(hero.profit.n - expected) < 1e-10);
    assert.equal(hero.margin.n, 100 * hero.profit.n / hero.net.n);
    assert.equal(hero.profit.dp, 2);
    assert.equal(hero.profit.pre, '£');
    assert.equal(hero.profit.state, 'est');
    assert.equal(hero.profit.state, hero.margin.state);
    assert.equal(hero.profit.ss, hero.margin.ss);
    assert.equal(hero.profit.unavailable, hero.margin.unavailable);
    assert.equal(hero.profit.mode, hero.margin.mode);
    assert.deepEqual(hero.profit.source, hero.margin.source);
    assert.equal(hero.profit.d.rule, hero.margin.d.rule);
    assert.deepEqual(hero.profit.d.extra!.slice(0, -1), hero.margin.d.extra);
    assert.deepEqual(hero.profit.d.extra!.at(-1), ['Net profit', `£${expected.toFixed(2)}`]);
    assert.equal(hero.profit.d.hist, undefined);
    assert.match(hero.profit.d.why, /same pound total used to calculate net margin/);
    if (market !== 'all') assert.match(hero.profit.ss, /store-wide/);
    if (period.to === '2026-10-09') assert.doesNotMatch(hero.profit.ss, /so far/);
  });
});

test('profit keeps missing costs, unavailable data and losses in the same neutral state as margin', () => {
  const hero = buildHeroRange([{ date: '2026-09-30', net: 10, o: 1, uk: 1, us: 0,
    sess: 10, ukS: 10, ukM: 0, usM: 0, g: 0, ours: 0 }], '2026-09-30', '2026-09-30', { today: '2026-10-09' });
  hero.net.mode = 'live';
  const spend = sampleSpend(hero.from, hero.to);
  spend.rows = [{ ...spend.rows[0]!, amount: '20.000000' }];
  const settings = defaultSettings();
  applySpend(hero, [], settings, '2026-10-09', { spend, costs: [], estimates: [] });
  assert.equal(hero.profit.n, -10);
  assert.equal(hero.profit.state, 'est');
  assert.equal(hero.profit.state, hero.margin.state);
  assert.equal(hero.profit.ss, hero.margin.ss);
  assert.match(hero.profit.ss, /left out: payment fees, older order cost detail, overheads/);
  assert.deepEqual(hero.profit.d.extra!.at(-1), ['Net profit', '-£10.00']);
  applySpend(hero, [], settings, '2026-10-09', { spend: { ...spend, rows: [], sources: [] }, costs: [], estimates: [] });
  assert.equal(hero.profit.unavailable, true);
  assert.equal(hero.profit.unavailable, hero.margin.unavailable);
  assert.equal(hero.profit.unavailableLabel, '—');
});

test('known profit stays visible for free-send losses, negative net sales and zero ad spend', async () => {
  const day = '2026-09-30', now = new Date('2026-10-01T12:00:00Z');
  const free = cleanOrder((await fixture('order-zero-total-paid')).data.order) as Order;
  free.lines = [{ ...free.lines[0]!, sku: 'invented-free-profit-kit', quantity: 2, variantId: null }];
  const settings = { ...defaultSettings(), paymentFeePercent: 0,
    startingCogs: [{ sku: 'invented-free-profit-kit', unitCostGbp: 4 }],
    overheads: [{ name: 'Invented zero service', monthlyGbp: 0, startMonth: '', endMonth: '' }],
  };
  for (const scenario of [
    { net: 0, spend: 0, orders: [free], count: 0, profit: -13 },
    { net: 0, spend: 3, orders: [free], count: 0, profit: -16 },
    { net: -20, spend: 0, orders: [], count: 0, profit: -20 },
    { net: 100, spend: 0, orders: [{ ...free, totalPence: 10000, itemsAfterDiscountsPence: 10000 }], count: 1, profit: 87 },
  ]) {
    const hero = buildHeroRange([{ date: day, net: scenario.net, o: scenario.count, uk: scenario.count, us: 0,
      sess: 100, ukS: 100, ukM: 0, usM: 0, g: 0, ours: 0 }], day, day, { today: '2026-10-01' });
    hero.net.mode = 'live';
    const spend = sampleSpend(day, day);
    spend.mode = 'live';
    spend.sources = spend.sources.map(source => ({ ...source, live: true, status: 'live', fetchedAt: now.toISOString() }));
    spend.rows = scenario.spend ? [{ ...spend.rows[0]!, amount: '3.000000' }] : [];
    const inputs = { spend, costs: [], now, estimates: scenario.orders.map(order => ({ orderId: order.id, costPence: 500, source: 'exact' })) };
    applySpend(hero, scenario.orders, settings, '2026-10-01', inputs);
    assert.equal(hero.profit.n, scenario.profit);
    assert.equal(hero.profit.unavailable, false);
    assert.equal(hero.margin.unavailable, true);
    hero.net.unavailable = true;
    applySpend(hero, scenario.orders, settings, '2026-10-01', inputs);
    assert.equal(hero.profit.unavailable, true);
    hero.net.unavailable = false;
    applySpend(hero, scenario.orders, settings, '2026-10-01', { ...inputs, spend: { ...spend, sources: [] } });
    assert.equal(hero.profit.unavailable, true);
  }
});
