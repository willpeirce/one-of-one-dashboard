import {escapeCreative as e} from '../creatives/html.js';
import {formatNumber, formatPounds} from '../money.js';
import {formatUkTime} from '../uk-time.js';
import type {IssueCase, IssuesView} from './model.js';
import type {IssueCosts, IssueCostMonth} from './costs.js';
import type {IssueCasesPage} from './presentation-types.js';
import {issueDoubled} from './trend.js';

export const issueReasonLabel = (reason: string): string => reason.charAt(0).toUpperCase() + reason.slice(1);
export function issueMonthLabel(month: string): string {
  return new Intl.DateTimeFormat('en-GB', {timeZone: 'UTC', month: 'long', year: 'numeric'}).format(new Date(`${month}-01T12:00:00Z`));
}
function costMonthHtml(month: IssueCostMonth, label: string): string {
  const amount = month.complete && month.totalPence !== null ? formatPounds(month.totalPence / 100)
    : month.knownPence !== null ? `${formatPounds(month.knownPence / 100)} known` : 'Unavailable';
  const parts = month.orders === null ? [] : [
    `${formatNumber(month.orders)} replacement ${month.orders === 1 ? 'order' : 'orders'}`,
    month.actualFulfilmentOrders ? `${formatNumber(month.actualFulfilmentOrders)} actual fulfilment` : '',
    month.estimatedFulfilmentOrders ? `${formatNumber(month.estimatedFulfilmentOrders)} estimated fulfilment` : '',
    month.settingsCostOrders ? `${formatNumber(month.settingsCostOrders)} using Settings item costs` : '',
    month.unknownFulfilmentOrders ? `${formatNumber(month.unknownFulfilmentOrders)} missing fulfilment` : '',
    month.unknownLineCostOrders ? `${formatNumber(month.unknownLineCostOrders)} missing item costs` : '',
    !month.historyComplete ? 'Order history incomplete' : '',
  ].filter(Boolean);
  if (month.unknownClassificationOrders) parts.push(`${formatNumber(month.unknownClassificationOrders)} orders awaiting replacement tags`);
  const state = !month.complete ? '△ Incomplete' : month.estimatedFulfilmentOrders || month.settingsCostOrders ? 'ⓘ Includes estimates' : '✓ Complete';
  return `<article class="issues-cost" data-issues-cost="${e(month.month)}"><p>${e(label)} <span>${e(issueMonthLabel(month.month))}</span></p><strong>${e(amount)}</strong><small>${month.orders === null ? month.unknownClassificationOrders ? '△ Replacement tags incomplete' : 'ⓘ Waiting for an order reading' : state}</small>${parts.length ? `<p class="issues-cost-detail">${e(parts.join(' · '))}</p>` : ''}</article>`;
}
export function issueCostsHtml(costs: IssueCosts): string {
  if (costs.status === 'suppressed') return '<section class="issues-costs"><h3>Cost of fixes</h3><p class="handover-context">ⓘ Shopify is waiting for keys. No sample replacement costs are mixed with live cases.</p></section>';
  return `<section class="issues-costs" data-issues-costs><h3>Cost of fixes</h3><p class="handover-context">Replacement and resend items at landed cost, plus actual or estimated fulfilment. Earlier orders may use the earliest observed item cost.${costs.mode === 'sample' ? ' Sample data · invented orders.' : ''}${costs.checkedAt ? ` Read ${e(formatUkTime(costs.checkedAt))}.` : ''}</p>${costs.status === 'unavailable' ? '<p class="handover-context issues-watch">△ Watch · The latest order reading is unavailable.</p>' : ''}<div class="issues-cost-grid">${costMonthHtml(costs.current, 'This month so far')}${costMonthHtml(costs.previous, 'Last month')}</div></section>`;
}
export function issuesDialogHtml(): string {
  return '<dialog id="issues-sheet" aria-labelledby="issues-sheet-title"><div class="sheet"><div class="grab" aria-hidden="true"></div><header class="issues-sheet-head"><h2 id="issues-sheet-title">Issue cases</h2><button class="btn" type="button" data-issues-close>Close</button></header><div id="issues-sheet-body"></div><p id="issues-sheet-message" role="status" aria-live="polite"></p></div></dialog>';
}
export function issuesSectionHtml(view: IssuesView, costs: IssueCosts): string {
  const pending = view.status === 'pending';
  return `<link rel="stylesheet" href="/assets/issues.css"><div class="issues-body" data-issues-root data-mode="${view.mode}" data-this-month="${e(view.thisMonth)}" data-last-month="${e(view.lastMonth)}">${view.mode === 'sample' ? '<p class="sample-banner">Sample data · invented cases and counts.</p>' : ''}${pending ? '<p class="handover-notice">ⓘ Waiting for the first Issues source reading. Missing readings are not zero cases.</p>' : view.status === 'unavailable' ? '<p class="handover-notice" data-state="watch">△ Watch · A source is unavailable. Cases from the last successful readings are shown.</p>' : ''}${view.notes.length ? `<ul class="issues-source-notes">${view.notes.map(note => `<li>ⓘ ${e(note)}</li>`).join('')}</ul>` : ''}<table class="issues-table"><caption>Cases by reason · each identified order counts once</caption><thead><tr><th scope="col">Reason</th><th scope="col">This month<small>${e(issueMonthLabel(view.thisMonth))}</small></th><th scope="col">Last month<small>${e(issueMonthLabel(view.lastMonth))}</small></th></tr></thead><tbody>${view.rows.map(row => `<tr><th scope="row"><button type="button" data-issue-reason="${e(row.reason)}" aria-haspopup="dialog"${pending || !row.current && !row.previous ? ' disabled' : ''}><span>${e(issueReasonLabel(row.reason))}</span>${!pending && issueDoubled(row.current, row.previous) ? '<small class="issues-watch">△ Watch</small>' : ''}</button></th><td data-issue-current>${pending ? '—' : formatNumber(row.current)}</td><td data-issue-previous>${pending ? '—' : formatNumber(row.previous)}</td></tr>`).join('')}</tbody></table>${issueCostsHtml(costs)}<p class="handover-context">ⓘ Keyword and tag rules only. A case may join a review and a ticket when both stored texts name the same order. Nothing changes in either source.</p></div>${issuesDialogHtml()}`;
}
export function safeIssueTicketHref(href: string | null): string | null {
  if (!href) return null;
  try {
    const url = new URL(href);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && /^[a-z0-9][a-z0-9-]*\.gorgias\.com$/i.test(url.hostname)
      && /^\/app\/ticket\/\d{1,25}$/.test(url.pathname) && !url.search && !url.hash ? url.href : null;
  } catch {return null;}
}
function issueCaseHtml(row: IssueCase, sample: boolean): string {
  const href = sample ? null : safeIssueTicketHref(row.ticketHref);
  const date = new Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/London', day: 'numeric', month: 'short', year: 'numeric'}).format(new Date(row.createdAt));
  const sources = row.sources.map(source => source === 'judgeme' ? 'Review' : 'Gorgias ticket').join(' + ');
  return `<article class="issues-case" data-issue-case="${e(row.id)}"><header><strong>${e(row.reference)}</strong><span>${e(date)}</span></header><p class="issues-case-source">ⓘ ${e(sources)}</p>${row.quote ? `<blockquote data-issue-quote>${e(Array.from(row.quote).slice(0, 120).join(''))}</blockquote>` : ''}${href ? `<a class="btn" href="${e(href)}" target="_blank" rel="noopener noreferrer" data-issue-ticket>Open ticket</a>` : row.sources.includes('gorgias') ? `<p class="issues-case-source">ⓘ ${sample ? 'Sample ticket · no live link' : 'Ticket link unavailable'}</p>` : ''}</article>`;
}
export function issuesCasesHtml(page: IssueCasesPage): string {
  if (page.status === 'pending') return '<p class="handover-context">ⓘ Waiting for the first Issues source reading. Missing readings are not zero cases.</p>';
  return `${page.mode === 'sample' ? '<p class="sample-banner">Sample data · invented cases.</p>' : ''}${page.status === 'unavailable' ? '<p class="handover-context issues-watch">△ Watch · Last saved cases are shown.</p>' : ''}${[[page.thisMonth, page.current], [page.lastMonth, page.previous]].map(([month, count]) => {
    const rows = page.cases.filter(row => row.month === month);
    return `<section class="issues-case-month"><h3>${e(issueMonthLabel(String(month)))} · ${formatNumber(Number(count))} ${count === 1 ? 'case' : 'cases'}</h3>${rows.map(row => issueCaseHtml(row, page.mode === 'sample')).join('') || `<p class="handover-context">${Number(count) ? 'ⓘ Load more to see this month’s cases.' : '✓ No cases in the stored reading.'}</p>`}</section>`;
  }).join('')}<p class="handover-context" data-issues-case-count>${formatNumber(page.cases.length)} of ${formatNumber(page.total)} cases shown.</p>${page.nextOffset !== null ? '<button class="btn" type="button" data-issues-more>Load more cases</button>' : ''}`;
}
