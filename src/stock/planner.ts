import { addDays, dayCount } from '../hero-range.js';
import type { InboundStock } from '../shopify/stock-gap.js';
import type { State } from '../dashboard-types.js';

export type Warehouse = InboundStock['market'];
export interface PlannerProduct {
  name: string;
  sku?: string;
  kit: boolean;
  market: Warehouse;
  available: number | null;
  daily: Map<string, number>;
  launch?: string;
}
export interface PlannerSettings {
  seasonalMultipliers: number[];
  reorderSafetyWeeks: number;
  productSuppliers: { product: string; supplier: string }[];
}

interface StockForecast {
  runOut: string | null;
  gaps: { from: string; to: string; days: number }[];
}

export interface PlannerRow extends Omit<PlannerProduct, 'daily' | 'launch'>, StockForecast {
  rate: number | null;
  observedDays: number;
  inbound: InboundStock[];
  orderBy: string | null;
  setSupplier: boolean;
  state: State | null;
  coverage: { kits: number; covered: number; shortfall: number } | null;
}

export function plannerDefaults(): PlannerSettings {
  return { seasonalMultipliers: Array<number>(12).fill(1), reorderSafetyWeeks: 3, productSuppliers: [] };
}

export const plannerHistoryDays = 28;
const normalise = (value: string) => value.trim().toLowerCase();
const units = (rows: readonly InboundStock[]): number => rows.reduce((sum, row) => sum + row.quantity, 0);

/** Apply demand at the calendar month’s rate between landings. */
export function forecastStock(today: string, available: number | null, rate: number | null, multipliers: readonly number[], inbound: readonly InboundStock[]): StockForecast {
  const gaps: StockForecast['gaps'] = [];
  if (available === null) return { runOut: null, gaps };
  const arrivals = inbound.filter(row => row.expectedDate >= today).sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));
  let remaining = Math.max(0, available);
  let date = today;
  let arrival = 0;
  while (date < '9999-12-01') {
    while (arrivals[arrival]?.expectedDate === date) remaining += arrivals[arrival++]!.quantity;
    const landing = arrivals[arrival]?.expectedDate;
    const month = Number(date.slice(5, 7));
    const endOfMonth = new Date(Date.UTC(Number(date.slice(0, 4)), month, 1)).toISOString().slice(0, 10);
    const next = landing && landing < endOfMonth ? landing : endOfMonth;
    const days = dayCount(date, next) - 1;
    const daily = (rate ?? 0) * multipliers[month - 1]!;
    if (remaining > 0 && daily <= 0) return { runOut: null, gaps };
    const untilEmpty = remaining === 0 ? 0 : remaining / daily;
    if (untilEmpty <= days) {
      const empty = addDays(date, Math.floor(untilEmpty));
      if (!landing) return { runOut: daily > 0 ? empty : null, gaps };
      if (empty < landing) gaps.push({ from: empty, to: landing, days: dayCount(empty, landing) - 1 });
      // Demand while the shelf is empty is lost. Resume on the landing date.
      remaining = 0;
      date = landing;
    } else {
      remaining -= daily * days;
      date = next;
    }
  }
  return { runOut: null, gaps };
}

export function orderState(today: string, orderBy: string | null): PlannerRow['state'] {
  if (orderBy === null) return null;
  if (orderBy <= today) return 'alarm';
  return dayCount(today, orderBy) - 1 <= 14 ? 'warn' : 'good';
}

function dailyUsage(product: PlannerProduct, today: string, inbound: readonly InboundStock[]): Map<string, number> {
  const result = new Map<string, number>();
  const receipts = new Set(inbound.map(row => row.expectedDate));
  for (let day = addDays(today, -plannerHistoryDays); day < today; day = addDays(day, 1)) {
    if (product.launch && day < product.launch) continue;
    const next = addDays(day, 1), opening = product.daily.get(day), closing = product.daily.get(next);
    // A landing or a stock increase cannot tell us how many left that day.
    if (opening === undefined || closing === undefined || opening < closing || receipts.has(day) || receipts.has(next)) continue;
    result.set(day, opening - closing);
  }
  return result;
}

export function planStock(products: readonly PlannerProduct[], today: string, settings: PlannerSettings & {
  inboundStock: readonly InboundStock[];
  supplierLeadTimes: readonly { supplier: string; days: number | null }[];
}): PlannerRow[] {
  const prepared = products.map(product => {
    const matches = (value: string) => normalise(value) === normalise(product.name) || !!product.sku && normalise(value) === normalise(product.sku);
    const landings = settings.inboundStock.filter(row => row.market === product.market && matches(row.product));
    const inbound = landings.filter(row => row.expectedDate >= today).sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));
    const usage = dailyUsage(product, today, landings);
    const supplier = settings.productSuppliers.find(row => matches(row.product))?.supplier;
    const lead = settings.supplierLeadTimes.find(row => row.supplier === supplier)?.days ?? null;
    const observedDays = usage.size;
    const rate = observedDays ? [...usage.values()].reduce((sum, value) => sum + value, 0) / observedDays : null;
    const forecast = forecastStock(today, product.available, rate, settings.seasonalMultipliers, inbound);
    return { product, inbound, usage, lead, observedDays, rate, ...forecast };
  });
  return prepared.map(({ product, inbound, usage, lead, observedDays, rate, runOut, gaps }) => {
    const { daily: _daily, launch: _launch, ...display } = product;
    const orderBy = product.kit || runOut === null || lead === null ? null
      : addDays(runOut, -Math.ceil(lead + settings.reorderSafetyWeeks * 7));
    let coverage: PlannerRow['coverage'] = null;
    const kits = prepared.filter(row => row.product.kit && row.product.market === product.market
      && (!row.product.launch || row.product.launch <= today));
    if (!product.kit && product.available !== null && kits.length && kits.every(row => row.product.available !== null)) {
      let packUnits = 0, kitUnits = 0;
      for (const [day, sold] of usage) {
        const active = kits.filter(row => !row.product.launch || row.product.launch <= day);
        if (!active.length || active.some(row => !row.usage.has(day))) continue;
        packUnits += sold;
        kitUnits += active.reduce((sum, row) => sum + row.usage.get(day)!, 0);
      }
      if (kitUnits > 0) {
        const remaining = kits.reduce((sum, row) => sum + Math.max(0, row.product.available!) + units(row.inbound), 0);
        const rate = packUnits / kitUnits, required = Math.ceil(rate * remaining);
        const lastRunOut = kits.reduce<string>((last, kit) => kit.runOut && kit.runOut > last ? kit.runOut : last, '');
        const available = Math.max(0, product.available) + units(inbound.filter(row => row.expectedDate <= lastRunOut));
        const covered = rate > 0 ? Math.min(remaining, Math.floor(available / rate)) : remaining;
        coverage = { kits: remaining, covered, shortfall: Math.max(0, required - available) };
      }
    }
    return { ...display, rate, observedDays, inbound, runOut, gaps, orderBy, state: orderState(today, orderBy),
      setSupplier: !product.kit && lead === null, coverage };
  });
}
