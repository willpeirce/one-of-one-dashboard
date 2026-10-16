import type { CreativeSheet, GroupPerformance } from './presentation-types.js';
import { formatNumber, formatPounds } from '../money.js';
import { escapeCreative as e } from './html.js';

type Totals = GroupPerformance['totals'];
const ratio = (value: number | null) => value === null ? '—' : `${formatNumber(value, 1)}×`;
const percent = (value: number | null) => value === null ? '—' : `${formatNumber(value * 100, 1)}%`;

/** Metrics down the page keep all four windows readable on a phone without sideways scrolling. */
export function creativePerformanceTableHtml(sheet: CreativeSheet): string {
  const rows: { label: string; value: (totals: Totals) => string }[] = [
    { label: 'Spend', value: row => formatPounds(row.spend) },
    { label: 'Purchases', value: row => formatNumber(row.purchases) },
    { label: 'Purchase value', value: row => formatPounds(row.purchaseValue) },
    { label: 'ROAS', value: row => ratio(row.roas) },
    { label: 'Per purchase', value: row => row.costPerPurchase === null ? '—' : formatPounds(row.costPerPurchase) },
    ...(sheet.group.group.kind === 'video' ? [
      { label: 'Hook', value: (row: Totals) => percent(row.hookRate) },
      { label: 'Hold', value: (row: Totals) => row.holdMissingPlayDays?`n/a (no play data for ${row.holdMissingPlayDays} of ${row.holdSpendDays} days)`:row.holdDataRows===0?'n/a (no ThruPlay data)':percent(row.holdRate) },
      { label: 'Watch-through', value: (row: Totals) => percent(row.watchThroughRate) },
    ] : []),
    { label: 'Add to cart', value: row => percent(row.addToCartRate) },
  ];
  return `<div class="creative-performance"><table class="creative-table creative-performance-table"><caption>Meta says · media group across all markets and owners</caption><thead><tr><th scope="col">Metric</th>${sheet.windows.map(({ window }) => `<th scope="col">${window === 'lifetime' ? 'Lifetime' : window}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr><th scope="row">${e(row.label)}</th>${sheet.windows.map(({ totals }) => `<td>${e(row.value(totals))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
