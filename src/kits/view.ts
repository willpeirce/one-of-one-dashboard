import {escapeCreative as e} from '../creatives/html.js';
import {KIT_STEPS, type HomeKits, type KitCardView, type KitFoldedView, type KitSheet, type KitSheetOrder, type KitStatusView} from './presentation-types.js';

function statusHtml(status: KitStatusView): string {
  const kind = ['live', 'flight', 'planned', 'proposed', 'optional'].includes(status.kind) ? status.kind : 'other';
  const icon = kind === 'live' ? '●' : kind === 'flight' ? '◆' : kind === 'planned' ? '✓' : '○';
  return `<span class="kit-status kit-status-${kind}">${icon} ${e(status.label)}</span>`;
}
export function kitTrackLabel(gate: number): string {
  return `Step ${gate + 1} of 7, ${KIT_STEPS[gate]}. Done: ${KIT_STEPS.slice(0, gate).join(', ') || 'none'}. To come: ${KIT_STEPS.slice(gate + 1).join(', ') || 'none'}.`;
}
export function kitTrackHtml(gate: number, dots = false): string {
  return `<span class="kit-track${dots ? ' kit-dots' : ''}" data-kit-track role="img" aria-label="${e(kitTrackLabel(gate))}">${KIT_STEPS.map((_, index) => `<i class="${index < gate ? 'kit-track-done' : index === gate ? 'kit-track-current' : 'kit-track-future'}" aria-hidden="true"></i>`).join('')}</span>`;
}
export function kitCardHtml(card: KitCardView): string {
  return `<button class="kit-card" type="button" data-kit-open="${e(card.id)}" aria-haspopup="dialog"><span class="kit-card-head"><span class="kit-identity"><strong class="kit-name">${e(card.name)}</strong><span class="kit-series">${e(card.series)}</span>${statusHtml(card.status)}</span><span class="kit-launch"><strong>${e(card.distance)}</strong><span>${e(card.launch)}</span></span></span>${kitTrackHtml(card.gate)}<span class="kit-step-line"><span><strong>${e(KIT_STEPS[card.gate])}</strong> <span class="kit-step-count">step ${card.gate + 1} of 7</span></span><span class="kit-next-step">${e(card.stepAside)}</span></span><span class="kit-next-move"><span class="kit-owner${card.owner === 'Will' ? ' kit-your-move' : ''}">${card.owner === 'Will' ? '◆ Your move' : `○ ${e(card.owner || 'Next')}`}</span><span class="kit-action">${e(card.nextAction)}</span>${card.waiting ? `<span class="kit-waiting">△ ${e(card.waiting)}</span>` : ''}</span></button>`;
}
export function kitFoldedHtml(row: KitFoldedView): string {
  return `<button class="kit-folded-row" type="button" data-kit-open="${e(row.id)}" aria-haspopup="dialog"><span class="kit-folded-name"><strong>${e(row.name)}</strong>${statusHtml(row.status)}</span>${kitTrackHtml(row.gate, true)}<span class="kit-folded-date"><span>${e(row.launchMonth)}</span><small>${e(row.distance)}</small></span></button>`;
}
/** The same renderer is used on the first server response and every browser snapshot. */
export function homeKitsHtml(view: HomeKits = {mode: 'live', ready: false, summary: null, stale: false, notice: null, cards: [], folded: []}): string {
  return `<header class="chapter-heading kits-heading"><span class="chapter-number" aria-hidden="true">2</span><div class="chapter-copy"><p class="chapter-eyebrow">In the making</p><h2 class="chapter-title" id="kits-title">Kits</h2></div>${view.summary ? `<span class="shm kits-summary">${e(view.summary)}${view.stale ? ' <span class="kit-waiting">△ stale</span>' : ''}</span>` : ''}</header>${view.ready ? `${view.mode === 'sample' ? '<p class="kits-sample">ⓘ Sample data · invented kits</p>' : ''}${view.notice ? `<p class="kits-notice">${e(view.notice)}</p>` : ''}<div class="kit-cards">${view.cards.map(kitCardHtml).join('')}</div>${view.folded.length ? `<button class="kits-fold" type="button" data-kits-fold aria-expanded="false" aria-controls="kits-planned">+${view.folded.length} planned · show</button><div class="kit-folded-list" id="kits-planned" hidden>${view.folded.map(kitFoldedHtml).join('')}</div>` : ''}${!view.cards.length && !view.folded.length ? '<p class="kits-notice">No kits listed yet</p>' : ''}` : '<p class="kits-notice">Not set up yet</p>'}`;
}
function orderHtml(order: KitSheetOrder): string {
  return `<li class="kit-order" data-kit-order><div><strong>${e(order.item || 'Item')}</strong>${order.quantity !== null ? `<span class="kit-order-quantity">${e(order.quantity)}</span>` : ''}</div>${order.supplier ? `<p>${e(order.supplier)}</p>` : ''}${order.status ? `<p>${e(order.status)}</p>` : ''}${order.date || order.eta ? `<p class="kit-order-dates">${order.date ? `Ordered ${e(order.date)}` : ''}${order.date && order.eta ? ' · ' : ''}${order.eta ? `ETA ${e(order.eta)}` : ''}</p>` : ''}</li>`;
}
export function kitOrdersHtml(orders: KitSheetOrder[]): string {
  if (!orders.length) return '';
  return `<section class="kit-detail-block"><h4 data-kit-order-count>On order · ${Math.min(3, orders.length)} of ${orders.length}</h4><ul class="kit-orders">${orders.slice(0, 3).map(orderHtml).join('')}</ul>${orders.length > 3 ? `<button class="btn kit-orders-more" type="button" data-kit-orders-toggle data-total="${orders.length}" aria-expanded="false" aria-controls="kit-orders-rest">+${orders.length - 3} more</button><ul class="kit-orders" id="kit-orders-rest" data-kit-orders-rest hidden>${orders.slice(3).map(orderHtml).join('')}</ul>` : ''}</section>`;
}
export function kitSheetHtml(sheet: KitSheet): string {
  return `<div class="kit-sheet" data-kit-sheet="${e(sheet.id)}">${sheet.mode === 'sample' ? '<p class="kits-sample">ⓘ Sample data · invented kit</p>' : ''}<p class="kit-sheet-subtitle">${e(sheet.series)}${sheet.series && sheet.launch ? ' · ' : ''}${e(sheet.launch)}</p><ol class="kit-checklist">${KIT_STEPS.map((step, index) => `<li class="${index === sheet.gate ? 'kit-step-now' : ''}"><span aria-hidden="true">${index < sheet.gate ? '✓' : index === sheet.gate ? '●' : '○'}</span><span>${step} <small>${index < sheet.gate ? 'done' : index === sheet.gate ? 'now' : 'to come'}</small></span></li>`).join('')}</ol>${sheet.nextAction ? `<section class="kit-detail-block"><h4>Next${sheet.owner ? ` · ${e(sheet.owner)}` : ''}</h4><p>${e(sheet.nextAction)}</p></section>` : ''}${sheet.milestone || sheet.brief ? `<section class="kit-detail-block"><h4>Dates</h4>${sheet.milestone ? `<p>${e(sheet.milestone)}</p>` : ''}${sheet.brief ? `<p>Brief due ${e(sheet.brief)}</p>` : ''}</section>` : ''}${sheet.waiting ? `<section class="kit-detail-block"><h4>Waiting on</h4><p>${sheet.waiting.days} ${sheet.waiting.days === 1 ? 'day' : 'days'} · ${e(sheet.waiting.with)}</p></section>` : ''}${sheet.note ? `<section class="kit-detail-block"><h4>Note</h4><p>${e(sheet.note)}</p></section>` : ''}${sheet.ordersNotice ? `<p class="kits-notice">${e(sheet.ordersNotice)}</p>` : ''}${kitOrdersHtml(sheet.orders)}</div>`;
}
