import { addDays, spikeMarkets, ukToday } from '../hero-range.js';
import { adNames, adSources, decimalMicros, type AdSource } from '../ad-spend/model.js';
import { spendMarket } from '../ad-spend/placement.js';
import type { SpendFacts } from '../ad-spend/store.js';
import type { HeroMarket } from '../dashboard-types.js';
import { overheadsForPeriod } from '../overheads.js';
import { profitAndMargin } from '../profit.js';
import type { Settings } from '../settings.js';
import { costOrder, type ShopifyCost } from '../shopify/costs.js';
import { orderNet } from '../shopify/metrics.js';
import { isFreeOrder, paidOrder, type Order } from '../shopify/model.js';
import { orderInMarket } from '../shopify/order-market.js';
import type { SourceMode } from '../sources.js';
import { compareSpendAndSales, growthPercent, type GrowthComparison } from './growth.js';
import type { StockDailyRow } from './stock-daily.js';
export { compareSpendAndSales } from './growth.js';

export interface ScorecardMonth {
  month: string; from: string; to: string; previousFrom: string; previousTo: string;
  yearFrom: string; yearTo: string; label: string;
}
const monthAt = (month: string, offset: number) => {
  const date = new Date(`${month}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
};
const monthEnd = (month: string) => addDays(`${monthAt(month, 1)}-01`, -1);

/** Month boundaries are UK calendar dates, including the October clock change. */
export function scorecardMonth(month: string | undefined, now = new Date()): ScorecardMonth {
  const currentMonth = ukToday(now).slice(0, 7), selected = month || monthAt(currentMonth, -1);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(selected) || selected < '0002-01' || selected >= currentMonth)
    throw Object.assign(new Error('Choose a completed calendar month.'), { statusCode: 400 });
  const previous = monthAt(selected, -1), year = monthAt(selected, -12);
  return { month: selected, from: `${selected}-01`, to: monthEnd(selected),
    previousFrom: `${previous}-01`, previousTo: monthEnd(previous), yearFrom: `${year}-01`, yearTo: monthEnd(year),
    label: new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${selected}-15T12:00:00Z`)) };
}

export interface ScorecardInput {
  mode: SourceMode; month: string; market: HeroMarket; now: Date; orders: readonly Order[];
  dailySales: readonly { day: string; netSales: number }[];
  salesCoverage: readonly string[]; orderCoverage: readonly string[]; spend: SpendFacts;
  costs: readonly ShopifyCost[]; estimates: readonly { orderId: string; costPence: number | null; source: string }[];
  settings: Settings; stockDaily: readonly StockDailyRow[];
  locations: readonly { market: 'uk' | 'us'; locationId: string }[];
  productLabels: Readonly<Record<string, string>>;
}
export interface CustomerSlice {
  key: 'first' | 'repeat' | 'unknown'; label: string;
  money: number | null; previousMoney: number | null; mixPercent: number | null; previousMixPercent: number | null;
  orders: number | null; previousOrders: number | null;
}
export interface StockPeriod { outOfStock: boolean; unknownDays: number; label: string }
export interface ProductMover {
  productId: string; label: string; units: number; previousUnits: number; change: number;
  stock: { current: StockPeriod; previous: StockPeriod };
}
export interface ProfitPeriod {
  netSales: number | null; grossProfit: number | null; grossMarginPercent: number | null;
  profit: number | null; assumptions: string[];
}
export interface ScorecardModel {
  mode: SourceMode; market: HeroMarket; window: ScorecardMonth;
  sales: { current: number | null; previous: number | null; lastYear: number | null; lastYearGrowthPercent: number | null; yearAvailable: boolean };
  growth: { overall: GrowthComparison; platforms: { source: AdSource; label: string; comparison: GrowthComparison; lastYear: GrowthComparison | null }[]; lastYear: GrowthComparison | null };
  customers: { available: boolean; previousAvailable: boolean; mixAvailable: boolean; previousMixAvailable: boolean; slices: CustomerSlice[] };
  movers: { available: boolean; up: ProductMover[]; down: ProductMover[]; note: string };
  profit: { current: ProfitPeriod; previous: ProfitPeriod; pointer: string; assumptions: string[]; overheadEstimated: true };
  days: { day: string; netSales: number | null; spikeMarkets: ('UK' | 'US')[] }[];
  costPerOrder: { state: 'waiting'; line: 'Not enough data yet' };
}

function daysIn(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}
/** Coverage is supplied explicitly by the store; an observed order cannot prove a complete day. */
export function coveredPeriod(coverage: readonly string[], from: string, to: string): boolean {
  const known = new Set(coverage);
  return daysIn(from, to).every(day => known.has(day));
}
const inPeriod = (day: string, from: string, to: string) => day >= from && day <= to;
const pounds = (value: number): number => Math.round(value * 100) / 100;
const sumSales = (input: ScorecardInput, from: string, to: string): number | null =>
  coveredPeriod(input.salesCoverage, from, to)
    ? pounds(input.dailySales.filter(row => inPeriod(row.day, from, to)).reduce((sum, row) => sum + row.netSales, 0)) : null;

function spendTotal(input: ScorecardInput, from: string, to: string, platform?: AdSource): number | null {
  if (input.spend.mode !== input.mode) return null;
  const sources = input.spend.sources.filter(source => (input.mode === 'sample' || source.live) && (!platform || source.source === platform));
  if (!sources.length || sources.some(source => !source.ready || input.mode === 'live' && (source.stale || (source.failures ?? 0) > 0
    || source.status !== 'live' && !source.status.startsWith('backfill running')) || !coveredPeriod(input.spend.days
    .filter(day => day.source === source.source).map(day => day.day), from, to))) return null;
  const included = new Set(sources.map(source => source.source));
  const rows = input.spend.rows.filter(row => included.has(row.source) && inPeriod(row.day, from, to)
    && (input.market === 'all' || spendMarket(row) === input.market));
  if (rows.some(row => row.currency !== 'GBP')) return null;
  return Number(rows.reduce((sum, row) => sum + decimalMicros(row.amount), 0n)) / 1_000_000;
}

const cohortKey = (order: Order): CustomerSlice['key'] => order.firstOrder === 'first' || order.firstOrder === 'repeat' ? order.firstOrder : 'unknown';
function customerPeriod(orders: readonly Order[], from: string, to: string, available: boolean) {
  const keys = ['first', 'repeat', 'unknown'] as const;
  const slices = keys.map(key => ({ key,
    money: available ? orders.filter(order => cohortKey(order) === key).reduce((sum, order) => sum + orderNet(order, from, to), 0) / 100 : null,
    orders: available ? orders.filter(order => cohortKey(order) === key && inPeriod(order.day, from, to) && !isFreeOrder(order)).length : null,
  }));
  const total = slices.reduce((sum, slice) => sum + (slice.money ?? 0), 0);
  const mixAvailable = available && total > 0 && slices.every(slice => slice.money !== null && slice.money >= 0);
  return { slices: slices.map(slice => ({ ...slice, mixPercent: mixAvailable ? 100 * slice.money! / total : null })), mixAvailable };
}

function stockPeriod(input: ScorecardInput, productId: string, from: string, to: string): StockPeriod {
  const locations = new Set(input.locations.filter(location => input.market === 'all' || location.market === input.market).map(location => location.locationId));
  const expectedItems = new Map<string, Set<string>>();
  const byDay = new Map<string, Map<string, Map<string, number>>>();
  for (const row of input.stockDaily) {
    if (row.mode !== input.mode || row.productId !== productId || !locations.has(row.locationId)) continue;
    // Observations cannot tell us when a variant began or ended. A missing known
    // item therefore makes that location unknown, rather than proving a sell-out.
    const expected = expectedItems.get(row.locationId) ?? new Set<string>();
    expected.add(row.inventoryItemId); expectedItems.set(row.locationId, expected);
    if (!inPeriod(row.day, from, to)) continue;
    const day = byDay.get(row.day) ?? new Map<string, Map<string, number>>();
    const items = day.get(row.locationId) ?? new Map<string, number>();
    items.set(row.inventoryItemId, row.available); day.set(row.locationId, items); byDay.set(row.day, day);
  }
  let unknownDays = 0, emptyDays = 0;
  const emptyLocations = new Set<string>();
  for (const day of daysIn(from, to)) {
    const row = byDay.get(day), empty: string[] = [];
    let unknown = !locations.size;
    for (const location of locations) {
      const expected = expectedItems.get(location), items = row?.get(location);
      if (!expected?.size || !items || [...expected].some(item => !items.has(item))) unknown = true;
      else if ([...items.values()].reduce((sum, quantity) => sum + quantity, 0) <= 0) empty.push(location);
    }
    if (unknown) unknownDays++;
    if (empty.length) { emptyDays++; for (const location of empty) emptyLocations.add(location); }
  }
  const unknown = unknownDays ? `stock then not known on ${unknownDays} ${unknownDays === 1 ? 'day' : 'days'}` : '';
  const markets = [...new Set(input.locations.filter(row => emptyLocations.has(row.locationId)).map(row => row.market.toUpperCase()))].sort().join(' and ');
  return { outOfStock: emptyDays > 0, unknownDays, label: emptyDays
    ? `Out of stock in ${markets} on ${emptyDays} ${emptyDays === 1 ? 'day' : 'days'}${unknown ? `; ${unknown}` : ''}`
    : unknown || 'Stock recorded throughout; no sell-out observed' };
}

function productMovers(input: ScorecardInput, orders: readonly Order[], window: ScorecardMonth): ScorecardModel['movers'] {
  const available = coveredPeriod(input.orderCoverage, window.previousFrom, window.to);
  const note = 'Ordered units from counted paid orders; line-level money and returned units are not available. Stock dates without a daily snapshot remain unknown.';
  if (!available) return { available, up: [], down: [], note };
  const products = new Map<string, { label: string; current: number; previous: number }>();
  for (const order of orders) {
    if (isFreeOrder(order) || !inPeriod(order.day, window.previousFrom, window.to)) continue;
    for (const line of order.lines) {
      if (!Number.isFinite(line.quantity) || line.quantity <= 0) continue;
      const id = line.productId ?? (line.sku ? `sku:${line.sku}` : 'unknown-product');
      const product = products.get(id) ?? { label: input.productLabels[id] ?? (line.sku ? `SKU ${line.sku}` : 'Product title unavailable'), current: 0, previous: 0 };
      if (order.day >= window.from) product.current += line.quantity; else product.previous += line.quantity;
      products.set(id, product);
    }
  }
  const movers = [...products].map(([productId, product]) => ({ productId, label: product.label,
    units: product.current, previousUnits: product.previous, change: product.current - product.previous }));
  const stockInput = { ...input, stockDaily: input.stockDaily.filter(row => inPeriod(row.day, window.previousFrom, window.to)) };
  const withStock = (row: typeof movers[number]): ProductMover => ({ ...row,
    stock: { current: stockPeriod(stockInput, row.productId, window.from, window.to), previous: stockPeriod(stockInput, row.productId, window.previousFrom, window.previousTo) } });
  const tie = (a: typeof movers[number], b: typeof movers[number]) => a.productId.localeCompare(b.productId);
  return { available, note, up: movers.filter(row => row.change > 0).sort((a, b) => b.change - a.change || tie(a, b)).slice(0, 3).map(withStock),
    down: movers.filter(row => row.change < 0).sort((a, b) => a.change - b.change || tie(a, b)).slice(0, 3).map(withStock) };
}

function profitPeriod(input: ScorecardInput, orders: readonly Order[], from: string, to: string, netSales: number | null, spend: number | null): ProfitPeriod {
  const assumptions = ['Overhead is an estimate from monthly Settings; actual overhead costs have not been uploaded.'];
  if (input.market !== 'all') assumptions.push('Overhead is not allocated to markets and is left out of this market estimate.');
  const unknown: ProfitPeriod = { netSales, grossProfit: null, grossMarginPercent: null, profit: null, assumptions };
  if (netSales === null || !coveredPeriod(input.orderCoverage, from, to)) {
    assumptions.push('Complete Shopify sales and order cost detail are not available for this month.'); return unknown;
  }
  const period = orders.filter(order => inPeriod(order.day, from, to));
  let landed = 0, fulfilment = 0, shippingIncome = 0, missingLanded = 0, missingFulfilment = 0, fallbackCosts = false;
  const estimates = new Map(input.estimates.map(row => [row.orderId, row]));
  for (const order of period) {
    const costs = costOrder(order, input.costs, input.settings);
    if (costs.costPence === null) missingLanded++; else landed += costs.costPence;
    fallbackCosts ||= costs.sources.includes('settings');
    const estimate = estimates.get(order.id);
    if (estimate?.costPence == null) missingFulfilment++; else fulfilment += estimate.costPence;
    const shippingTax = Math.max(0, order.taxPence - order.itemTaxPence);
    shippingIncome += Math.max(0, order.shippingPence - (order.taxesIncluded ? shippingTax : 0));
  }
  const refunds = orders.flatMap(order => order.refunds).filter(refund => inPeriod(ukToday(new Date(refund.createdAt)), from, to));
  const missingShipping = refunds.some(refund => refund.shippingNetPence === undefined);
  if (missingLanded) assumptions.push(`Product costs missing on ${missingLanded} orders; gross margin is unavailable.`);
  if (fallbackCosts) assumptions.push('Some product costs use the starting-cost assumption in Settings.');
  if (input.costs.length) assumptions.push('Product costs use observed history; earlier orders may use the earliest observed cost.');
  if (missingFulfilment) assumptions.push(`Fulfilment costs missing on ${missingFulfilment} orders.`);
  else if (period.length) assumptions.push('Fulfilment uses the stored per-order estimates.');
  if (missingShipping) assumptions.push('Earlier shipping-refund detail is unavailable.');
  if (input.settings.paymentFeePercent === null) assumptions.push('Payment fees are not set.');
  if (spend === null) assumptions.push('Complete ad-spend coverage is unavailable.');
  const grossProfit = missingLanded ? null : pounds(netSales - landed / 100);
  const grossMarginPercent = grossProfit !== null && netSales > 0 ? 100 * grossProfit / netSales : null;
  const complete = !missingLanded && !missingFulfilment && !missingShipping && input.settings.paymentFeePercent !== null && spend !== null;
  const overheads = input.market === 'all' ? overheadsForPeriod(input.settings.overheads, from, to, input.now).total : 0;
  if (input.market === 'all' && !input.settings.overheads.length) assumptions.push('No overhead items are configured; the estimate leaves overhead out.');
  const profit = complete ? profitAndMargin({ netSales, landedCost: landed / 100, fulfilment: fulfilment / 100,
    shippingIncome: shippingIncome / 100, shippingRefunds: refunds.reduce((sum, refund) => sum + (refund.shippingNetPence ?? 0), 0) / 100,
    paymentFees: Math.round(Math.max(0, netSales) * input.settings.paymentFeePercent!) / 100, adSpend: spend!, overheads }).profit : null;
  return { netSales, grossProfit, grossMarginPercent, profit: profit === null ? null : pounds(profit), assumptions };
}

export function profitPointer(current: ProfitPeriod, previous: ProfitPeriod): string {
  if (current.netSales === null || previous.netSales === null || current.grossMarginPercent === null || previous.grossMarginPercent === null)
    return 'Profit comparison waits for complete sales and product costs.';
  if (current.netSales > previous.netSales && current.grossMarginPercent < previous.grossMarginPercent)
    return 'Sales up and gross margin down: look at discounts, product costs and mix.';
  if (current.profit === null || previous.profit === null) return 'Profit comparison waits for complete marketing, fulfilment and payment costs.';
  if (current.grossMarginPercent > previous.grossMarginPercent && current.profit < previous.profit)
    return 'Gross margin up and profit down: look at marketing, fulfilment and overhead.';
  if (current.grossMarginPercent > previous.grossMarginPercent && current.profit > previous.profit) return 'Both up: good.';
  return 'Read sales, gross margin and profit together before deciding.';
}

export function buildScorecard(input: ScorecardInput): ScorecardModel {
  const window = scorecardMonth(input.month, input.now);
  const current = sumSales(input, window.from, window.to), previous = sumSales(input, window.previousFrom, window.previousTo);
  // Twelve complete intervening months plus the matching prior-year month are required.
  const yearAvailable = coveredPeriod(input.salesCoverage, window.yearFrom, window.to);
  const lastYear = yearAvailable ? sumSales(input, window.yearFrom, window.yearTo) : null;
  const spend = spendTotal(input, window.from, window.to), previousSpend = spendTotal(input, window.previousFrom, window.previousTo);
  const yearSpend = yearAvailable && spendTotal(input, window.yearFrom, window.to) !== null ? spendTotal(input, window.yearFrom, window.yearTo) : null;
  const orders = input.orders.filter(order => paidOrder(order) && orderInMarket(order, input.market));
  const available = coveredPeriod(input.orderCoverage, window.from, window.to), previousAvailable = coveredPeriod(input.orderCoverage, window.previousFrom, window.previousTo);
  const customers = customerPeriod(orders, window.from, window.to, available), priorCustomers = customerPeriod(orders, window.previousFrom, window.previousTo, previousAvailable);
  const labels = { first: 'New', repeat: 'Returning', unknown: 'Unknown' };
  const profit = profitPeriod(input, orders, window.from, window.to, current, spend);
  const previousProfit = profitPeriod(input, orders, window.previousFrom, window.previousTo, previous, previousSpend);
  const salesByDay = new Map(input.dailySales.map(row => [row.day, row.netSales])), salesCoverage = new Set(input.salesCoverage);
  return { mode: input.mode, market: input.market, window,
    sales: { current, previous, lastYear, lastYearGrowthPercent: growthPercent(current, lastYear), yearAvailable },
    growth: { overall: compareSpendAndSales({ netSales: current, spend }, { netSales: previous, spend: previousSpend }),
      platforms: adSources.map(source => {
        const yearComplete = yearAvailable && spendTotal(input, window.yearFrom, window.to, source) !== null;
        return { source, label: adNames[source], comparison: compareSpendAndSales({ netSales: current, spend: spendTotal(input, window.from, window.to, source) },
          { netSales: previous, spend: spendTotal(input, window.previousFrom, window.previousTo, source) }),
        lastYear: yearComplete ? compareSpendAndSales({ netSales: current, spend: spendTotal(input, window.from, window.to, source) },
          { netSales: lastYear, spend: spendTotal(input, window.yearFrom, window.yearTo, source) }) : null };
      }), lastYear: yearAvailable && yearSpend !== null ? compareSpendAndSales({ netSales: current, spend }, { netSales: lastYear, spend: yearSpend }) : null },
    customers: { available, previousAvailable, mixAvailable: customers.mixAvailable, previousMixAvailable: priorCustomers.mixAvailable,
      slices: customers.slices.map((slice, index) => ({ ...slice, label: labels[slice.key], previousMoney: priorCustomers.slices[index]!.money,
        previousMixPercent: priorCustomers.slices[index]!.mixPercent, previousOrders: priorCustomers.slices[index]!.orders })) },
    movers: productMovers(input, orders, window),
    profit: { current: profit, previous: previousProfit, pointer: profitPointer(profit, previousProfit),
      assumptions: [...new Set([...profit.assumptions, ...previousProfit.assumptions])], overheadEstimated: true },
    days: daysIn(window.from, window.to).map(day => ({ day, netSales: salesCoverage.has(day) ? salesByDay.get(day) ?? 0 : null,
      spikeMarkets: spikeMarkets(day).filter(market => input.market === 'all' || market.toLowerCase() === input.market) })),
    costPerOrder: { state: 'waiting', line: 'Not enough data yet' } };
}
