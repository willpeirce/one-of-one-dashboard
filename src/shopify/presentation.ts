import { formatNumber } from '../money.js';
import type { ShopifyDashboard } from './dashboard.js';
const esc = (value: unknown) => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const stamp = (model: ShopifyDashboard) => `Shopify ${model.mode === 'live' ? 'live' : 'sample data'}`;
export function checksHtml(model: ShopifyDashboard): string {
  // Keep the no-key Home fixture unchanged; Sources still lists this unknown check.
  const checks = model.checks.filter(c => c.id !== 'ads_check' || c.status !== 'unknown');
  const passing = checks.filter(c => c.status === 'pass').length;
  return `<details class="pulse-watchdogs"><summary class="pill">${passing===checks.length?'✓':'△'} ${formatNumber(passing)} of ${formatNumber(checks.length)} checks passing</summary><div class="glass">${checks.map(c => `<p><strong>${c.status === 'pass' ? '✓ Good' : c.status === 'tripped' ? '△ Watch' : 'i Info'} · ${esc(c.name)}</strong><br>${esc(c.why)}</p>`).join('')}</div></details>`;
}
export function storePanelsHtml(model: ShopifyDashboard): string {
  return `<div class="grid">${Object.entries(model.detail).map(([key, d]) => `<button class="tile stat" type="button" data-state="info" data-src="shopify" data-source="shopify" data-mode="${model.mode}" data-custom-detail="${esc(JSON.stringify(d))}"><span class="sl">${key === 'checkout' ? 'Checkout' : 'Stock and cover'}</span><span class="ss">${esc(d.why)}</span><span class="chip info">○ ${stamp(model)}</span></button>`).join('')}</div>`;
}
