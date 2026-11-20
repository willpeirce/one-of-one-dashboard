import {escapeCreative as e} from '../creatives/html.js';
import {KIT_STEPS, type HomeKits, type KitCardView, type KitFoldedView, type KitMoveView, type KitSheet, type KitSheetOrder, type KitStatusView} from './presentation-types.js';

function statusHtml(status: KitStatusView): string {
  const kind = ['live', 'flight', 'planned', 'proposed', 'optional'].includes(status.kind) ? status.kind : 'other';
  const icon = kind === 'live' ? '●' : kind === 'flight' ? '◆' : kind === 'planned' ? '✓' : '○';
  return `<span class="kit-status kit-status-${kind}">${icon} ${e(status.label)}</span>`;
}
export function kitTrackLabel(gate: number): string {
  return `Stage ${gate + 1} of 7, ${KIT_STEPS[gate]}. Done: ${KIT_STEPS.slice(0, gate).join(', ') || 'none'}. To come: ${KIT_STEPS.slice(gate + 1).join(', ') || 'none'}.`;
}
export function kitTrackHtml(gate: number, dots = false): string {
  return `<span class="kit-track${dots ? ' kit-dots' : ''}" data-kit-track role="img" aria-label="${e(kitTrackLabel(gate))}">${KIT_STEPS.map((_, index) => `<i class="${index < gate ? 'kit-track-done' : index === gate ? 'kit-track-current' : 'kit-track-future'}" aria-hidden="true"></i>`).join('')}</span>`;
}
/** One move box serves both a card and its detail sheet. */
export function kitMoveHtml(move: KitMoveView | null): string {
  if (!move) return '';
  return `<span class="kit-move${move.yours ? ' kit-move-yours' : ''}"><span class="kit-move-label">${e(move.label)}</span><span class="kit-action">${e(move.action)}</span>${move.note ? `<small class="kit-move-note">${e(move.note)}</small>` : ''}</span>`;
}
export function kitCardHtml(card: KitCardView): string {
  return `<button class="kit-card" type="button" data-kit-open="${e(card.id)}" aria-haspopup="dialog"><span class="kit-card-head"><span class="kit-identity"><strong class="kit-name">${e(card.name)}</strong><span class="kit-series">${e(card.series)}</span>${statusHtml(card.status)}</span><span class="kit-launch">${card.distance ? `<strong>${e(card.distance)}</strong>` : ''}<span class="kit-launch-caption" title="${e(card.launch)}">${card.launch.split(/\s+/).map(word => `<span class="kit-caption-term"><span class="kit-caption-word">${e(word)}</span></span>`).join(' ')}</span></span></span>${kitTrackHtml(card.gate)}<span class="kit-step-line"><span><strong>${e(KIT_STEPS[card.gate])}</strong> <span class="kit-step-count">· stage ${card.gate + 1} of 7</span></span><span class="kit-next-step">${e(card.stepAside)}</span></span>${kitMoveHtml(card.move)}</button>`;
}
export function kitFoldedHtml(row: KitFoldedView): string {
  return `<button class="kit-folded-row" type="button" data-kit-open="${e(row.id)}" aria-haspopup="dialog"><span class="kit-folded-name"><strong>${e(row.name)}</strong>${statusHtml(row.status)}</span>${kitTrackHtml(row.gate, true)}<span class="kit-folded-date"><span>${e(row.launchMonth)}</span><small>${e(row.distance)}</small></span></button>`;
}
/** The same renderer is used on the first server response and every browser snapshot. */
export function homeKitsHtml(view: HomeKits = {mode: 'live', ready: false, summary: null, stale: false, notice: null, cards: [], folded: []}): string {
  return `<header class="chapter-heading kits-heading"><span class="chapter-number" aria-hidden="true">2</span><div class="chapter-copy"><p class="chapter-eyebrow">In the making</p><h2 class="chapter-title" id="kits-title">Kits</h2>${view.summary ? `<span class="shm kits-summary">${e(view.summary)}${view.stale ? ' <span class="kits-stale">△ stale</span>' : ''}</span>` : ''}${view.ready && view.mode === 'sample' ? '<p class="kits-sample">ⓘ Sample data · invented kits</p>' : ''}</div><a class="kits-all-link" href="/kits" data-kits-all>All kits ›</a></header>${view.ready ? `${view.notice ? `<p class="kits-notice">${e(view.notice)}</p>` : ''}<div class="kit-cards">${view.cards.map(kitCardHtml).join('')}</div>${view.folded.length ? `<button class="kits-fold" type="button" data-kits-fold aria-expanded="false" aria-controls="kits-planned">+${view.folded.length} planned · show</button><div class="kit-folded-list" id="kits-planned" hidden>${view.folded.map(kitFoldedHtml).join('')}</div>` : ''}${!view.cards.length && !view.folded.length ? '<p class="kits-notice">No kits listed yet</p>' : ''}` : '<p class="kits-notice">Not set up yet</p>'}`;
}
export function kitOrderHtml(order: KitSheetOrder): string {
  return `<li class="kit-order" data-kit-order><div><strong>${e(order.item || 'Item')}</strong>${order.quantity !== null ? `<span class="kit-order-quantity">${e(order.quantity)}</span>` : ''}</div>${order.supplier ? `<p>${e(order.supplier)}</p>` : ''}${order.status ? `<p>${e(order.status)}</p>` : ''}${order.date || order.eta ? `<p class="kit-order-dates">${order.date ? `Ordered ${e(order.date)}` : ''}${order.date && order.eta ? ' · ' : ''}${order.eta ? `ETA ${e(order.eta)}` : ''}</p>` : ''}</li>`;
}
export function kitOrdersHtml(orders: KitSheetOrder[]): string {
  if (!orders.length) return '';
  return `<section class="kit-detail-block"><h4 data-kit-order-count>On order · ${Math.min(3, orders.length)} of ${orders.length}</h4><ul class="kit-orders">${orders.slice(0, 3).map(kitOrderHtml).join('')}</ul>${orders.length > 3 ? `<button class="btn kit-orders-more" type="button" data-kit-orders-toggle data-total="${orders.length}" aria-expanded="false" aria-controls="kit-orders-rest">+${orders.length - 3} more</button><ul class="kit-orders" id="kit-orders-rest" data-kit-orders-rest hidden>${orders.slice(3).map(kitOrderHtml).join('')}</ul>` : ''}</section>`;
}
export function kitSheetHtml(sheet: KitSheet): string {
  return `<div class="kit-sheet" data-kit-sheet="${e(sheet.id)}">${sheet.mode === 'sample' ? '<p class="kits-sample">ⓘ Sample data · invented kit</p>' : ''}<p class="kit-sheet-subtitle">${e(sheet.series)}${sheet.series && sheet.launch ? ' · ' : ''}${e(sheet.launch)}</p>${kitMoveHtml(sheet.move)}<ol class="kit-checklist">${KIT_STEPS.map((step, index) => `<li class="${index === sheet.gate ? 'kit-step-now' : ''}"><span aria-hidden="true">${index < sheet.gate ? '✓' : index === sheet.gate ? '●' : '○'}</span><span>${step} <small>${index < sheet.gate ? 'done' : index === sheet.gate ? 'now' : 'to come'}</small></span></li>`).join('')}</ol>${sheet.nextDate || sheet.milestone ? `<section class="kit-detail-block"><h4>Dates</h4>${sheet.nextDate ? `<p>${e(sheet.nextDate)}</p>` : ''}${sheet.milestone ? `<p>${e(sheet.milestone)}</p>` : ''}</section>` : ''}${sheet.waiting ? `<section class="kit-detail-block"><h4>Waiting on</h4><p>${e(sheet.waiting.with)}${sheet.waiting.days !== null ? ` · ${sheet.waiting.days} ${sheet.waiting.days === 1 ? 'day' : 'days'}` : ''}</p></section>` : ''}${sheet.note ? `<section class="kit-detail-block"><h4>Note</h4><p>${e(sheet.note)}</p></section>` : ''}${sheet.ordersNotice ? `<p class="kits-notice">${e(sheet.ordersNotice)}</p>` : ''}${kitOrdersHtml(sheet.orders)}</div>`;
}
