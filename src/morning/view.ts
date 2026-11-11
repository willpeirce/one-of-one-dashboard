import { escapeCreative as e } from '../creatives/html.js';
import { tickerHead, tickerHtml } from '../ticker/view.js';
import type { MorningAway, MorningBrief, MorningButton, MorningCard, MorningFigure, MorningSnapshot, MorningTone } from './model-types.js';

export type MorningWindow = '1' | '3' | '7';
export interface MorningViewOptions { window?: MorningWindow; confirm?: string; error?: string }
const tones: Record<MorningTone | 'good', {icon: string; label: string}> = {
  alarm: {icon: '✕', label: 'Alarm'}, decide: {icon: '◆', label: 'Decide'}, warn: {icon: '△', label: 'Watch'},
  info: {icon: 'ⓘ', label: 'Info'}, done: {icon: '✓', label: 'Done for you'}, good: {icon: '✓', label: 'Good'},
};
export const morningChip = (tone: MorningTone | 'good'): string => `<span class="mn-chip mn-${tone}"><span aria-hidden="true">${tones[tone].icon}</span> ${tones[tone].label}</span>`;
export function morningDay(day: string): string {
  try { return new Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short'}).format(new Date(`${day}T12:00:00Z`)).replaceAll(',', ''); }
  catch { return day; }
}
function href(value: string): string { return value.startsWith('/') && !value.startsWith('//') || /^https:\/\//.test(value) ? value : '/sources'; }
const bounded = (value: number, maximum = 100): number => Number.isFinite(value) ? Math.max(0, Math.min(maximum, value)) : 0;
function sourceMark(source: string): string {
  // These are the source paths already used in the dashboard's symbol sheet.
  const path = /meta/i.test(source) ? 'M12 12c-2-4-4-6-6.5-6S2 8.5 2 12s1 6 3.5 6 4.5-2 6.5-6 4-6 6.5-6S22 8.5 22 12s-1 6-3.5 6-4.5-2-6.5-6z'
    : /google/i.test(source) ? 'M19.8 7.5A9 9 0 1 0 21 12H12'
    : /shopify/i.test(source) ? 'M6 7h12l1 14H5z M9 7a3 3 0 0 1 6 0'
    : /date/i.test(source) ? 'M4 5h16v15H4z M4 10h16 M8 3v4 M16 3v4'
    : 'M4 17a8 8 0 0 1 16 0 M12 17l4-5';
  return `<svg class="mn-source-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"></path></svg>`;
}
function meter(strength: 1 | 2 | 3): string {
  const word = strength === 3 ? 'Strong' : strength === 2 ? 'Likely' : 'Hint';
  return `<span class="mn-strength" data-mn-strength="${strength}" aria-label="${word}">${[1, 2, 3].map(n => `<i${n <= strength ? ' class="mn-filled"' : ''} aria-hidden="true"></i>`).join('')}<span>${word}</span></span>`;
}
function figureBody(figure: MorningFigure, window: MorningWindow): string {
  if (figure.kind === 'list') {
    const rows = figure.rows.slice(0, 8), more = Math.max(0, figure.more) + Math.max(0, figure.rows.length - rows.length);
    return `<span class="mn-list" role="list">${rows.map(row => `<span class="mn-list-row" role="listitem"><span>${e(row.label)}</span><strong>${e(row.value)}</strong></span>`).join('')}</span>${more ? `<span class="mn-list-more">+${e(more)} more</span>` : ''}`;
  }
  if (figure.kind === 'dial') {
    const maximum = Math.max(figure.value, figure.bar, 1) * 1.2;
    const angle = Math.PI * (1 - bounded(figure.bar / maximum, 1));
    const tick = [100 + 72 * Math.cos(angle), 92 - 72 * Math.sin(angle), 100 + 88 * Math.cos(angle), 92 - 88 * Math.sin(angle)];
    return `<svg class="mn-dial" viewBox="0 0 200 112" aria-hidden="true"><path class="mn-dial-track" d="M20 92a80 80 0 0 1 160 0" pathLength="100"></path><path class="mn-dial-value" d="M20 92a80 80 0 0 1 160 0" pathLength="100" style="stroke-dasharray:${bounded(figure.value / maximum * 100)} 100"></path><path class="mn-dial-tick" d="M${tick[0]} ${tick[1]}L${tick[2]} ${tick[3]}"></path></svg><strong class="mn-number">${e(figure.formattedValue)}</strong><span class="mn-figure-label">${e(figure.label)} · bar ${e(figure.formattedBar)}</span>`;
  }
  if (figure.kind === 'rail') return `<strong class="mn-number">${e(figure.label)}</strong><span class="mn-rail" aria-hidden="true"><i style="width:${bounded(figure.value / (figure.range || 14) * 100)}%"></i><b></b><b></b><b></b><b></b></span>`;
  if (figure.kind === 'thumb') return `<span class="mn-portrait"><img src="${e(figure.src)}" alt="${e(figure.alt)}"><span class="mn-image-number"><strong>${e(figure.value)}</strong><small>${e(figure.label)}</small></span></span>`;
  if (figure.kind === 'brief') {
    const selected = figure.variants[window];
    return `${selected.bullets.length ? `<ol class="mn-bullets">${selected.bullets.slice(0, 3).map(bullet => `<li><span class="mn-bullet-text">${e(bullet.text)}</span>${meter(bullet.strength)}</li>`).join('')}</ol>` : `<p class="mn-brief-empty">${e(selected.text)}</p>`}<small class="mn-brief-footer">${e(selected.footer)}</small>`;
  }
  if (figure.kind === 'arms') {
    // Never an empty picture: a call card with no arms says so in words.
    if (!figure.arms.length) return '<strong class="mn-number">No reading</strong><span class="mn-figure-label">No reading stored</span>';
    const maximum = Math.max(...figure.arms.map(arm => Math.abs(arm.value)), 1);
    return `<span class="mn-arms">${figure.arms.slice(0, 2).map(arm => `<span class="mn-arm"><span><b>${e(arm.label)}</b><strong>${e(arm.formatted)}</strong></span><i><b style="width:${bounded(Math.abs(arm.value) / maximum * 100)}%"></b></i><small>n=${e(arm.count)}</small></span>`).join('')}</span><span class="mn-sure${figure.eligible ? ' mn-eligible' : ''}"><svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="26" pathLength="100"></circle><circle class="mn-sure-value" cx="32" cy="32" r="26" pathLength="100" style="stroke-dasharray:${bounded(figure.sure ?? 0)} 100"></circle></svg><strong>${figure.sure === null ? '—' : `${e(figure.sure)}%`}</strong><small>How sure</small></span>`;
  }
  return `<strong class="mn-number">${e(figure.value)}</strong><span class="mn-figure-label">${e(figure.label)}</span>`;
}
function figureHtml(card: MorningCard, window: MorningWindow): string {
  const tabs = card.figure.kind === 'brief' ? `<div class="mn-window" role="group" aria-label="Brief evidence window">${(['1', '3', '7'] as const).map(day => `<button type="button" data-mn-window="${day}" aria-pressed="${day === window}">${day} ${day === '1' ? 'day' : 'days'}</button>`).join('')}</div>` : '';
  return `<div class="mn-well mn-figure-${card.figure.kind}">${tabs}<button id="mn-figure" class="mn-figure-button" type="button" aria-haspopup="dialog" aria-controls="mn-dialog" aria-label="Why: ${e(card.title)}">${figureBody(card.figure, window)}<span class="mn-figure-hint">Why, rule & source ›</span></button></div>`;
}
function buttonHtml(button: MorningButton, position: string, id?: string, menu = false): string {
  const attrs = `${id ? ` id="${id}"` : ''} class="${menu ? 'mn-menu-action' : position === 'primary' ? 'mn-primary' : 'mn-secondary'}" data-mn-button="${e(position)}" data-mn-button-kind="${button.kind}"`;
  const text = `<strong>${e(button.label)}</strong>${menu && button.subline ? `<small>${e(button.subline)}</small>` : ''}`;
  return button.kind === 'link' ? `<a${attrs} href="${e(href(button.href))}">${text}</a>` : `<button${attrs} type="button">${text}</button>`;
}
export function morningCardHtml(card: MorningCard, options: MorningViewOptions = {}): string {
  const controls = options.confirm ? `<p class="mn-confirm-question">${e(options.confirm)}</p><div class="mn-confirm-actions"><button type="button" id="mn-confirm" class="mn-primary">Confirm</button><button type="button" id="mn-cancel" class="mn-secondary">Cancel</button></div>`
    : `${buttonHtml(card.primary, 'primary', 'mn-primary')}<div class="mn-second-row">${card.secondary ? buttonHtml(card.secondary, 'secondary', 'mn-secondary') : '<span></span>'}${card.menu.length ? '<button type="button" class="mn-menu-button" id="mn-menu" aria-label="More actions" aria-haspopup="dialog" aria-controls="mn-dialog">⋯</button>' : ''}</div>`;
  return `<article id="mn-card" class="mn-card" data-mn-card="${e(card.key)}" data-mn-kind="${card.kind}" data-mn-figure="${card.figure.kind}" data-state="${card.state}"><div class="mn-card-label">${morningChip(card.state)}<span class="mn-lane">${e(card.lane)}</span>${sourceMark(card.source)}</div><h2 id="mn-card-title" class="mn-card-title" tabindex="-1">${e(card.title)}</h2>${figureHtml(card, options.window ?? '3')}${card.flag ? `<p class="mn-flag">△ ${e(card.flag)}</p>` : ''}${options.error ? `<p id="mn-error" class="mn-error" role="alert">✕ ${e(options.error)}</p>` : card.whyLine ? `<p class="mn-why-line">${e(card.whyLine)}</p>` : ''}<div id="mn-controls" class="mn-controls">${controls}</div><span class="mn-stamp" id="mn-stamp" aria-hidden="true"></span></article>`;
}
function historyHtml(snapshot: MorningSnapshot): string {
  const rows = [
    ...snapshot.presses.map(row => `<li><span><strong>${e(row.title)}</strong><small>${row.state === 'hidden' ? 'Hidden' : row.answer === 'hold' ? `Held until ${e(morningDay(row.untilDay!))}` : row.answer ? `Called ${e(row.answer.toUpperCase())} · waiting for the write-up` : row.state === 'parked' ? 'Parked' : 'Seen'}</small></span><button type="button" data-mn-put-back="${e(row.cardKey)}">Put back</button></li>`),
    ...snapshot.passedDates.map(row => `<li><span><strong>${e(row.name)}</strong><small>Date covered</small></span><button type="button" data-mn-ticker-restore="${e(row.key)}">Put back</button></li>`),
    ...snapshot.metaActions.map(row => `<li><span><strong>${e(row.title)}</strong><small>${row.undoneAt ? 'Undone' : 'Saved in Meta'}</small></span>${row.undo ? `<button type="button" data-mn-live-undo="${e(row.id)}">Undo</button>` : ''}</li>`),
  ];
  return `<section class="mn-history"><h3>What you did</h3><ul id="mn-done-list">${rows.join('') || '<li><span>No presses yet today.</span></li>'}</ul></section>`;
}
export function morningDeckHtml(snapshot: MorningSnapshot, options: MorningViewOptions = {}): string {
  return snapshot.cards[0] ? `<div class="mn-stack" data-mn-stack="${Math.min(3, snapshot.cards.length)}">${morningCardHtml(snapshot.cards[0], options)}</div>`
    : `<section id="mn-all-clear" class="mn-all-clear"><span class="mn-clear-mark" aria-hidden="true">✓</span><h2 tabindex="-1">All clear</h2><p>${snapshot.watchOnHome ? `Your Morning deck is clear. ${snapshot.watchOnHome} Watch ${snapshot.watchOnHome === 1 ? 'card is' : 'cards are'} on Home.` : 'Nothing else needs you this morning.'}</p>${options.error ? `<p id="mn-error" class="mn-error" role="alert">✕ ${e(options.error)}</p>` : ''}${historyHtml(snapshot)}</section>`;
}
export function morningProgressHtml(snapshot: MorningSnapshot): string {
  const done = Math.min(snapshot.completed, snapshot.total), current = snapshot.cards.length ? Math.min(done + 1, snapshot.total) : done;
  return `${snapshot.total <= 8 ? `<span class="mn-pips" aria-hidden="true">${Array.from({length: snapshot.total}, (_, index) => `<i class="${index < done ? 'mn-pip-done' : snapshot.cards.length && index === done ? 'mn-pip-current' : ''}"></i>`).join('')}</span>` : ''}<span>${snapshot.total ? `${current} of ${snapshot.total}` : 'All clear'}</span>`;
}
export function morningLinesHtml(snapshot: MorningSnapshot): string {
  const brief = snapshot.brief;
  const watch = snapshot.watchOnHome
    ? `<a class="mn-watch-line" id="mn-more-home" href="/?from=morning"><span aria-hidden="true">△</span> Watch · ${snapshot.watchOnHome} on Home</a>`
    : '<span class="mn-watch-line" id="mn-watch-none"><span aria-hidden="true">△</span> Watch · none</span>';
  const coverage = brief?.moreHere ? ` · ${brief.moreHere} more here` : brief?.allInDeck ? ' · all in the deck' : '';
  const nudge = snapshot.summaryEnabled ? '<a id="mn-push-nudge" href="/settings#notifications" hidden>Notifications are off on this device</a>' : '';
  return `<div class="mn-summary-lines"><div class="mn-status-row"><button type="button" id="mn-good" class="mn-good-line" aria-haspopup="dialog"><span aria-hidden="true">✓</span> Good · ${snapshot.fine.length} fine</button>${watch}</div>${brief ? `<button type="button" class="mn-brief-line" id="mn-brief" data-mn-brief="${brief.status}" aria-haspopup="dialog"><span>${brief.status === 'ok' ? '✓ Good · ' : brief.status === 'unreadable' || brief.tone === 'warn' ? '△ Watch · ' : ''}${e(brief.text)}${e(coverage)}${brief.mode === 'sample' ? ' · Sample data' : ''}</span></button>` : ''}</div>${nudge}`;
}
export function morningBriefHtml(brief: MorningBrief): string {
  const diagnostics = brief.registerDiagnostics;
  const registerNotes = [
    diagnostics?.malformed ? `${diagnostics.malformed} malformed ${diagnostics.malformed === 1 ? 'row' : 'rows'} skipped` : '',
    diagnostics?.capped ? `${diagnostics.capped} ${diagnostics.capped === 1 ? 'row' : 'rows'} beyond the section cap` : '',
    diagnostics?.missingHeadings ? 'One or more register headings are missing' : '',
  ].filter(Boolean);
  const status = brief.status === 'ok' ? '✓ Good' : brief.status === 'needs' ? '△ Watch'
    : brief.status === 'unreadable' ? "△ Watch · Couldn't read"
    : brief.status === 'key' ? 'i Info · Needs its key' : `${brief.tone === 'warn' ? '△ Watch' : 'i Info'} · Not here yet`;
  return `<p>${e(brief.day ? morningDay(brief.day) : 'Morning check')}</p><p>${e(brief.runLabel ?? brief.text)}</p><p>${e(status)}${brief.count !== undefined ? ` · ${brief.count} ${brief.count === 1 ? 'item' : 'items'}` : ''}</p>${brief.items?.length ? `<ol>${brief.items.map(item => `<li>${e(item.text)}${item.lines?.length ? `<ul>${item.lines.map(line => `<li>${e(line)}</li>`).join('')}</ul>` : ''}</li>`).join('')}</ol>` : ''}${brief.firstLines?.length ? `<pre>${e(brief.firstLines.join('\n'))}</pre>` : ''}${brief.malformedCardTags ? `<p>Morning check · ${e(brief.malformedCardTags)} malformed Card ${brief.malformedCardTags === 1 ? 'tag' : 'tags'} ignored.</p>` : ''}${registerNotes.length ? `<p>Test register · ${registerNotes.join(' · ')}</p>` : ''}${brief.href ? `<a class="mn-sheet-link" href="${e(href(brief.href))}">${brief.status === 'key' ? 'Open source health' : 'Open source'} ›</a>` : ''}`;
}
export function morningFineHtml(snapshot: MorningSnapshot, expanded = false): string {
  const away = [...snapshot.parked, ...snapshot.hidden];
  const rowHtml = (row: MorningAway): string => `<li><span><strong>${e(row.title)}</strong><small>${e(row.reason)}${row.untilDay ? ` · back ${e(morningDay(row.untilDay))}` : ''}</small></span><button type="button" data-mn-put-back="${e(row.stateRow.cardKey)}">Put back</button></li>`;
  const dated = snapshot.datedFromCheck?.length ? `<section><h3>Dated, from the check</h3><ul>${snapshot.datedFromCheck.map(item => `<li>${e(item.text)}${item.lines?.length ? `<ul>${item.lines.map(line => `<li>${e(line)}</li>`).join('')}</ul>` : ''}</li>`).join('')}</ul></section>` : '';
  return `<ul class="mn-fine-list">${snapshot.fine.map(row => `<li>✓ ${e(row.label)}</li>`).join('') || '<li>No passing checks are recorded yet.</li>'}</ul>${dated}<h3>Parked and hidden</h3><ul id="mn-away-list" class="mn-away-list">${away.slice(0, expanded ? undefined : 3).map(rowHtml).join('') || '<li>Nothing parked or hidden.</li>'}</ul>${away.length > 3 ? `<button type="button" id="mn-away-more" aria-expanded="${expanded}">${expanded ? 'Show fewer' : `+${away.length - 3} more`}</button>` : ''}`;
}
export function morningWhyHtml(card: MorningCard, window: MorningWindow = '3'): string {
  const why = card.figure.kind === 'brief' ? card.figure.variants[window].text : card.why;
  return `<section><h3>Why</h3><p class="mn-brief-evidence">${e(why)}</p></section><section><h3>The rule</h3><p>${e(card.rule)}</p></section><section><h3>The source</h3><p>${e(card.sourceLine)}</p></section>${card.sourceHref ? `<a class="mn-sheet-link" href="${e(href(card.sourceHref))}">Open ${card.kind.startsWith('meta-') || card.kind === 'done-for-you' ? 'ad set' : card.kind === 'fading' || card.kind === 'make-next' ? 'creative' : 'source'} ›</a>` : ''}`;
}
export function morningMenuHtml(card: MorningCard): string { return `<div class="mn-menu-list">${card.menu.map((button, index) => buttonHtml(button, `menu-${index}`, undefined, true)).join('')}</div>`; }
export function morningPage(snapshot: MorningSnapshot): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="color-scheme" content="dark"><title>Morning · Pulse</title><link rel="stylesheet" href="/assets/fonts.css"><link rel="stylesheet" href="/assets/dashboard.css"><link rel="stylesheet" href="/assets/morning.css"><script type="module" src="/assets/morning.js"></script>${tickerHead()}</head><body class="mn-root" id="mn-root"><div class="sky" aria-hidden="true"></div><header class="top mn-top"><div class="mn-header"><a class="mn-logo" href="/morning" aria-label="Pulse Morning"><img src="/assets/logo.png" alt="One of One" width="500" height="312"></a><nav class="mn-nav" aria-label="Main"><a href="/morning" aria-current="page">Morning</a><a href="/?from=morning">Home</a></nav></div></header>${tickerHtml()}<main class="mn-main" id="main"><div class="mn-frame"><header class="mn-head"><div><h1>Morning</h1><p id="mn-day">${e(morningDay(snapshot.day))}${snapshot.mode === 'sample' ? ' · Sample data' : ''}</p></div><div id="mn-progress" class="mn-progress" aria-label="Morning progress">${morningProgressHtml(snapshot)}</div></header><div id="mn-stage" class="mn-stage">${morningDeckHtml(snapshot)}</div><div id="mn-lines" class="mn-lines">${morningLinesHtml(snapshot)}</div></div><p id="mn-read-status" class="mn-read-status" role="status" aria-live="polite"></p></main><p id="mn-feedback" class="mn-sr-only" role="status" aria-live="polite" aria-atomic="true"></p><div id="mn-toast" class="mn-toast" hidden><p id="mn-toast-message" role="status" aria-live="polite" aria-atomic="true"></p><button type="button" id="mn-undo" hidden>Undo</button><span class="mn-toast-drain" aria-hidden="true"></span></div><dialog id="mn-dialog" class="mn-dialog" aria-labelledby="mn-sheet-title"><header class="mn-dialog-head"><h2 id="mn-sheet-title"></h2><button type="button" id="mn-close">Close</button></header><div id="mn-sheet-body" class="mn-sheet-body"></div><p id="mn-sheet-status" role="status" aria-live="polite" aria-atomic="true"></p></dialog><template id="mn-initial">${e(JSON.stringify(snapshot))}</template></body></html>`;
}
