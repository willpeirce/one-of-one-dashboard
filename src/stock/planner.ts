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

export interface PlannerRow extends Omit<PlannerProduct, 'daily' | 'launch'> {
  rate: number | null;
  observedDays: number;
  inbound: InboundStock[];
  runOut: string | null;
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

/** Apply demand at the calendar month's rate until the next landing or month boundary. */
export function runOutDate(today: string, available: number, rate: number, multipliers: readonly number[], inbound: readonly InboundStock[]): string | null {
  if (rate <= 0) return null;
  if (available <= 0) return today;
  const arrivals = inbound.filter(row => row.expectedDate >= today).sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));
  let remaining = available;
  let date = today;
  let arrival = 0;
  while (date < '9999-12-01') {
    while (arrivals[arrival]?.expectedDate === date) remaining += arrivals[arrival++]!.quantity;
    const month = Number(date.slice(5, 7));
    const endOfMonth = new Date(Date.UTC(Number(date.slice(0, 4)), month, 1)).toISOString().slice(0, 10);
    const landing = arrivals[arrival]?.expectedDate;
    const next = landing && landing < endOfMonth ? landing : endOfMonth;
    const daily = rate * multipliers[month - 1]!;
    const days = dayCount(date, next) - 1;
    const untilEmpty = remaining / daily;
    if (untilEmpty <= days) return addDays(date, Math.floor(untilEmpty));
    remaining -= daily * days;
    date = next;
  }
  return null;
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
    return { product, inbound, usage, lead };
  });
  return prepared.map(({ product, inbound, usage, lead }) => {
    const { daily: _daily, launch: _launch, ...display } = product;
    const observedDays = usage.size;
    const rate = observedDays ? [...usage.values()].reduce((sum, value) => sum + value, 0) / observedDays : null;
    const runOut = product.available === null || rate === null ? null
      : runOutDate(today, product.available, rate, settings.seasonalMultipliers, inbound);
    const orderBy = product.kit || runOut === null || lead === null ? null
      : addDays(runOut, -Math.ceil(lead + settings.reorderSafetyWeeks * 7));
    let coverage: PlannerRow['coverage'] = null;
    const kits = prepared.filter(row => row.product.kit && row.product.market === product.market);
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
        const available = Math.max(0, product.available) + units(inbound);
        const covered = rate > 0 ? Math.min(remaining, Math.floor(available / rate)) : remaining;
        coverage = { kits: remaining, covered, shortfall: Math.max(0, required - available) };
      }
    }
    return { ...display, rate, observedDays, inbound, runOut, orderBy, state: orderState(today, orderBy),
      setSupplier: !product.kit && lead === null, coverage };
  });
}
