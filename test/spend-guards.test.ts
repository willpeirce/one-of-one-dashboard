import assert from 'node:assert/strict';
import test from 'node:test';
import { applySpend, spendNeeds, type AdHeroInputs } from '../src/ad-spend/metrics.js';
import { sampleSpend, type SpendFacts } from '../src/ad-spend/store.js';
import { SPEND_STALE_AFTER_MS } from '../src/ad-spend/worker.js';
import { addDays, buildHeroRange } from '../src/hero-range.js';
import { defaultSettings } from '../src/settings.js';
import { cleanOrder, type Order } from '../src/shopify/model.js';
import { fixture } from '../src/shopify/sample.js';

// Every order, campaign, account and amount in these cases is invented.
const today = '2026-10-10', day = '2026-10-09', now = new Date('2026-10-10T14:36:00Z');
const settings = { ...defaultSettings(), paymentFeePercent: 0,
  overheads: [{ name: 'Invented free service', monthlyGbp: 0, startMonth: '', endMonth: '' }] };
const prototype = cleanOrder((await fixture('order')).data.order) as Order;
function facts(from = day, to = day): SpendFacts {
  const result = sampleSpend(from, to);
  result.mode = 'live';
  result.sources = result.sources.map((source) => ({ ...source,
    live: source.source !== 'tiktok', ready: source.source !== 'tiktok',
    status: source.source === 'tiktok' ? 'waiting for keys' : 'live',
    fetchedAt: source.source === 'tiktok' ? null : now.toISOString(), failures: 0, stale: false,
  }));
  result.rows = result.rows.filter((row) => row.source !== 'tiktok' && row.market === 'uk' && row.owner !== 'freelancer')
    .map((row) => ({ ...row, amount: '20.000000' }));
  for (let date = from; date <= to; date = addDays(date, 1))
    result.rows.push({ ...result.rows[0]!, source: 'google-ads', day: date,
      accountId: 'invented-google-account', campaignId: 'invented-google-campaign',
      campaignName: 'Invented Google US', market: 'us', owner: 'freelancer', amount: '10.000000' });
  result.days = result.days.filter((row) => row.source !== 'tiktok');
  return result;
}
function calculate(spend: SpendFacts, options: Partial<AdHeroInputs> = {}, from = day, to = day, current = today) {
  const daily = [{ date: from, net: 100, o: 2, uk: 1, us: 1,
    sess: 20, ukS: 10, ukM: 0, usM: 0, g: 0, ours: 0 }];
  for (let date = addDays(from, 1); date <= to; date = addDays(date, 1))
    daily.push({ ...daily[0]!, date, net: 0, o: 0, uk: 0, us: 0 });
  const hero = buildHeroRange(daily, from, to, { today: current });
  hero.net.mode = 'live';
  const orders = (['UK', 'US'] as const).map((market): Order => ({ ...prototype,
    id: `invented-guard-${market}`, day: from, market, test: false, cancelledAt: null,
    lines: [], shippingPence: 0, itemTaxPence: 0, taxPence: 0, refunds: [],
  }));
  applySpend(hero, orders, settings, current, { spend, now, costs: [],
    estimates: orders.map((order) => ({ orderId: order.id, costPence: 0, source: 'exact' })), ...options });
  return hero;
}
function source(spend: SpendFacts, id: 'meta' | 'google-ads' | 'tiktok' = 'meta') {
  return spend.sources.find((row) => row.source === id)!;
}
function failed(spend: SpendFacts, id: 'meta' | 'google-ads' | 'tiktok' = 'meta') {
  Object.assign(source(spend, id), { live: true, status: 'source unavailable', failures: 2 });
  return spend;
}

test('a failed source excludes its cached rows and names the gap on every spend-dependent tile', () => {
  const hero = calculate(failed(facts()));
  assert.equal(hero.spend.n, 10);
  assert.equal(hero.spend.state, 'warn');
  assert.equal(hero.spend.ss, 'Meta missing · total excludes Meta');
  assert.equal(hero.roas.n, 10);
  assert.equal(hero.profit.n, 90);
  assert.equal(hero.margin.n, 90);
  for (const metric of [hero.roas, hero.margin, hero.profit]) {
    assert.equal(metric.state, 'warn');
    assert.equal(metric.ss.split('\n')[0], 'Excludes Meta spend');
    assert.deepEqual(metric.source, ['shopify', 'google-ads']);
    assert.match(metric.d.src, /Excludes Meta spend/);
  }
  for (const dial of [hero.ukcpo, hero.uscpo]) {
    assert.equal(dial.cap, 'warn');
    assert.match(dial.s, /^Excludes Meta spend/);
  }
  assert.equal(hero.ukcpo.t, '£0.00');
  assert.equal(hero.uscpo.t, '£10.00');
  assert.deepEqual(hero.spend.d.extra!.find(([name]) => name === 'Meta ours'), ['Meta ours', '£0.00']);
});

test('per-market calculations use the same excluded source and warning', () => {
  for (const market of ['uk', 'us'] as const) {
    const spend = failed(facts());
    spend.rows = spend.rows.filter((row) => row.market === market);
    const hero = calculate(spend, { market });
    for (const metric of [hero.spend, hero.margin, hero.profit, hero.roas]) assert.equal(metric.state, 'warn');
    assert.match(hero.margin.ss, /^Excludes Meta spend\nEstimate before overheads/);
    assert.equal(hero.spend.n, market === 'uk' ? 0 : 10);
  }
});

test('healthy sources keep the existing totals, subtitles, states and provenance', () => {
  const hero = calculate(facts()), label = 'Meta + Google only; TikTok waiting for keys';
  for (const [key, n, state, ss] of [
    ['spend', 30, 'info', label], ['roas', 100 / 30, 'info', label],
    ['margin', 70, 'est', `Estimate · ${label}`], ['profit', 70, 'est', `Estimate · ${label}`],
  ] as const) {
    const metric = hero[key];
    assert.equal(metric.n, n);
    assert.equal(metric.state, state);
    assert.equal(metric.ss, ss);
    assert.equal(metric.unavailable, false);
    assert.equal(metric.d.src, label);
    assert.deepEqual(metric.source, key === 'spend' ? ['meta', 'google-ads'] : ['shopify', 'meta', 'google-ads']);
  }
  assert.equal(hero.ukcpo.t, '£20.00');
  assert.equal(hero.uscpo.t, '£10.00');
  assert.equal(hero.ukcpo.cap, 'info');
  assert.equal(hero.uscpo.cap, 'info');
  const soFar = calculate(facts(), {}, day, day, day);
  for (const metric of [soFar.spend, soFar.margin, soFar.profit, soFar.roas]) {
    assert.equal(metric.state, 'sofar');
    assert.match(metric.ss, / · so far$/);
  }
});

test('stale sources name UK fetch time; a failure takes precedence and today stays amber', () => {
  const spend = facts();
  Object.assign(source(spend), { stale: true, status: 'stale · last fetched 10 Oct 2026, 14:05 UK', fetchedAt: '2026-10-10T13:05:00Z' });
  let hero = calculate(spend);
  assert.equal(hero.spend.ss, 'Meta stale since 14:05 · total may be low');
  assert.equal(hero.spend.n, 10);
  assert.equal(hero.margin.ss.split('\n')[0], 'Excludes Meta spend');
  hero = calculate(failed(spend), {}, day, day, day);
  assert.equal(hero.spend.ss, 'Meta missing · total excludes Meta · so far');
  for (const metric of [hero.spend, hero.margin, hero.profit, hero.roas]) assert.equal(metric.state, 'warn');
});

test('first sync pending warns immediately without claiming cached rows are current', () => {
  const spend = facts();
  Object.assign(source(spend), { ready: false, fetchedAt: null, status: 'first sync pending' });
  const hero = calculate(spend);
  assert.equal(hero.spend.state, 'warn');
  assert.equal(hero.spend.ss, 'Meta missing · total excludes Meta');
  assert.equal(hero.spend.n, 10);
});

test('shorter source coverage keeps its known spend and names missing days', () => {
  const spend = facts('2026-10-08', day);
  spend.days = spend.days.filter((row) => row.source !== 'meta' || row.day === day);
  spend.rows = spend.rows.filter((row) => row.source !== 'meta' || row.day === day);
  const hero = calculate(spend, {}, '2026-10-08', day);
  assert.equal(hero.spend.n, 40);
  assert.equal(hero.spend.state, 'warn');
  assert.equal(hero.spend.ss, 'Meta missing days · total may be low');
  assert.equal(hero.roas.ss, 'Excludes Meta spend for missing days');
  assert.match(hero.profit.ss, /^Excludes Meta spend for missing days/);
  assert.deepEqual(hero.spend.source, ['meta', 'google-ads']);
});

test('coverage compares the actual days, ignores duplicates and ignores days outside the range', () => {
  const spend = facts('2026-10-08', day);
  spend.days = [{ source: 'meta', day }, { source: 'meta', day },
    { source: 'google-ads', day: '2026-10-08' }, { source: 'google-ads', day: '2026-10-11' }];
  const hero = calculate(spend, {}, '2026-10-08', day);
  assert.equal(hero.spend.ss, 'Meta missing days · total may be low\nGoogle missing days · total may be low');
  assert.equal(hero.roas.ss, 'Excludes Meta spend for missing days\nExcludes Google spend for missing days');
});

test('the same missing day in every fresh source still makes the total partial', () => {
  const spend = facts('2026-10-08', day);
  spend.days = spend.days.filter((row) => row.day === day);
  spend.rows = spend.rows.filter((row) => row.day === day);
  const hero = calculate(spend, {}, '2026-10-08', day);
  assert.equal(hero.spend.n, 30);
  assert.equal(hero.spend.state, 'warn');
  assert.equal(hero.spend.ss, 'Meta missing days · total may be low\nGoogle missing days · total may be low');
  for (const metric of [hero.margin, hero.profit, hero.roas]) {
    assert.equal(metric.state, 'warn');
    assert.match(metric.ss, /^Excludes Meta spend for missing days\nExcludes Google spend for missing days/);
  }
});

test('successful zero-spend coverage is complete; absent coverage cannot silently claim a complete total', () => {
  const spend = facts();
  spend.rows = spend.rows.filter((row) => row.source !== 'meta');
  let hero = calculate(spend);
  assert.equal(hero.spend.state, 'info');
  assert.equal(hero.spend.n, 10);
  spend.days = [];
  spend.rows = [];
  hero = calculate(spend);
  assert.equal(hero.spend.state, 'warn');
  assert.equal(hero.spend.unavailable, true);
  assert.match(hero.spend.ss, /Meta missing days/);
  assert.match(hero.spend.ss, /Google missing days/);
});

test('healthy past backfill retains existing progress behavior, while failures still warn', () => {
  const spend = facts('2026-10-08', day);
  source(spend).status = 'backfill running · next 2026-10-09';
  spend.days = spend.days.filter((row) => row.source !== 'meta');
  spend.rows = spend.rows.filter((row) => row.source !== 'meta');
  const hero = calculate(spend, {}, '2026-10-08', day);
  assert.equal(hero.spend.state, 'info');
  assert.equal(hero.margin.state, 'est');
  assert.match(hero.spend.ss, /backfill running/);
  assert.doesNotMatch(hero.spend.ss, /Excludes|missing days/);
  assert.equal(calculate(failed(spend), {}, '2026-10-08', day).spend.state, 'warn');
});

test('three missing sources cap tile lines at two plus a count, but detail names all three', () => {
  const spend = facts();
  for (const id of ['meta', 'google-ads', 'tiktok'] as const) failed(spend, id);
  const hero = calculate(spend);
  assert.equal(hero.spend.n, 0);
  assert.equal(hero.spend.unavailable, true);
  assert.equal(hero.spend.ss, 'Meta missing · total excludes Meta\nGoogle missing · total excludes Google\n+1 more');
  assert.equal(hero.roas.ss, 'Excludes Meta spend\nExcludes Google spend\n+1 more');
  for (const name of ['Meta', 'Google', 'TikTok']) assert.ok(hero.spend.d.src.includes(`Excludes ${name} spend`));
  for (const metric of [hero.spend, hero.margin, hero.profit, hero.roas]) {
    assert.equal(metric.state, 'warn');
    assert.ok(Number.isFinite(metric.n));
    assert.equal(metric.unavailable, true);
  }
});

test('Needs waits for two failures, names only the source and time, and clears on recovery', () => {
  const spend = failed(facts());
  source(spend).failures = 1;
  assert.deepEqual(spendNeeds(spend, settings, today, now), []);
  source(spend).failures = 2;
  let cards = spendNeeds(spend, settings, today, now);
  assert.deepEqual(cards, [{ id: 'ad-source:meta', state: 'warn', title: 'Meta ad spend not updating',
    why: 'Last fetched 10 Oct 2026, 15:36 UK. Totals that include ad spend leave it out until it recovers. Check Source health.',
    link: '/sources' }]);
  spend.sources.push({ ...source(spend) });
  assert.equal(spendNeeds(spend, settings, today, now).length, 1);
  for (const row of spend.sources.filter((row) => row.source === 'meta'))
    Object.assign(row, { failures: 0, stale: false, status: 'live', fetchedAt: now.toISOString() });
  cards = spendNeeds(spend, settings, today, now);
  assert.deepEqual(cards, []);
});

test('Needs uses three missed polls, including a stalled first attempt, but not fresh pending sources', () => {
  const spend = facts(), meta = source(spend);
  meta.fetchedAt = new Date(now.getTime() - SPEND_STALE_AFTER_MS + 60_000).toISOString();
  assert.equal(spendNeeds(spend, settings, today, now).length, 0);
  meta.fetchedAt = new Date(now.getTime() - SPEND_STALE_AFTER_MS - 60_000).toISOString();
  assert.equal(spendNeeds(spend, settings, today, now)[0]!.id, 'ad-source:meta');
  Object.assign(meta, { fetchedAt: null, ready: false, status: 'first sync pending', lastAttemptAt: now.toISOString() });
  assert.equal(spendNeeds(spend, settings, today, now).length, 0);
  meta.lastAttemptAt = new Date(now.getTime() - SPEND_STALE_AFTER_MS - 60_000).toISOString();
  assert.match(spendNeeds(spend, settings, today, now)[0]!.why, /^Last fetched never\./);
  meta.live = false;
  assert.equal(spendNeeds(spend, settings, today, now).length, 0);
});

test('sample mode never gains a live-source warning or failure card', () => {
  const spend = failed(facts());
  spend.mode = 'sample';
  const hero = calculate(spend);
  assert.equal(hero.spend.state, 'info');
  assert.equal(hero.spend.n, 30);
  assert.equal(hero.margin.state, 'est');
  assert.deepEqual(spendNeeds(spend, settings, today, now), []);
});
