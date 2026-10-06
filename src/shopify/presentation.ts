import type { ShopifyDashboard } from './dashboard.js';
const esc = (value: unknown) => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const stamp = (model: ShopifyDashboard) => `Shopify ${model.mode === 'live' ? 'live' : 'sample data'}`;
export function needsHtml(model: ShopifyDashboard): string {
  const card = (n: ShopifyDashboard['needs'][number]) => `<article class="dcard pulse-need" data-state="${n.state}" data-source="${n.source ?? 'shopify'}" data-mode="${model.mode}"><div class="rhead"><span class="src" aria-hidden="true"><svg class="ic"><use href="#i-bag"/></svg></span><span class="chip ${n.state}">${n.state === 'alarm' ? '! Alarm' : '△ Watch'}</span><div><h3>${esc(n.title)}</h3><p>${esc(n.why)}</p><small>${n.source === 'j-and-j' ? `J&amp;J · ${model.mode === 'sample' ? 'sample data' : 'uploaded charges'}` : stamp(model)}</small></div><div class="acts"><a class="act" href="${esc(n.link)}" target="_blank" rel="noopener noreferrer">${n.source === 'j-and-j' ? 'Review fulfilment costs' : 'Open in Shopify'}</a></div></div></article>`;
  return `<p class="note">${stamp(model)} · Needs you</p>${model.needs.slice(0, 5).map(card).join('') || '<p class="note">No checks currently need you. Unknown checks are listed in Watchdogs.</p>'}${model.needs.length > 5 ? `<details><summary>Show ${model.needs.length - 5} more</summary>${model.needs.slice(5).map(card).join('')}</details>` : ''}`;
}
export function checksHtml(model: ShopifyDashboard): string {
  const passing = model.checks.filter(c => c.status === 'pass').length;
  const tripped = model.checks.filter(c => c.status === 'tripped');
  return `<details class="pulse-watchdogs"><summary class="pill">${tripped.length ? '△ ' + esc(tripped[0]!.name) + ' · ' : ''}${passing}/${model.checks.length} checks passing · ${stamp(model)}</summary><div class="glass">${model.checks.map(c => `<p><strong>${c.status === 'pass' ? '✓ Good' : c.status === 'tripped' ? '△ Watch' : '○ Unknown'} · ${esc(c.name)}</strong><br>${esc(c.why)}</p>`).join('')}</div></details>`;
}
export function liveHtml(model: ShopifyDashboard): string {
  return `<div class="srow" data-source="shopify" data-mode="${model.mode}"><span class="v">${esc(model.live.lastOrder)}</span><span class="l">Since last paid order<small>${stamp(model)}</small></span></div><div class="srow"><span class="l">${esc(model.live.carts)}</span></div><div class="srow"><span class="l">${esc(model.live.dispatch)}</span></div>`;
}
export function storePanelsHtml(model: ShopifyDashboard): string {
  return `<div class="grid">${Object.entries(model.detail).map(([key, d]) => `<button class="tile stat" type="button" data-state="info" data-src="shopify" data-source="shopify" data-mode="${model.mode}" data-custom-detail="${esc(JSON.stringify(d))}"><span class="sl">${key === 'checkout' ? 'Checkout' : 'Stock and cover'}</span><span class="ss">${esc(d.why)}</span><span class="chip info">○ ${stamp(model)}</span></button>`).join('')}</div>`;
}
