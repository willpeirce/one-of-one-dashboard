import { spendNeeds, type AdHeroInputs } from '../ad-spend/metrics.js';
import type { Database } from '../db.js';
import { addDays, ukToday } from '../hero-range.js';
import type { DashboardSnapshot, Detail, DialModel, Period, State } from '../dashboard-types.js';
import type { Settings } from '../settings.js';
import type { SourceHealth } from '../sources.js';
import { appConfig } from '../config.js';
import { greetingAt } from '../greeting.js';
import { calculateSeriesPace } from '../series-pace/model.js';
import { seriesPaceDates } from '../series-pace/dates.js';
import { readSeriesPaceFacts } from '../series-pace/store.js';
import { sampleSeriesPaceCard, type SeriesPaceCard, type SeriesPaceMarketView } from '../series-pace/presentation.js';
import { formatMetricNumber, formatPounds } from '../money.js';
import { dailyRows, dataset, emailFlow, isRefill, isUpgrade, isKit, kitIds, orderNet, ratio, shopifyHero, stockCover, type Facts, type StockCover } from './metrics.js';
import { blankObservation, evaluateWatchdogs, type Check, type Observation } from './watchdogs.js';

export interface ShopifyDashboard {
  mode: 'sample' | 'live'; checks: Check[]; stock: StockCover[];
  needs: { id: string; state: State; title: string; why: string; link: string; source?: 'j-and-j' }[];
  live: { lastOrder: string; dispatch: string; carts: string };
  detail: Record<string, Detail>;
}
export async function readWatchdogContext(db: Database, facts: Facts) {
  const [observations, holidays] = await Promise.all([
    db.query<{ data: Observation }>('SELECT data FROM pulse.shopify_watchdog_state WHERE mode = $1', [facts.mode]),
    db.query<{ warehouse: string; day: string }>('SELECT warehouse, day::text AS day FROM pulse.bank_holidays'),
  ]);
  return { observation: observations.rows[0]?.data ?? blankObservation(), holidays: holidays.rows };
}
export async function applyShopifyDashboard(snapshot: DashboardSnapshot, db: Database, facts: Facts, settings: Settings, health: SourceHealth[], now: Date, adInputs?:AdHeroInputs, greetingNow: Date = new Date()): Promise<DashboardSnapshot> {
  const today = ukToday(now), data = dataset(facts, today);
  const context = await readWatchdogContext(db, facts);
  const checks = evaluateWatchdogs(facts, now, settings, context.observation, context.holidays, health);
  const stock = stockCover(facts, today, settings);
  const preparedRows = dailyRows(facts, today);
  const ranges: Record<Period, [string, string, string]> = {
    today: [today, today, 'today so far'], yday: [addDays(today, -1), addDays(today, -1), 'yesterday'],
    '7d': [addDays(today, -7), addDays(today, -1), 'last 7 days'], '30d': [addDays(today, -30), addDays(today, -1), 'last 30 days'],
  };
  // The unstarted live backfill still renders all four periods as unavailable.
  for (const [key, [from, to, name]] of Object.entries(ranges)) {
    if (from >= data.min) snapshot.hero[key as Period] = shopifyHero(facts, today, from, to, settings, name, preparedRows, adInputs, now);
    else {
      const hero = shopifyHero(facts, today, today, today, settings, name, preparedRows, adInputs, now);
      hero.from = from; hero.to = to; hero.short = name; hero.eyebrow = `${from}–${to} · history unavailable`;
      for (const metric of [hero.net, hero.orders, hero.cr, hero.spend, hero.roas, hero.margin, hero.profit]) { metric.unavailable = true; metric.ss = 'History unavailable for this range'; }
      for(const dial of [hero.ukcpo,hero.uscpo]){dial.t='—';dial.s='History unavailable for this range';}
      snapshot.hero[key as Period] = hero;
    }
  }
  snapshot.asOf = today; snapshot.bounds = { min: data.min, max: today, today };
  snapshot.textValues.t0026 = { source: ['shopify'], mode: facts.mode, value: new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now) + ' UK' };
  const initial = snapshot.hero.today;
  for (const [key, rawKey, displayKey, subKey] of [['net','t0001','t0038','t0039'],['orders','t0003','t0042','t0043'],['cr','t0004','t0046','t0047'],['spend','t0005','t0050','t0051'],['roas','t0006','t0054','t0055'],['margin','t0007','t0058','t0059']] as const) {
    const metric = initial[key];
    const display = metric.unavailable ? metric.unavailableLabel ?? 'No data' : formatMetricNumber(metric.n, metric);
    for (const [k, value] of [[rawKey,String(metric.n)],[displayKey,display],[subKey,metric.ss]]) snapshot.textValues[k!] = { source: metric.source, mode: metric.mode, value: value! };
  }
  for (const [key, value] of [['t0032',initial.eyebrow],['t0033',greetingAt(greetingNow)],['t0034',initial.sub1],['t0035',''],['t0002',initial.spark.join(',')]]) snapshot.textValues[key!] = { source: ['shopify'], mode: facts.mode, value: value! };
  snapshot.widgets.w001 = { source: initial.ukcpo.source, mode: initial.ukcpo.mode, kind: 'dial', value: initial.ukcpo };
  snapshot.widgets.w002 = { source: initial.uscpo.source, mode: initial.uscpo.mode, kind: 'dial', value: initial.uscpo };
  let pace = sampleSeriesPaceCard(appConfig.shopify.sampleNow);
  if (facts.mode === 'live') {
    const paceFacts = await readSeriesPaceFacts(db, now);
    const marketView = (market: 'UK' | 'US'): SeriesPaceMarketView => {
      const offset = market === 'UK' ? settings.series1UkLandingOffsetDays : settings.series1UsLandingOffsetDays;
      const target = market === 'UK' ? settings.series1UkTargetDate : settings.series1UsTargetDate;
      const dates = seriesPaceDates(settings.series1OrderDate, offset, target)!;
      return { ...calculateSeriesPace({ today, targetDate: dates.targetDate, ...paceFacts[market] }),
        landingDate: dates.landingDate, orderDate: settings.series1OrderDate,
        landingOffsetDays: offset, targetOverride: target || null, snapshots: paceFacts[market].snapshots };
    };
    pace = { markets: { UK: marketView('UK'), US: marketView('US') } } satisfies SeriesPaceCard;
  }
  snapshot.widgets.w017 = { source: ['shopify'], mode: facts.mode, kind: 'series-pace', value: pace };
  const stamp = facts.mode === 'sample' ? 'Shopify sample data' : 'Shopify live';
  const poll = facts.jobs.find(j => j.name === 'poll');
  const freshness = poll?.last_success_at ? `Last worked at ${new Date(poll.last_success_at).toISOString()}` : 'First sync pending';
  const stale = !poll?.last_success_at || now.getTime() - new Date(poll.last_success_at).getTime() > 900_000 || poll.failures >= 2;
  const detail = (why: string, rule: string, extra?: [string, string][]): Detail => ({ why, rule, src: `${stamp} · ${freshness}`, extra });
  const dial = (key: string, label: string, value: number | null, suffix: string, rule: string, why: string, max = 100, zones: DialModel['z'] = [[0, 100, 'info']]) => {
    snapshot.widgets[key] = { source: ['shopify'], mode: facts.mode, kind: 'dial', value: {
      v: value ?? 0, min: 0, max, t: value === null ? 'No data' : `${value.toFixed(1)}${suffix}`, l: label,
      s: value === null ? 'Unknown' : stamp, z: zones, cap: stale || value === null ? 'info' : undefined,
      d: detail(why, rule),
    } };
  };
  const session = data.sessions.find(s => s.day === today);
  const percentage = (n: number, d: number): number | null => ratio(n, d) === null ? null : n / d * 100;
  dial('w029', 'Conversion · UK', session?.marketReliable ? percentage(data.orders.filter(o => o.day === today && o.market === 'UK').length, session.uk) : null, '%', 'Orders ÷ sessions, today so far; guarded market data stays unknown.', 'Country guard: 22–23 September and Missouri >10% mark market conversion unknown.');
  dial('w030', 'Conversion · US', session?.marketReliable ? percentage(data.orders.filter(o => o.day === today && o.market === 'US').length, session.us) : null, '%', 'Orders ÷ sessions, today so far; guarded market data stays unknown.', 'Store-wide conversion remains available independently of the market guard.');
  const weekFrom = addDays(today, -6);
  const weekly = data.orders.filter(o => o.day >= weekFrom);
  const net = data.orders.reduce((n, o) => n + orderNet(o, weekFrom, today), 0);
  const refundPence = data.orders.reduce((n, o) => n + o.refunds.filter(r => ukToday(new Date(r.createdAt)) >= weekFrom && ukToday(new Date(r.createdAt)) <= today).reduce((sum, r) => sum + r.itemsPence, 0), 0);
  dial('w031', 'Refunds 7d', data.ready && data.from <= weekFrom ? percentage(refundPence, net) : null, '%', 'Net item refunds ÷ net sales, 7 UK dates including today so far; over 3% trips.', 'Refund event date, excluding item tax and shipping.', 10, [[0, 3, 'good'], [3, 10, 'warn']]);
  dial('w033', 'Missouri share', session ? percentage(session.missouri, session.us) : null, '%', 'Over 10% marks market conversion unreliable.', 'Clean US sessions only; the precise phantom pattern is excluded.', 100, [[0, 10, 'good'], [10, 100, 'warn']]);
  dial('w034', 'Upgrade rate', data.ready ? percentage(weekly.filter(isUpgrade).length, weekly.filter(isKit).length) : null, '%', 'Orders containing Starter, Ultimate or Duo ÷ kit orders. TikTok duplicate kit orders count.', 'Last seven UK dates, today so far; tier comes from ordered products, never components.');
  // The prototype site ping is not an ingested Shopify metric.
  dial('w032', 'Site response', null, 'ms', 'Storefront probe deferred.', 'No storefront response measurement has been built.');
  const refill = data.orders.filter(isRefill), refillSince = refill.filter(o => o.day >= '2026-09-11');
  const weekEmail = weekly.filter(o => emailFlow(o) !== null);
  const baseline = weekly.filter(o => !o.lastVisit?.fbclid && !o.lastVisit?.gclid && !o.lastVisit?.ttclid && !['cpc', 'paid', 'paid_social'].includes(String(o.lastVisit?.medium)));
  const stats: [string, string, string, string, Detail][] = [
    ['w035', 't0260', 't0261', baseline.length.toString(), detail(`${baseline.length} of ${weekly.length} orders have no last-visit paid signal.`, 'No fbclid/gclid/ttclid and medium not cpc/paid/paid_social; 7 UK dates, today so far.')],
    ['w036', 't0263', 't0264', checks.find(c => c.id === 'webhooks')!.status, detail(checks.find(c => c.id === 'webhooks')!.why, 'Hourly owned-subscription check, five-minute overlap polling backstop.')],
    ['w037', 't0266', 't0267', String(refillSince.length), detail(`${refillSince.length} refill orders since 11 Sep 2026 (${data.from > '2026-09-11' ? 'partial order history' : 'covered'}).`, 'SKU REFILL; email credit from D30 campaign or REFILLSHIP only. Sent/opened figures await Mailchimp.', [['D30 email', String(refillSince.filter(o => emailFlow(o)?.startsWith('D30 refill')).length)], ['Site / other', String(refillSince.filter(o => !emailFlow(o)?.startsWith('D30 refill')).length)], ['Funnel', 'Starts at attributed orders; sends/clicks not available. Early: first 4 weeks from 25 Sep 2026; the sends threshold awaits stage 4.']])],
    ['w039', 't0269', 't0270', String(weekEmail.length), detail(`${weekEmail.length} last-visit email orders in 7 UK dates. ${formatPounds(weekEmail.reduce((n, o) => n + orderNet(o, weekFrom, today), 0) / 100)} net sales.`, 'UTM medium=email, grouped by campaign. Before 27 Sep 2026 is partial, never zero. SLABPACK is not an email signal.', appConfig.mailchimp.flows.filter(f => f.status === 'live').map(f => [f.name, `${weekEmail.filter(o => emailFlow(o) === f.name).length} Shopify orders · sends and Mailchimp credit unavailable`]))],
  ];
  for (const [key, valueKey, subKey, value, d] of stats) {
    snapshot.widgets[key] = { source: ['shopify'], mode: facts.mode, kind: 'detail', value: d };
    snapshot.textValues[valueKey] = { source: ['shopify'], mode: facts.mode, value };
    snapshot.textValues[subKey] = { source: ['shopify'], mode: facts.mode, value: stamp + (key === 'w039' && weekFrom < '2026-09-27' ? ' · attribution partial' : '') };
  }
  const stockDetails: [string, string][] = stock.map(s => [s.name, `Available ${s.available ?? 'unknown'} · cover ${s.cover === null ? 'unknown' : Math.floor(s.cover) + ' days'} · ${s.basis}`]);
  for (const [key, productId, location] of [['w046', kitIds[0], appConfig.shopify.locations.us.id], ['w047', kitIds[0], appConfig.shopify.locations.uk.id], ['w048', 'gid://shopify/Product/10892913574222', appConfig.shopify.locations.us.id]] as const) {
    const row = stock.find(s => s.productId === productId && s.locationId === location)!;
    snapshot.widgets[key] = { source: ['shopify'], mode: facts.mode, kind: 'ring', value: { v: row.cover ?? 0, max: 180,
      t: row.cover === null ? 'No data' : `${Math.floor(row.cover)} d`, l: row.name, s: row.cover === null ? `Available ${row.available ?? 'unknown'} · cover unknown` : `Run-out ${row.runOut}`,
      state: row.cover === null || (facts.jobs.find(j => j.name === 'inventory')?.failures ?? 0) >= 2 || !facts.jobs.find(j => j.name === 'inventory')?.last_success_at || now.getTime() - new Date(facts.jobs.find(j => j.name === 'inventory')!.last_success_at!).getTime() > 900_000 ? 'info' : row.cover < 21 ? 'alarm' : row.cover < 60 ? 'warn' : 'good',
      d: detail(row.basis, 'Kits: available ÷ 60-day warehouse rate × seasonal multiplier. Accessories: attach rate × kits remaining; no guessed daily cover.', stockDetails) } };
  }
  const last = data.orders.filter(o => o.paidAt).sort((a, b) => b.paidAt!.localeCompare(a.paidAt!))[0];
  const detailData = {
    checkout: detail(session ? `${session.sessions} sessions → ${session.carts} carts → ${session.checkouts} checkout starts → ${session.completed} completed. Today so far.` : 'Today’s sessions are unavailable.', 'Completed session checkouts ÷ session checkouts started, by market. Geo guards preserve store-wide totals.', session ? [['UK', session.marketReliable ? `${session.ukCheckouts} started · ${session.ukCompleted} completed · ${percentage(session.ukCompleted, session.ukCheckouts)?.toFixed(1) ?? 'unknown'}%` : 'Unknown · geo guard'], ['US', session.marketReliable ? `${session.usCheckouts} started · ${session.usCompleted} completed · ${percentage(session.usCompleted, session.usCheckouts)?.toFixed(1) ?? 'unknown'}%` : 'Unknown · geo guard']] : []),
    stock: detail('Available stock, cover and run-out by configured product and warehouse.', 'TikTok duplicate stock excluded. Missing rate/multiplier or stock stays unknown. Never plan J&J transfers.', stockDetails),
  };
  const needs = checks.filter(c => c.status === 'tripped').map(c => ({ id: c.id, state: (c.id === 'self' || c.id === 'webhooks' ? 'alarm' : 'warn') as State, title: c.name, why: c.why, link: c.link }));
  for (const row of stock) if (row.cover !== null && row.cover < 60) needs.push({ id: `stock:${row.productId}:${row.locationId}`, state: row.cover < 21 ? 'alarm' : 'warn', title: row.name, why: `${Math.floor(row.cover)} days of cover; run-out ${row.runOut}. Series 1 kits are not restocked.`, link: `https://admin.shopify.com/store/${appConfig.shopify.storeDomain.split('.')[0]}/products/${row.productId.split('/').at(-1)}` });
  for (const row of stock) if (row.available !== null && row.required !== null && row.available < row.required) needs.push({ id: `attach:${row.productId}:${row.locationId}`, state: 'warn', title: row.name, why: `${row.available} available; ${Math.ceil(row.required)} needed at the measured attach rate for remaining kits. Source-owned stock only; TikTok gift stock awaits its source.`, link: `https://admin.shopify.com/store/${appConfig.shopify.storeDomain.split('.')[0]}/products/${row.productId.split('/').at(-1)}` });
  for (const n of facts.noticeDetails) if (['reports_unavailable', 'address_unavailable'].includes(n.kind)) needs.push({ id: n.source_id, state: 'warn', title: n.kind === 'reports_unavailable' ? 'Shopify reports unavailable' : 'Address access unavailable', why: n.kind === 'reports_unavailable' ? 'ShopifyQL was denied. Sessions may be daily routine data or unavailable; older order detail needs read_all_orders. Check granted Level 2 access.' : 'Order markets use currency/warehouse fallback. Check the app’s address permission; no personal address is stored.', link: `https://admin.shopify.com/store/${appConfig.shopify.storeDomain.split('.')[0]}/settings/apps` });
  if(adInputs)needs.push(...spendNeeds(adInputs.spend,settings,today,now));
  needs.sort((a, b) => Number(b.state === 'alarm') - Number(a.state === 'alarm'));
  // Direct Judge.me and advertising examples remain explicitly separate until their parts land.
  snapshot.banner = `${stamp}. Ad spend uses separately labelled source connections; reviews and other stages: sample data; fulfilment uses separately labelled J&J uploads.`;
  snapshot.shopify = { mode: facts.mode, checks, stock, needs, detail: detailData,
    live: { lastOrder: last ? `${Math.max(0, Math.floor((now.getTime() - Date.parse(last.paidAt!)) / 60_000))} min` : 'Unknown', dispatch: checks.find(c => c.id === 'dispatch')!.why, carts: 'Open carts unavailable · session funnel is not a live cart count' } };
  return snapshot;
}
