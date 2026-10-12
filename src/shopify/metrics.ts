import { applySpend, placedSpendRows, usableSpendSources, type AdHeroInputs } from '../ad-spend/metrics.js';
import { sampleSpend } from '../ad-spend/store.js';
import { appConfig } from '../config.js';
import { formatNumber, formatPounds } from '../money.js';
import { addDays, buildHeroRange, dayCount, HeroRangeError, rangeLabel, ukToday, weekdayDate, type DailyMetrics } from '../hero-range.js';
import type { HeroMarket, HeroPeriod } from '../dashboard-types.js';
import type { Order, Inventory, Sessions } from './model.js';
import type { Settings } from '../settings.js';
import type { ShopifyStore } from './store.js';

export type Facts = Awaited<ReturnType<ShopifyStore['facts']>>;
export { paidOrder } from './model.js';
import { isFreeOrder, orderTotalPence, paidOrder } from './model.js';
import { decimalMicros } from '../ad-spend/model.js';
export const ratio = (n: number, d: number): number | null => d > 0 ? n / d : null;
export const kitIds = appConfig.shopify.stockProducts.slice(0, 4).map(p => `gid://shopify/Product/${p.id}`);
export const isKit = (o: Order): boolean => o.lines.some(l => kitIds.includes(l.productId ?? '') || appConfig.shopify.tiktokOrderOnlyProductIds.some(id => l.productId === `gid://shopify/Product/${id}`));
export const isUpgrade = (o: Order): boolean => o.lines.some(l => kitIds.slice(1).includes(l.productId ?? ''));
export const isRefill = (o: Order): boolean => o.lines.some(l => l.sku === 'REFILL' || l.productId === 'gid://shopify/Product/16062800658766');
export { isTikTok } from './order-market.js';
import { isTikTok, orderInMarket } from './order-market.js';
export const emailFlow = (o: Order): string | null => {
  if (o.lastVisit?.medium === 'email') {
    const campaign = String(o.lastVisit.campaign ?? '');
    if (appConfig.mailchimp.ignoredUtmCampaigns.some(c => c === campaign)) return null;
    return appConfig.mailchimp.utmCampaigns.find(c => c.campaign === campaign)?.flow ?? 'Unmapped email';
  }
  return o.discountSignals?.includes('REFILLSHIP') ? 'D30 refill (code backup)' : o.discountSignals?.includes('SHIPPINGONME') ? 'Day 1 add-ons (code backup)' : null;
};
export function dataset(facts: Facts, today: string) {
  const backfill = facts.jobs.find(j => j.name === 'backfill');
  const from: string = backfill?.state.from ?? today;
  const min: string = !backfill?.state.allOrders && backfill?.state.historyDone ? backfill.state.olderFrom : from;
  const orders = facts.records.filter(r => r.kind === 'order').map(r => r.data as Order)
    .filter(o => o.day >= from && o.day <= today && paidOrder(o));
  const sessions = facts.records.filter(r => r.kind === 'sessions').map(r => r.data as Sessions);
  const inventory = facts.records.filter(r => r.kind === 'inventory').map(r => r.data as Inventory);
  const ready = Boolean(backfill?.state.ordersDone);
  return { from, min, orders, sessions, inventory, ready };
}
export function orderNet(o: Order, from: string, to: string): number {
  return (o.day >= from && o.day <= to ? o.itemsAfterDiscountsPence : 0)
    - o.refunds.filter(r => { const day = ukToday(new Date(r.createdAt)); return day >= from && day <= to; }).reduce((n, r) => n + r.itemsPence, 0);
}
export function dailyRows(facts: Facts, today: string, market: HeroMarket = 'all'): DailyMetrics[] {
  const data = dataset(facts, today);
  const byDay = new Map<string, DailyMetrics>();
  const sessionMap = new Map(data.sessions.map(s => [s.day, s]));
  const history = new Map(facts.records.filter(r => r.kind === 'sales').map(r => [r.data.day, r.data]));
  for (let date = data.min; date <= today; date = addDays(date, 1)) {
    const sessions = sessionMap.get(date);
    const older = market === 'all' && date < data.from ? history.get(date) : null;
    byDay.set(date, { date, net: older ? older.netSalesPence : 0, gross: older?.grossSalesPence ?? 0, grossKnown: date >= data.from || market === 'all' && older?.grossSalesPence !== undefined, o: 0, netKnown: market === 'all' || date >= data.from, countsKnown: date >= data.from, sessionsKnown: !!sessions && (market === 'all' || sessions.marketReliable), uk: 0, us: 0,
      sess: (market === 'uk' ? sessions?.uk : market === 'us' ? sessions?.us : sessions?.sessions) ?? 0, ukS: market === 'us' ? 0 : sessions?.uk ?? 0, usS: market === 'uk' ? 0 : sessions?.us ?? 0, ukM: 0, usM: 0, g: 0, ours: 0 });
  }
  for (const order of data.orders.filter(order => orderInMarket(order, market))) {
    const row = byDay.get(order.day);
    if (row) { row.net += order.itemsAfterDiscountsPence; row.gross = (row.gross ?? 0) + orderTotalPence(order); if (!isFreeOrder(order)) { row.o++; if (order.market === 'UK' && !isTikTok(order)) row.uk++; if (order.market === 'US' && !isTikTok(order)) row.us++; } }
    for (const refund of order.refunds) { const day = ukToday(new Date(refund.createdAt)), row = byDay.get(day); if (row) { row.net -= refund.itemsPence; const grossRefund = refund.totalPence ?? (refund.shippingNetPence === undefined ? null : refund.itemsPence + refund.taxPence + refund.shippingNetPence + (refund.shippingTaxPence ?? 0)); if (grossRefund === null) row.grossKnown = false; else row.gross = (row.gross ?? 0) - grossRefund; } }
  }
  // Accumulate only integer pence, convert once at the display boundary.
  return [...byDay.values()].map(row => ({ ...row, net: row.net / 100, gross: (row.gross ?? 0) / 100 }));
}

function marketHero(facts: Facts, today: string, from: string, to: string, settings: Settings, name?: string, preparedRows?: DailyMetrics[], adInputs?: AdHeroInputs, now = new Date(), market: HeroMarket = 'all'): HeroPeriod {
  const data = dataset(facts, today);
  if (from < data.min || to > today) throw new HeroRangeError();
  const inputs = adInputs ?? { spend: facts.mode === 'sample' ? sampleSpend(data.min, today) : { mode: 'live' as const, rows: [], sources: [], days: [] }, costs: [], estimates: [] };
  const placed = placedSpendRows(inputs.spend, from, to, today, market);
  const spendByDay = new Map<string, typeof placed>();
  const covered = new Map(inputs.spend.sources.map(source => [source.source, new Set(inputs.spend.days.filter(day => day.source === source.source).map(day => day.day))]));
  const usable = usableSpendSources(inputs.spend, from, to, today);
  for (const row of placed) { const group = spendByDay.get(row.day) ?? []; group.push(row); spendByDay.set(row.day, group); }
  const rows = (market === 'all' ? preparedRows ?? dailyRows(facts, today) : dailyRows(facts, today, market)).map(row => {
    const spendRows = spendByDay.get(row.date) ?? [];
    const sum = (test: (r: typeof spendRows[number]) => boolean = () => true) => Number(spendRows.filter(test).reduce((n, r) => n + decimalMicros(r.amount), 0n)) / 1_000_000;
    return { ...row, spendKnown: inputs.spend.mode === 'sample' || usable.length > 0 && usable.every(source => covered.get(source.source)?.has(row.date)), adSpend: sum(), ukM: sum(r => r.source === 'meta' && r.market === 'uk'), usM: sum(r => r.source === 'meta' && r.market === 'us'), g: sum(r => r.source !== 'meta'), ours: sum(r => r.source === 'meta' && r.owner === 'ours') };
  });
  const resolvedName = name ?? (from === today && to === today ? 'today so far' : from === addDays(today,-1) && to === from ? 'yesterday' : to === addDays(today,-1) && from === addDays(today,-7) ? 'last 7 days' : to === addDays(today,-1) && from === addDays(today,-30) ? 'last 30 days' : undefined);
  const hero = buildHeroRange(rows, from, to, { today, name: resolvedName, market, blendedMetaTripwireGbp: settings.blendedMetaTripwireGbp });
  hero.net.n = Math.round(rows.filter(r => r.date >= from && r.date <= to).reduce((n, r) => n + r.net, 0) * 100) / 100;
  hero.net.dp = 2;
  hero.gross = Math.round(hero.gross * 100) / 100;
  if (!data.ready) hero.grossUnavailable = true;
  hero.net.d.extra = [...(hero.net.d.extra ?? []), ['Gross (incl. shipping and tax)', hero.grossUnavailable ? 'Unavailable; older total-sales or refund detail is being refreshed' : formatPounds(hero.gross)]];
  const marketOrders = data.orders.filter(o => orderInMarket(o, market));
  const orders = marketOrders.filter(o => o.day >= from && o.day <= to && !isFreeOrder(o));
  const freeCount = marketOrders.filter(o => o.day >= from && o.day <= to && isFreeOrder(o)).length;
  const days = dayCount(from, to);
  const sessions = data.sessions.filter(s => s.day >= from && s.day <= to);
  const sessionComplete = sessions.length === days;
  const provenance = `Shopify ${facts.mode === 'sample' ? 'sample data' : 'live'} · UK days ${from}–${to}`;
  for (const key of ['net', 'orders', 'aov', 'cr'] as const) {
    hero[key].mode = facts.mode;
    if ((facts.jobs.find(j => j.name === 'poll')?.failures ?? 0) >= 2) hero[key].state = 'info';
    hero[key].d.src = provenance;
    hero[key].d.rule += ' Refunds reduce net sales on their refund UK day. Shipping and tax are excluded. Recently updated orders created before the order backfill window are excluded.';
    if (!data.ready) { hero[key].n = 0; hero[key].unavailable = true; hero[key].state = 'info'; hero[key].ss = 'First backfill in progress'; }
  }
  const count = (market: string) => orders.filter(o => o.market === market && !isTikTok(o)).length;
  const breakdown = `UK ${formatNumber(count('UK'))} · US ${formatNumber(count('US'))} · EU ${formatNumber(count('EU'))} · unknown ${formatNumber(count('unknown'))} · TikTok ${formatNumber(orders.filter(isTikTok).length)} (included)`;
  hero.orders.ss = `${breakdown} · ${formatNumber(Math.round(hero.orders.n / days * 10) / 10)}/day`;
  const lastWorked = facts.jobs.find(j => j.name === 'poll')?.last_success_at;
  const lastLabel = lastWorked ? `Last order poll ${new Date(lastWorked).toISOString()}` : 'First sync pending';
  for (const metric of [hero.net, hero.orders, hero.cr]) metric.d.src += ` · ${lastLabel}`;
  const kitOrders = orders.filter(isKit);
  hero.orders.d.extra = [...(hero.orders.d.extra ?? []), ['Orders by market', breakdown], ['Average order', ratio(hero.net.n, hero.orders.n) === null ? 'No paid orders' : formatPounds(hero.net.n / hero.orders.n)], ['Upgrade rate', kitOrders.length ? `${formatNumber(100 * orders.filter(isUpgrade).length / kitOrders.length, 1)}% · tiers from ordered products` : 'No kit orders'], ['Markets', 'EU and other orders, including unknown and TikTok, show under All only; UK plus US does not add up to All.'], ['Free orders', `${formatNumber(freeCount)} in this period. Free orders (replacements and marketing send-outs at £0) are left out.${marketOrders.some(o => o.tags === undefined) ? ' Some earlier replacement tags are still being refreshed; £0 orders are excluded immediately.' : ''}`], ['Coverage', `Order details from ${data.from}. Earlier sales are store-wide ShopifyQL only; no invented market split.`]];
  const orderLabel = `${formatNumber(hero.orders.n)} ${hero.orders.n === 1 ? 'order' : 'orders'}`;
  hero.sub1 = `${orderLabel}${to === today ? ' so far' : ''}.`;
  if (from === today && to === today) {
    const currentTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(facts.jobs.find(j => j.name === 'poll')?.last_success_at ?? `${today}T00:00:00Z`));
    const yesterday = addDays(today, -1);
    const byNow = marketOrders.filter(o => !isFreeOrder(o) && o.day === yesterday && new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(o.createdAt)) <= currentTime).length;
    hero.orders.ss = data.ready && data.from <= yesterday ? `vs ${formatNumber(byNow)} by this time yesterday` : 'Yesterday comparison unavailable';
    hero.sub1 += data.ready && data.from <= yesterday ? ` ${formatNumber(byNow)} by ${currentTime} UK yesterday (last order poll).` : ' Yesterday comparison unavailable.';
  }
  if (market !== 'all') hero.eyebrow = `${market.toUpperCase()} · ${hero.eyebrow}`;
  if (from < data.from) hero.orders.ss = `${orderLabel} · older market detail unavailable`;
  const totalSessions = sessions.reduce((n, s) => n + (market === 'uk' ? s.uk : market === 'us' ? s.us : s.sessions), 0);
  const marketReliable = sessions.every(s => s.marketReliable) && from >= data.from;
  const usSessions = sessions.reduce((n, s) => n + s.us, 0);
  const ukSessions = sessions.reduce((n, s) => n + s.uk, 0);
  hero.cr.unavailable = !data.ready || !sessionComplete || (market !== 'all' && !marketReliable) || totalSessions === 0 && orders.length > 0;
  hero.cr.n = totalSessions ? Math.round(1000 * hero.orders.n / totalSessions) / 10 : 0;
  hero.cr.dp = 1;
  hero.cr.unavailableLabel = market !== 'all' && !marketReliable ? 'Unknown' : 'No data';
  hero.cr.ss = market !== 'all' && marketReliable && sessionComplete ? `${formatNumber(orders.length)} of ${formatNumber(totalSessions)} sessions` : !sessionComplete ? 'Sessions unavailable for part of this range' : !marketReliable ? 'Market conversion unknown · geo guard' : `UK ${ukSessions ? formatNumber(100 * count('UK') / ukSessions, 1) + '%' : 'unknown'} · US ${usSessions ? formatNumber(100 * count('US') / usSessions, 1) + '%' : 'unknown'}`;
  hero.cr.d.why = `Orders divided by clean Shopify sessions. ${hero.cr.ss}. Only the specified /pages/inside desktop/Google/no-cart phantom traffic is removed. ${sessions.some(s => s.provenance === 'routine_daily') ? 'Routine daily fallback: conversion is daily, not live.' : ''}`;
  applySpend(hero,marketOrders,settings,today,{ ...inputs, market, orderDetailsFrom: data.from, now: inputs.now ?? now });
  const empty = market !== 'all' && data.ready && from >= data.from && orders.length === 0;
  if (empty) {
    const message = `No ${market.toUpperCase()} orders in this period`;
    for (const key of ['net', 'orders', 'aov', ...(!hero.spend.unavailable ? ['cac', 'roas', 'margin', 'profit'] as const : [])] as const) {
      hero[key].ss = `${key === 'margin' || key === 'profit' ? 'store-wide · ' : ''}${message}`;
      hero[key].unavailable = false;
    }
    if (!hero.cr.unavailable) hero.cr.ss = message;
  }
  if (from < data.from) {
    hero.orders.d.why = `Order counts are unknown before ${data.from}; earlier aggregate orders cannot separate free orders.`;
    hero.orders.d.hist = [];
    for (const key of ['orders', 'aov', 'cac', 'cr'] as const) { hero[key].unavailable = true; hero[key].unavailableLabel = 'Unknown'; hero[key].ss = 'Older order detail unavailable; free orders cannot be separated'; }
    if (market !== 'all') for (const key of ['net', 'roas', 'margin', 'profit'] as const) { hero[key].unavailable = true; hero[key].ss = 'Older market sales unavailable'; }
  }
  const periodEmail = orders.filter(o => emailFlow(o) !== null);
  const refill = orders.filter(isRefill);
  const emailNet = marketOrders.filter(o => emailFlow(o) !== null).reduce((n, o) => n + orderNet(o, from, to), 0) / 100;
  const emailDate = (day: string) => `${weekdayDate(day)}${from.slice(0, 4) !== to.slice(0, 4) ? ` ${day.slice(0, 4)}` : ''}`;
  const emailDates = from === to ? emailDate(from) : `${emailDate(from)}–${emailDate(to)}`;
  const ordersByDay = new Map<string, Order[]>();
  for (const order of marketOrders.filter(o => !isFreeOrder(o))) { const list = ordersByDay.get(order.day) ?? []; list.push(order); ordersByDay.set(order.day, list); }
  hero.business = {
    email: { count: periodEmail.length, detail: { why: `${formatNumber(periodEmail.length)} last-visit email orders; ${formatPounds(emailNet)} net sales, ${emailDates}. ${from < '2026-09-27' ? 'Attribution partial before 27 Sep 2026.' : ''}`, rule: 'UTM medium=email, grouped by last-visit campaign; first visit is assisted only. SLABPACK is never an email signal. Sends, reachable-by-email and Mailchimp credit await their source.', src: provenance,
      extra: appConfig.mailchimp.flows.filter(f => f.status === 'live').map(f => [f.name, `${formatNumber(periodEmail.filter(o => emailFlow(o) === f.name).length)} Shopify orders · Mailchimp figures unavailable`]) } },
    refill: { count: refill.length, detail: { why: `${formatNumber(refill.length)} ${refill.length === 1 ? 'order' : 'orders'} containing SKU REFILL in ${rangeLabel(from, to)}.`, rule: 'D30 attribution needs a refill campaign or REFILLSHIP. Early for 4 weeks from first send on 25 Sep 2026; sends threshold awaits Mailchimp. Before launch on 11 Sep 2026 has no refill history.', src: provenance,
      extra: [['D30 email', formatNumber(refill.filter(o => emailFlow(o)?.startsWith('D30 refill')).length)], ['Site / other', formatNumber(refill.filter(o => !emailFlow(o)?.startsWith('D30 refill')).length)], ['Since launch', `${formatNumber(data.orders.filter(o => o.day >= '2026-09-11' && isRefill(o)).length)}${data.from > '2026-09-11' ? ' (partial history)' : ''}`], ['Stock', 'Open Stock and cover for configured warehouse stock.']] } },
    orderDays: rows.filter(r => r.date >= from && r.date <= to).map(r => { const dayOrders = ordersByDay.get(r.date) ?? []; return { day: r.date, UK: dayOrders.filter(o => o.market === 'UK' && !isTikTok(o)).length, US: dayOrders.filter(o => o.market === 'US' && !isTikTok(o)).length, EU: dayOrders.filter(o => o.market === 'EU' && !isTikTok(o)).length, TikTok: dayOrders.filter(isTikTok).length, unknown: dayOrders.filter(o => o.market === 'unknown' && !isTikTok(o)).length, total: r.date >= data.from ? r.o : 0, detailAvailable: r.date >= data.from }; }),
  };
  return hero;
}
/** Period and market are independent; a tap selects a view already carried by the snapshot. */
export function shopifyHero(facts: Facts, today: string, from: string, to: string, settings: Settings, name?: string, preparedRows?: DailyMetrics[], adInputs?: AdHeroInputs, now = new Date()): HeroPeriod {
  const all = marketHero(facts, today, from, to, settings, name, preparedRows, adInputs, now);
  const uk = marketHero(facts, today, from, to, settings, name, undefined, adInputs, now, 'uk');
  const us = marketHero(facts, today, from, to, settings, name, undefined, adInputs, now, 'us');
  return { ...all, markets: { all, uk, us } };
}

export interface StockCover { productId: string; locationId: string; name: string; available: number | null; required: number | null; dailyRate: number | null; cover: number | null; runOut: string | null; basis: string }
export function stockCover(facts: Facts, today: string, settings: Settings): StockCover[] {
  const { orders, inventory, from, ready } = dataset(facts, today);
  const start = addDays(today, -60), end = addDays(today, -1);
  const complete = ready && from <= start;
  const rows: StockCover[] = [];
  for (const location of Object.values(appConfig.shopify.locations)) for (const product of appConfig.shopify.stockProducts) {
    const productId = `gid://shopify/Product/${product.id}`;
    const levels = inventory.filter(i => i.productId === productId && i.locationId === location.id);
    const known = levels.length > 0 && levels.every(l => l.quantities.some(q => q.name === 'available'));
    const available = known ? levels.reduce((n, l) => n + l.quantities.find(q => q.name === 'available')!.quantity, 0) : null;
    // Unfulfilled orders have no authoritative warehouse allocation: do not guess from market.
    const sold = orders.filter(o => o.day >= start && o.day <= end && o.fulfillments.some(f => f.status === 'SUCCESS' && f.locationId === location.id));
    const allocatedQuantity = (o: Order, ids: string[]): number => o.fulfillments.filter(f => f.status === 'SUCCESS' && f.locationId === location.id).reduce((n, f) => n + (f.lines ?? []).filter(l => o.lines.some(item => item.id === l.lineId && ids.includes(item.productId ?? ''))).reduce((sum, l) => sum + l.quantity, 0), 0);
    const allocationComplete = sold.every(o => o.fulfillments.every(f => f.status !== 'SUCCESS' || f.lines !== null));
    const quantity = sold.reduce((n, o) => n + allocatedQuantity(o, [productId]), 0);
    const rate = complete && allocationComplete && settings.seasonalMultiplier !== null ? quantity / 60 * settings.seasonalMultiplier : null;
    const kits = kitIds.includes(productId);
    const remainingKits = inventory.filter(i => kitIds.includes(i.productId) && i.locationId === location.id).reduce((n, i) => n + (i.quantities.find(q => q.name === 'available')?.quantity ?? 0), 0);
    const kitQuantity = sold.reduce((n, o) => n + allocatedQuantity(o, kitIds), 0);
    const required = !kits && complete && allocationComplete && kitQuantity > 0 ? quantity / kitQuantity * remainingKits : null;
    const cover = kits && available !== null && rate !== null && rate > 0 ? available / rate : null;
    rows.push({ productId, locationId: location.id, name: `${product.name} · ${location.name}`, available, required, dailyRate: rate, cover,
      runOut: cover !== null ? addDays(today, Math.floor(cover)) : null,
      basis: kits ? '60 complete UK days × seasonal multiplier; fulfilled warehouse orders only. Series 1: run-out, no restock.' : `Attach rate × remaining kits: ${required === null ? 'unknown' : formatNumber(Math.ceil(required)) + ' needed'}. Accessories have no daily-rate cover.` });
  }
  return rows;
}
