import { formatNumber } from '../money.js';

export type GrowthPeriod = { netSales: number | null; spend: number | null };
export interface GrowthComparison {
  salesGrowthPercent: number | null;
  spendGrowthPercent: number | null;
  relation: 'spend-faster' | 'sales-faster' | 'same' | 'unavailable';
  headline: string;
  line: string;
}

/** A zero, negative or missing baseline cannot supply a meaningful growth percentage. */
export function growthPercent(current: number | null, previous: number | null): number | null {
  return current !== null && previous !== null && Number.isFinite(current) && Number.isFinite(previous) && previous > 0
    ? 100 * (current - previous) / previous : null;
}

export function compareSpendAndSales(current: GrowthPeriod, previous: GrowthPeriod): GrowthComparison {
  const salesGrowthPercent = growthPercent(current.netSales, previous.netSales);
  const spendGrowthPercent = growthPercent(current.spend, previous.spend);
  const relation = salesGrowthPercent === null || spendGrowthPercent === null ? 'unavailable'
    : Math.abs(spendGrowthPercent - salesGrowthPercent) < 1e-10 ? 'same'
      : spendGrowthPercent > salesGrowthPercent ? 'spend-faster' : 'sales-faster';
  const headline = { 'spend-faster': 'Spend grew faster than sales', 'sales-faster': 'Sales grew faster than spend',
    same: 'Spend and sales moved at the same rate', unavailable: 'Growth comparison unavailable' }[relation];
  const describe = (label: string, value: number | null) => value === null ? `${label} change unavailable`
    : `${label} ${value < 0 ? '−' : value > 0 ? '+' : ''}${formatNumber(Math.abs(value), 1)}%`;
  return { salesGrowthPercent, spendGrowthPercent, relation, headline,
    line: `${headline}. ${describe('Spend', spendGrowthPercent)} · ${describe('Shopify net sales', salesGrowthPercent)}.` };
}
