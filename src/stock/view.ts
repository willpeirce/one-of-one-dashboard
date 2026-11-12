import type { ShopifyDashboard } from '../shopify/dashboard.js';
import { appConfig } from '../config.js';
import { formatNumber } from '../money.js';

type Row = ShopifyDashboard['stock'][number];
type CellState = 'alarm' | 'warn' | 'good' | 'info';
const esc = (value: string): string => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const glyph: Record<CellState, string> = { alarm: '✕', warn: '△', good: '✓', info: 'i' };
const word: Record<CellState, string> = { alarm: 'Alarm', warn: 'Watch', good: 'Good', info: 'Info' };

/** Kits show in the sell-out dials above. Starter, Ultimate and Duo are bundles with no stock of their own (Will, 12 Nov 2026). */
const kitProduct = appConfig.shopify.stockProducts[0].name;
const untracked = new Set<string>(appConfig.shopify.stockProducts.filter(product => 'bundle' in product && product.bundle).map(product => product.name));
export const stockPackRows = (rows: readonly Row[]): Row[] => rows.filter(row => row.product !== kitProduct && !untracked.has(row.product));

/** "SLABS & LABEL PACK" reads "Slabs & Label". */
export function packName(product: string): string {
  return product.replace(/\s+PACK$/i, '').toLowerCase().replace(/(^|\s)(\S)/g, (_match, space: string, letter: string) => space + letter.toUpperCase());
}
function cellState(row: Row): CellState {
  if (row.available === null) return 'info';
  if (row.required === null) return 'info';
  return row.available < row.required ? 'warn' : 'good';
}
function cell(rows: readonly Row[], product: string, market: 'uk' | 'us'): string {
  const row = rows.find(candidate => candidate.product === product && candidate.market === market);
  const attrs = `data-stock-product="${esc(product)}" data-stock-market="${market}"`;
  if (!row || row.available === null) return `<div class="stock-cell" ${attrs} data-stock-state="info" aria-label="${esc(`${packName(product)} · ${market.toUpperCase()} · stock unknown`)}"><span class="stock-figure">Unknown</span></div>`;
  const state = cellState(row), needed = row.required === null ? null : Math.ceil(row.required);
  const ratio = needed === null ? 0 : needed > 0 ? Math.min(1, row.available / needed) : 1;
  const figure = needed === null ? `${formatNumber(row.available)} in stock` : `${formatNumber(row.available)} <small>/ ${formatNumber(needed)}</small>`;
  const label = needed === null ? `${formatNumber(row.available)} in stock, need unknown` : `${formatNumber(row.available)} in stock, ${formatNumber(needed)} needed`;
  return `<div class="stock-cell" ${attrs} data-stock-state="${state}" aria-label="${esc(`${word[state]} · ${packName(product)} · ${market.toUpperCase()} · ${label}`)}"><span class="stock-figure"><span class="stock-glyph" aria-hidden="true">${glyph[state]}</span> ${figure}</span>${needed === null ? '' : `<span class="stock-bar" aria-hidden="true"><i style="width:${(ratio * 100).toFixed(1)}%"></i></span>`}</div>`;
}

/** Packs against the kits still to sell: in stock / needed at each pack's attach rate. */
export function stockPacksHtml(model: ShopifyDashboard): string {
  const rows = stockPackRows(model.stock);
  const products = [...new Set(rows.map(row => row.product))];
  if (!products.length) return '';
  const fine = products.filter(product => {
    const own = rows.filter(row => row.product === product);
    return own.length >= 2 && own.every(row => cellState(row) === 'good');
  });
  const lines = (items: string[]) => items.map(product => `<div class="stock-line"><span class="stock-product">${esc(packName(product))}</span>${cell(rows, product, 'uk')}${cell(rows, product, 'us')}</div>`).join('');
  const regular = products.filter(product => !fine.includes(product));
  return `<div class="stock-packs-head"><h3>Packs</h3><p>In stock / needed for the kits left</p></div>
    <div class="stock-grid"><div class="stock-line stock-columns" aria-hidden="true"><span></span><strong>UK</strong><strong>US</strong></div>${lines(regular)}</div>
    ${fine.length ? `<details class="stock-fine"><summary>${formatNumber(fine.length)} more with enough stock</summary><div class="stock-grid">${lines(fine)}</div></details>` : ''}`;
}
