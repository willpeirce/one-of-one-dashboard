import assert from 'node:assert/strict';
import test from 'node:test';
import { shopifyHero, type Facts } from '../src/shopify/metrics.js';
import { cleanOrder, type Order, type Sessions } from '../src/shopify/model.js';
import { fixture } from '../src/shopify/sample.js';
import { sampleSpend, type SpendFacts } from '../src/ad-spend/store.js';
import { defaultSettings } from '../src/settings.js';
import { addDays, buildHeroRange } from '../src/hero-range.js';
import { dashboardPage } from '../src/dashboard-view.js';
import { getSampleDashboard } from '../src/sample-dashboard.js';
const today = '2026-10-09', date = '2026-10-08', now = new Date('2026-10-09T10:00:00Z');
const settings = { ...defaultSettings(), paymentFeePercent: 0, startingCogs: [{ sku: 'invented-market-kit', unitCostGbp: 2 }], overheads: [{ name: 'Invented service', monthlyGbp: 310, startMonth: '', endMonth: '' }] };
function facts(orders: Order[], reliable = true): Facts {
  const sessions: Sessions[] = [];
  for (let day = '2026-09-01'; day <= today; day = addDays(day, 1)) sessions.push({ day, sessions: 100, uk: 25, us: 50, marketReliable: reliable, carts: 0, checkouts: 0, completed: 0, missouri: 0, ukCarts: 0, usCarts: 0, ukCheckouts: 0, usCheckouts: 0, ukCompleted: 0, usCompleted: 0 });
  return { mode: 'live', sample: false, counts: {}, pendingWebhooks: 0, geoNotice: null, notices: [], noticeDetails: [], jobs: [{ name: 'backfill', state: { from: '2026-09-01', allOrders: true, ordersDone: true }, last_success_at: now, failures: 0 }, { name: 'poll', state: {}, last_success_at: now, failures: 0 }], records: [...orders.map(data => ({ kind: 'order', data, fetched_at: now })), ...sessions.map(data => ({ kind: 'sessions', data, fetched_at: now }))] };
}
async function orders(): Promise<Order[]> {
  const base = cleanOrder((await fixture('order')).data.order);
  return (['UK','US','EU','UK'] as const).map((market, index) => ({ ...base, id: `gid://shopify/Order/${990100 + index}`, day: date, createdAt: `${date}T09:00:00Z`, market, country: market === 'UK' ? 'GB' : market === 'US' ? 'US' : 'DE', itemsAfterDiscountsPence: (index + 1) * 1000, totalPence: (index + 1) * 1000, taxPence: 0, itemTaxPence: 0, shippingPence: 0, tags: [], refunds: [], channel: index === 3 ? 'Invented TikTok shop' : 'Online Store', lines: [{ ...base.lines[0]!, sku: 'invented-market-kit', variantId: null, quantity: 1 }] }));
}
function spend(): SpendFacts {
  const value = sampleSpend('2026-09-01', today), base = value.rows[0]!;
  value.mode = 'live'; value.sources = value.sources.map(source => ({ ...source, live: true, status: 'live' }));
  value.rows = [
    { ...base, day: date, campaignName: 'Invented ambiguous UK US', adSetName: 'Invented set — UK — one', market: 'unknown', amount: '3.000000' },
    { ...base, day: date, campaignName: 'Invented freelancer US', adSetName: 'Invented set — UK — conflicting', owner: 'freelancer', market: 'uk', amount: '5.000000' },
    { ...base, source: 'google-ads', day: date, campaignName: 'Invented search UK', market: 'us', amount: '7.000000' },
    { ...base, source: 'tiktok', day: date, campaignName: 'Invented US discovery', market: 'uk', amount: '11.000000' },
    { ...base, day: date, campaignName: 'Invented unplaced', adSetName: 'Invented unplaced set', market: 'uk', amount: '13.000000' },
  ]; return value;
}
test('all three views carry distinct order/session, spend, ratio and margin facts with TikTok under All only', async () => {
  const rows = await orders();
  const hero = shopifyHero(facts(rows), today, date, date, settings, undefined, undefined, { spend: spend(), costs: [], estimates: rows.map(order => ({ orderId: order.id, costPence: 100, source: 'exact' })), now });
  const { all, uk, us } = hero.markets!;
  assert.equal(all.orders.n, 4); assert.equal(uk.orders.n, 1); assert.equal(us.orders.n, 1);
  assert.equal(all.net.n, 100); assert.equal(uk.net.n, 10); assert.equal(us.net.n, 20);
  assert.equal(uk.cr.n, 4); assert.equal(us.cr.n, 2);
  assert.equal(all.spend.n, 39); assert.equal(uk.spend.n, 10); assert.equal(us.spend.n, 16);
  assert.equal(all.aov.n, 25); assert.equal(uk.aov.n, 10); assert.equal(us.aov.n, 20);
  assert.equal(all.cac.n, 9.75); assert.equal(uk.cac.n, 10); assert.equal(us.cac.n, 16);
  assert.equal(uk.roas.n, 1); assert.equal(us.roas.n, 1.25); assert.equal(uk.ukcpo.v, 3); assert.equal(us.uscpo.v, 5);
  assert.match(uk.eyebrow, /^UK ·/); assert.match(us.eyebrow, /^US ·/); assert.doesNotMatch(all.eyebrow, /^All/);
  assert.match(uk.margin.ss, /store-wide/); assert.equal(uk.margin.statusLabel, 'store-wide');
  assert.match(uk.margin.d.why, /Store-wide: overheads are not split by market until the costs sheet is\./);
  assert.equal(uk.profit.n, -3); assert.equal(us.profit.n, 1); assert.match(uk.spend.ss, /store-wide/);
  assert.equal(all.contribution.n, 88); assert.equal(uk.contribution.n, 7); assert.equal(us.contribution.n, 17);
  for (const view of [all, uk, us]) {
    assert.equal(view.contribution.statusLabel, undefined);
    assert.equal(view.contribution.state, 'est');
    assert.doesNotMatch(view.contribution.ss, /before overheads|store-wide/);
    assert.equal(view.contribution.d.extra!.find(([label]) => label === 'Overheads'), undefined);
  }
  assert.ok(uk.orders.d.extra!.some(([label, text]) => label === 'Markets' && /EU and other.*All only/.test(text)));
  assert.equal(uk.business!.orderDays[0]!.TikTok, 0); assert.equal(all.business!.orderDays[0]!.TikTok, 1);
  assert.equal(all.markets, undefined); assert.equal(uk.markets, undefined); assert.doesNotThrow(() => JSON.stringify(hero));
});
test('geo guard applies to UK/US independently while All stays measured and empty market counts never vanish', async () => {
  const list = await orders(), input = { spend: spend(), costs: [], estimates: [], now };
  const guarded = shopifyHero(facts(list, false), today, date, date, settings, undefined, undefined, input);
  assert.equal(guarded.cr.unavailable, false); assert.equal(guarded.markets!.uk.cr.unavailable, true); assert.equal(guarded.markets!.uk.cr.unavailableLabel, 'Unknown');
  const empty = shopifyHero(facts(list.filter(row => row.market !== 'US')), today, date, date, settings, undefined, undefined, input).markets!.us;
  for (const key of ['net', 'orders', 'aov', 'cac', 'contribution'] as const) { assert.equal(empty[key].n, 0); assert.equal(empty[key].unavailable, false); assert.match(empty[key].ss, /No US orders in this period/); }
  assert.equal(empty.cr.n, 0);
});
test('AOV/CAC comparisons use summed facts and show seven-day averages or previous N days with no red', () => {
  const rows = Array.from({ length: 16 }, (_, index) => ({ date: addDays('2026-09-01', index), net: index < 14 ? 200 : 100, o: index < 14 ? 4 : 1, uk: 1, us: 0, sess: 100, ukS: 10, ukM: index < 14 ? 20 : 25, usM: 0, g: 0, ours: 0 }));
  const one = buildHeroRange(rows, '2026-09-16', '2026-09-16', { today: '2026-09-17' });
  assert.match(one.aov.ss, /7-day avg/); assert.match(one.cac.ss, /7-day avg/); assert.equal(one.aov.state, 'good'); assert.equal(one.cac.state, 'warn');
  const range = buildHeroRange(rows, '2026-09-15', '2026-09-16', { today: '2026-09-17' });
  assert.match(range.aov.ss, /prev 2 days/); assert.match(range.cac.ss, /prev 2 days/); assert.equal(range.aov.n, 100); assert.equal(range.cac.n, 25);
  assert.match(range.cac.d.rule, /Cost per order until first orders can be told apart; no bar of its own yet/);
});
test('server-rendered hero has independent market control, eight ordered cards and a tappable profit strip', () => {
  const snapshot = getSampleDashboard(), html = dashboardPage(snapshot);
  assert.deepEqual(Object.keys(snapshot.hero.today.markets!), ['all', 'uk', 'us']); assert.match(html, /id="market" aria-label="Market"/);
  const grid = html.split('<div class="four hero-grid">')[1]!.split('</div>')[0]!;
  assert.deepEqual([...grid.matchAll(/data-k="([a-z]+)"/g)].map(match => match[1]), ['net', 'orders', 'aov', 'cac', 'cr', 'spend', 'roas', 'margin']);
  assert.doesNotMatch(grid, /class="per"/); assert.match(html, /class="profit-line" data-k="profit"/); assert.ok(html.indexOf('id="p-ads"') < html.indexOf('data-k="ukcpo"'));
});
test('the market switch follows the radar directly before the hero tiles while periods stay above it', () => {
  const html = dashboardPage(getSampleDashboard());
  const period = html.indexOf('id="period"'), radar = html.indexOf('id="radar"');
  const market = html.indexOf('id="market"'), grid = html.indexOf('<div class="four hero-grid">');
  assert.ok(period >= 0 && period < radar && radar < market && market < grid);
  assert.match(html.slice(market, grid), /data-market="us">US<\/button><\/div>\s*$/);
  assert.equal((html.match(/id="market"/g) ?? []).length, 1);
});
test('guarded comparison/chart days never supply market conversion and aggregate history never hides omitted costs', async () => {
  const list = await orders(), stored = facts(list);
  stored.records = stored.records.map(record => record.kind === 'sessions' && record.data.day === '2026-10-07' ? { ...record, data: { ...record.data, marketReliable: false } } : record);
  const uk = shopifyHero(stored, today, date, date, settings, undefined, undefined, { spend: spend(), costs: [], estimates: [], now }).markets!.uk;
  assert.equal(uk.cr.unavailable, false); assert.deepEqual(uk.cr.d.hist, []); assert.equal(uk.cr.state, 'info');
  const historic = facts([]); historic.jobs[0]!.state = { from: date, olderFrom: '2026-09-01', allOrders: false, ordersDone: true, historyDone: true };
  historic.records.push({ kind: 'sales', data: { day: '2026-10-01', netSalesPence: 10000, orders: 5 }, fetched_at: now });
  const older = shopifyHero(historic, today, '2026-10-01', '2026-10-01', settings, undefined, undefined, { spend: spend(), costs: [], estimates: [], now });
  assert.equal(older.orders.unavailable, true); assert.deepEqual(older.orders.d.hist, []); assert.equal(older.business!.orderDays[0]!.total, 0);
  assert.match(older.margin.ss, /older order cost detail/); assert.match(older.profit.ss, /older order cost detail/);
  assert.equal(older.aov.unavailableLabel, 'Unknown');
  assert.equal(older.contribution.unavailable, false);
  assert.match(older.contribution.ss, /^100% of net sales\nEstimate; left out: older order cost detail$/);
  assert.deepEqual(older.contribution.d.extra!.at(-1), ['Contribution an order', 'Unknown']);
  for (const market of ['uk', 'us'] as const) {
    assert.equal(older.markets![market].contribution.unavailable, true);
    assert.deepEqual(older.markets![market].contribution.d.extra!.find(([label]) => label === 'Contribution'), ['Contribution', 'Unknown']);
  }
});
test('the first UK order-detail day never compares or charts an invented earlier market sales split', async () => {
  const list = await orders(), stored = facts(list); stored.jobs[0]!.state = { from: date, olderFrom: '2026-09-01', allOrders: false, ordersDone: true, historyDone: true };
  const uk = shopifyHero(stored, today, date, date, settings, undefined, undefined, { spend: spend(), costs: [], estimates: [], now }).markets!.uk;
  assert.equal(uk.net.n, 10); assert.equal(uk.net.state, 'info'); assert.match(uk.net.ss, /no earlier days to compare/); assert.deepEqual(uk.net.d.hist, []); assert.deepEqual(uk.spark, []);
});
test('market spike notes follow the picked market and CAC never judges a single spike day', () => {
  const rows = Array.from({ length: 8 }, (_, index) => ({ date: addDays('2026-09-17', index), net: 100, o: 1, uk: 1, us: 0, sess: 100, ukS: 100, ukM: index < 7 ? 5 : 20, usM: 0, g: 0, ours: 0 }));
  const uk = buildHeroRange(rows, '2026-09-24', '2026-09-24', { today: '2026-09-25', market: 'uk' });
  assert.equal(uk.cac.state, 'info'); assert.match(uk.cac.d.rule, /Spike days: 24 Sep \(UK\)/);
  const us = buildHeroRange(rows, '2026-09-24', '2026-09-24', { today: '2026-09-25', market: 'us' });
  assert.equal(us.cac.state, 'warn'); assert.doesNotMatch(us.cac.d.rule, /Spike days/); assert.doesNotMatch(us.net.d.rule, /Spike days/);
});
test('CAC never compares or charts a zero for live days whose ad-source coverage is missing', async () => {
  const list = await orders(), inputs = { spend: spend(), costs: [], estimates: [], now }; inputs.spend.days = inputs.spend.days.filter(row => row.day === date);
  for (const source of inputs.spend.sources) source.status = 'backfill running';
  const h = shopifyHero(facts(list), today, date, date, settings, undefined, undefined, inputs);
  assert.equal(h.cac.n, 9.75); assert.equal(h.cac.state, 'info'); assert.match(h.cac.ss, /no earlier days to compare/); assert.deepEqual(h.cac.d.hist, []);
  assert.equal(h.markets!.uk.cac.n, 10); assert.equal(h.markets!.uk.cac.state, 'info'); assert.deepEqual(h.markets!.uk.cac.d.hist, []);
});

test('empty market Contribution remains clear even when no ad spend source is usable', async()=>{
  const missing=spend();missing.sources=missing.sources.map(source=>({...source,status:'source unavailable',failures:2}));missing.rows=[];missing.days=[];
  const hero=shopifyHero(facts([]),today,date,date,settings,undefined,undefined,{spend:missing,costs:[],estimates:[],now});
  for(const market of ['uk','us'] as const){
    assert.equal(hero.markets![market].contribution.ss,`No ${market.toUpperCase()} orders in this period`);
    assert.equal(hero.markets![market].contribution.unavailable,false);
  }
});
