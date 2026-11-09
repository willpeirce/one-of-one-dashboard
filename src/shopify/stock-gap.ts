import type { StockCover } from './metrics.js';
import type { DashboardNeed } from './dashboard.js';
import { addDays, dayCount } from '../hero-range.js';
import { formatNumber } from '../money.js';

export interface InboundStock {
  product: string;
  market: 'uk' | 'us';
  quantity: number;
  expectedDate: string;
}

export interface StockGap {
  product: string;
  productId: string;
  market: StockCover['market'];
  coverDays: number | null;
  nextArrival: { date: string; quantity: number | null; assumed: boolean } | null;
  daysToArrival: number | null;
  gapDays: number | null;
}

const productKey = (product: string) => product.trim().toLowerCase();

export function inboundProductWarning(product: unknown, products: readonly string[]): string {
  return typeof product === 'string' && product.trim() && !products.some(known => productKey(known) === productKey(product))
    ? '⚠ Product not found in Stock and cover. Check the product name.' : '';
}

/** UK date strings are calendar dates, so the clock change never adds a fractional day. */
export function calculateStockGaps(stock: readonly StockCover[], inbound: readonly InboundStock[], supplierLeadTimes: readonly { days: number | null }[], today: string): StockGap[] {
  const leadTimes = supplierLeadTimes.flatMap(row => row.days === null ? [] : [row.days]);
  const fallbackDays = leadTimes.length ? Math.min(...leadTimes) : null;
  return stock.map(row => {
    const upcoming = inbound.filter(arrival => productKey(arrival.product) === productKey(row.product)
      && arrival.market === row.market && arrival.expectedDate >= today);
    const first = upcoming.map(arrival => arrival.expectedDate).sort()[0];
    const nextArrival = first
      ? { date: first, quantity: upcoming.filter(arrival => arrival.expectedDate === first).reduce((sum, arrival) => sum + arrival.quantity, 0), assumed: false }
      : fallbackDays === null ? null : { date: addDays(today, fallbackDays), quantity: null, assumed: true };
    const coverDays = row.cover === null ? null : Math.max(0, row.cover);
    const daysToArrival = nextArrival ? dayCount(today, nextArrival.date) - 1 : null;
    return { product: row.product, productId: row.productId, market: row.market, coverDays, nextArrival, daysToArrival,
      gapDays: coverDays === null || daysToArrival === null ? null : Math.max(0, daysToArrival - coverDays) };
  });
}

export function stockGapNeeds(stock: readonly StockCover[], inbound: readonly InboundStock[], supplierLeadTimes: readonly { days: number | null }[], today: string, mode: 'sample' | 'live'): DashboardNeed[] {
  if (mode !== 'live') return [];
  return calculateStockGaps(stock, inbound, supplierLeadTimes, today).flatMap(row => {
    if (row.gapDays === null || row.gapDays <= 0 || !row.nextArrival) return [];
    const arrival = row.nextArrival.assumed
      ? `Assumed arrival ${row.nextArrival.date}: shortest supplier lead time, ${formatNumber(row.daysToArrival!)} days; no upcoming inbound row.`
      : `${formatNumber(row.nextArrival.quantity!)} units expected ${row.nextArrival.date}.`;
    return [{ id: `stock-gap:${row.productId}:${row.market}`, source: 'shopify', state: 'warn', link: '/settings',
      title: `${row.product} · ${row.market.toUpperCase()}: stock may run out before arrival`,
      why: `${formatNumber(row.coverDays!, 1)} days of cover. ${arrival} Gap rounded up to whole days.`,
      figure: { value: formatNumber(Math.ceil(row.gapDays)), label: 'days gap · rounded up' } } satisfies DashboardNeed];
  });
}
