import { escapeCreative as e } from '../creatives/html.js';
import type { HomeTests, HomeTestRow } from './presentation-types.js';

const labels = {
  live: ['Id', 'Lane', 'Question', 'Arms', 'Metric and bar', 'Started', 'Ends', 'Where measured', 'Status'],
  queue: ['Id', 'Lane', 'Question', 'Arms', 'Metric and bar', 'How it would run', 'Needs'],
  history: ['Id', 'Question', 'Verdict', 'Rule', 'Evidence'],
};
function controls(row: HomeTestRow): string {
  return row.called ? `<button class="act" type="button" data-hq-test-undo="${e(row.id)}">Undo</button>`
    : `<button class="act" type="button" data-hq-test-call="${e(row.id)}"${row.call ? '' : ' disabled'}>${e(row.call?.label ?? 'Call')}</button>`;
}
export function homeTestReadingHtml(row: HomeTestRow): string {
  const reading = row.reading, maximum = Math.max(...(reading?.arms.map(arm => Math.abs(arm.value)) ?? []), 1);
  const bars = reading ? reading.arms.map(arm => `<div class="tbar"><div class="tl2"><span>${arm.key.toUpperCase()} · n=${e(arm.count)}</span><b>${e(arm.formatted)}</b></div><div class="trk"><i class="fill" style="width:${Math.min(100, Math.abs(arm.value) / maximum * 100)}%"></i></div></div>`).join('')
    : `<p class="hq-test-status">${e(row.status)}</p>`;
  return `<div class="tbody"><div class="tbars">${bars}</div><div class="tsure"><svg viewBox="0 0 100 58" aria-label="How sure: ${reading ? `${e(reading.sure)}%` : 'no reading'}"><path d="M10 50A40 40 0 0 1 90 50" fill="none" stroke="var(--line)" stroke-width="7" pathLength="100"></path>${reading ? `<path d="M10 50A40 40 0 0 1 90 50" fill="none" stroke="${reading.sure >= 95 ? 'var(--good)' : 'var(--info)'}" stroke-width="7" pathLength="100" style="stroke-dasharray:${reading.sure} 100"></path>` : ''}<text x="50" y="43" text-anchor="middle" font-size="22" fill="var(--ink)">${reading ? `${e(reading.sure)}%` : '—'}</text><text x="50" y="55" text-anchor="middle" font-size="8" fill="var(--muted)">How sure</text></svg></div></div>`;
}
function featured(row: HomeTestRow): string {
  return `<article class="tcard" data-hq-test-id="${e(row.id)}" data-state="${row.call ? 'decide' : 'info'}" data-source="github-hq" data-mode="live"><div class="thead"><span class="tlane">Featured · ${e(row.lane)}</span><button class="rt" type="button" data-hq-test-open="${e(row.id)}"><h3 class="test-name">${e(row.title)}</h3></button><span class="chip ${row.call ? 'decide' : 'info'}">${row.call ? '◆ Decide' : 'i Info'}</span></div>${homeTestReadingHtml(row)}<p class="tsay hq-test-status">${e(row.status)}</p><div class="tfoot"><span class="tprog">${e(row.model?.presentation.progress ?? '')}</span><div class="acts">${controls(row)}</div></div></article>`;
}
function listRow(row: HomeTestRow): string {
  return `<div class="trow" data-hq-test-id="${e(row.id)}" data-source="github-hq" data-mode="live"><span class="test-stage">${e(row.section === 'live' ? 'Live' : row.section === 'queue' ? 'Next' : row.cells[2] || 'Recorded')}</span><button class="rt" type="button" data-hq-test-open="${e(row.id)}"><h3 class="test-name">${e(row.title)}</h3>${row.called ? `<small>${e(row.status)}</small>` : ''}</button>${row.section === 'live' ? controls(row) : ''}</div>`;
}
/** Only invoked for a live app. The existing sample chapter keeps its exact renderer. */
export function homeTestsHtml(view: HomeTests): string {
  const live = view.rows.filter(row => row.section === 'live'), first = live[0];
  const rest = [...live.slice(1), ...view.rows.filter(row => row.section === 'queue'), ...view.rows.filter(row => row.section === 'history')];
  return `<header class="chapter-heading"><span class="chapter-number" aria-hidden="true">3</span><div class="chapter-copy"><p class="chapter-eyebrow">Experiments</p><h2 class="chapter-title" id="tests-title">Tests</h2></div><span class="shm" id="testcount">${view.readAt ? `${live.length} live` : 'Waiting'}</span></header>${!view.readAt ? '<p class="hq-tests-waiting">Tests: waiting for the register</p>'
    : `${first ? featured(first) : '<p class="hq-tests-waiting">No live tests in the register.</p>'}<div class="test-list">${rest.slice(0, 3).map(listRow).join('')}${rest.length > 3 ? `<details class="test-more"><summary>+${rest.length - 3} more</summary><div class="trows">${rest.slice(3).map(listRow).join('')}</div></details>` : ''}</div>`}<p id="hq-tests-feedback" role="status" aria-live="polite"></p>`;
}
export function homeTestSheetHtml(row: HomeTestRow, href: string): string {
  return `${row.section === 'live' ? homeTestReadingHtml(row) : ''}<dl class="hq-test-detail">${row.cells.map((cell, index) => `<dt>${e(labels[row.section][index] ?? 'Detail')}</dt><dd>${e(cell)}</dd>`).join('')}</dl>${row.section === 'live' ? `<p>${e(row.status)}</p><div class="acts">${controls(row)}</div>` : ''}<a class="btn" href="${e(href)}" target="_blank" rel="noopener noreferrer">Open register</a>`;
}
export function homeTestsDialogHtml(): string {
  return '<dialog id="hq-tests-dialog" aria-labelledby="hq-tests-title"><div class="sheet"><div class="sheet-head"><h2 id="hq-tests-title">Test</h2><button class="btn" id="hq-tests-close" type="button">Close</button></div><div id="hq-tests-body"></div><p id="hq-tests-status" role="status" aria-live="polite"></p></div></dialog>';
}
