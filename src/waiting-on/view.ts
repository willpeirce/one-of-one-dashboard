import { escapeCreative as e } from '../creatives/html.js';
import { formatNumber } from '../money.js';
import { formatUkTime } from '../uk-time.js';
import { ukToday } from '../hero-range.js';
import type { WaitingDoneItem, WaitingItem, WaitingView } from './model.js';

function openItem(row: WaitingItem, threshold: number): string {
  return `<article class="glass waiting-row" data-waiting-item="${e(row.id)}"><div class="waiting-copy"><div class="waiting-heading"><h3>${e(row.contact)}</h3><span class="waiting-state" data-state="${row.days >= threshold ? 'watch' : 'info'}">${row.days >= threshold ? '△ Waiting' : 'ⓘ Waiting'} · ${formatNumber(row.days)} ${row.days === 1 ? 'day' : 'days'}</span></div><p>${e(row.subject)}</p><p class="waiting-meta">Since <time datetime="${e(row.since)}">${e(row.since)}</time> · ${row.source === 'manual' ? 'Added here' : 'Waiting-on file'}</p></div><button class="btn" type="button" data-waiting-action="done" data-waiting-id="${e(row.id)}">✓ Done</button></article>`;
}

function doneItem(row: WaitingDoneItem): string {
  return `<article class="glass waiting-row waiting-done-item" data-waiting-done-item="${e(row.id)}"><div class="waiting-copy"><div class="waiting-heading"><h3>${e(row.contact)}</h3><span class="waiting-state" data-state="good">✓ Done</span></div><p>${e(row.subject)}</p><p class="waiting-meta">Hidden here until ${e(row.returnsOn)}${row.source === 'hq' ? ', or until it leaves the file' : ''}.</p></div><button class="btn" type="button" data-waiting-action="restore" data-waiting-id="${e(row.id)}">↶ Put back</button></article>`;
}

function sourceLine(view: WaitingView): string {
  if (view.status === 'missing' || view.status === 'waiting_for_keys') return `<p class="handover-notice" data-waiting-source>ⓘ <strong>Not set up yet.</strong> ${view.status === 'waiting_for_keys' ? 'GitHub HQ is waiting for keys.' : 'The waiting-on file is not available yet.'} You can add local items below.</p>`;
  if (view.status === 'pending') return '<p class="handover-notice" data-waiting-source>ⓘ Waiting for the first file read. You can add local items below.</p>';
  if (view.status === 'unavailable') return '<p class="handover-notice" data-state="watch" data-waiting-source>△ Watch · The waiting-on file could not be read. Saved items are shown.</p>';
  return `<p class="handover-context" data-waiting-source>ⓘ From the waiting-on file${view.updatedLabel ? ` · Updated: ${e(view.updatedLabel)}` : ''}${view.readAt ? ` · read ${e(formatUkTime(view.readAt))}` : ''}.</p>`;
}

/** Refresh only this region after a local write so an unfinished manual form keeps its values. */
export function waitingRowsHtml(view: WaitingView): string {
  const rows = view.rows.map(row => openItem(row, view.thresholdDays));
  const diagnostics = [view.malformedRows ? `${formatNumber(view.malformedRows)} malformed ${view.malformedRows === 1 ? 'row' : 'rows'} skipped` : '',
    view.cappedRows ? `${formatNumber(view.cappedRows)} ${view.cappedRows === 1 ? 'row' : 'rows'} beyond the file limit` : ''].filter(Boolean);
  return `${sourceLine(view)}${diagnostics.length ? `<p class="handover-context waiting-diagnostics" data-waiting-diagnostics>△ Watch · ${diagnostics.join(' · ')}.</p>` : ''}<div class="waiting-list" data-waiting-open>${rows.slice(0, 6).join('') || `<p class="handover-context">${view.status === 'ready' ? '✓ Nothing waiting.' : 'ⓘ No saved items to show.'}</p>`}</div>${rows.length > 6 ? `<details class="handover-more" data-waiting-more><summary>⊕ ${formatNumber(rows.length - 6)} more waiting</summary><div class="waiting-list">${rows.slice(6).join('')}</div></details>` : ''}${view.done.length ? `<details class="handover-more" data-waiting-done><summary>✓ Done here · ${formatNumber(view.done.length)}</summary><div class="waiting-list">${view.done.map(doneItem).join('')}</div></details>` : ''}`;
}

export function waitingSectionHtml(view: WaitingView): string {
  const today = ukToday(new Date(view.asOf));
  return `<link rel="stylesheet" href="/assets/waiting-on.css"><div class="waiting-body" data-waiting-root><div class="waiting-body" data-waiting-rows>${waitingRowsHtml(view)}</div><div class="waiting-feedback" id="waiting-message" role="status" aria-live="polite"></div><details class="waiting-add"><summary>＋ Add an item</summary><form id="waiting-add-form"><p class="handover-context" id="waiting-form-help">Use a business contact or role. Do not enter customer names, email addresses, phone numbers or addresses. Saved here only.</p><div class="waiting-fields"><label for="waiting-contact">Contact<input id="waiting-contact" name="contact" type="text" autocomplete="off" required aria-describedby="waiting-form-help" placeholder="A supplier"></label><label for="waiting-subject">Subject<input id="waiting-subject" name="subject" type="text" autocomplete="off" required placeholder="An update on the sample"></label><label for="waiting-since">Since<input id="waiting-since" name="since" type="date" value="${e(today)}" max="${e(today)}" required></label></div><div class="waiting-form-actions"><button class="btn" type="submit">＋ Save item</button><button class="btn" type="reset">Clear</button></div></form></details><p class="handover-context">Days count UK calendar dates. Done hides an item here for up to 30 days; Put back restores it. Nothing changes in the source file.</p></div>`;
}
