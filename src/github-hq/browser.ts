import type { MorningSnapshot } from '../morning/model-types.js';
import { escapeCreative as e } from '../creatives/html.js';
import type { HomeTests, HomeTestRow } from './presentation-types.js';
import { homeTestsDialogHtml, homeTestSheetHtml, homeTestsHtml } from './view.js';

let current: HomeTests | undefined, refresh: (() => Promise<void>) | undefined, installed = false, busy = false;
let pending: HomeTestRow | null = null, opener: HTMLElement | null = null;
const element = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
function render(): void {
  if (!current) return;
  const root = element('tests'); root.dataset.hqTests = 'live'; root.innerHTML = homeTestsHtml(current);
}
function close(): void {
  element<HTMLDialogElement>('hq-tests-dialog').close(); pending = null;
  if (opener?.isConnected) opener.focus();
  else document.querySelector<HTMLElement>('#tests button:not(:disabled)')?.focus();
}
function show(row: HomeTestRow, source: HTMLElement, confirm = false): void {
  if (busy || !current) return;
  opener = source; pending = confirm ? row : null;
  element('hq-tests-title').textContent = confirm ? 'Confirm call' : row.title;
  element('hq-tests-body').innerHTML = confirm && row.call
    ? `<p>${e(row.call.confirm)}</p><div class="acts"><button class="btn" type="button" id="hq-tests-confirm">Confirm</button><button class="btn" type="button" id="hq-tests-cancel">Cancel</button></div>`
    : homeTestSheetHtml(row, current.href);
  element('hq-tests-status').textContent = '';
  const dialog = element<HTMLDialogElement>('hq-tests-dialog'); if (!dialog.open) dialog.showModal();
  element('hq-tests-close').focus();
}
async function press(row: HomeTestRow, undo = false): Promise<void> {
  const cardKey = undo ? row.called?.cardKey : row.call?.cardKey;
  if (busy || !cardKey) return;
  busy = true; const dialog = element<HTMLDialogElement>('hq-tests-dialog');
  document.querySelectorAll<HTMLButtonElement>('[data-hq-test-call],[data-hq-test-undo],#hq-tests-confirm').forEach(button => { button.disabled = true; });
  try {
    const response = await fetch('/api/morning/press', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ cardKey, action: undo ? 'undo' : 'call', ...(!undo ? { answer: row.call!.answer } : {}) }) });
    if (response.status === 401) { location.assign('/login'); return; }
    if (!response.ok) throw new Error(response.status === 409 ? 'This call has changed. Refresh and review it again.' : 'Could not save this call. Try again.');
    const result = await response.json() as MorningSnapshot;
    const answer = result.answers.find(saved => saved.cardKey === cardKey)?.answer;
    if (current) current = { ...current, rows: current.rows.map(item => item.id !== row.id ? item : { ...item, call: null,
      called: answer && answer !== 'hold' ? { cardKey, answer } : null,
      status: answer ? `Called ${answer.toUpperCase()} · waiting for the write-up` : item.cells[8] || 'No reading' }) };
    render();
    if (refresh) {
      try { await refresh(); }
      catch { element('hq-tests-feedback').textContent = 'Saved. Refresh to load the latest register.'; }
    }
    if (dialog.open) close();
  } catch (error) {
    render();
    (dialog.open ? element('hq-tests-status') : element('hq-tests-feedback')).textContent = error instanceof Error ? error.message : 'Could not save this call.';
  } finally {
    busy = false;
    const confirm = document.getElementById('hq-tests-confirm') as HTMLButtonElement | null; if (confirm) confirm.disabled = false;
    if (!dialog.open) (document.querySelector<HTMLElement>(`#tests [data-hq-test-id="${CSS.escape(row.id)}"] button:not(:disabled)`)
      ?? document.querySelector<HTMLElement>('#tests button:not(:disabled)'))?.focus();
  }
}
export function updateHomeTests(view: HomeTests | undefined, refreshDashboard: () => Promise<void>): void {
  current = view; refresh = refreshDashboard;
  if (!view) return;
  render();
  if (installed) return;
  installed = true;
  if (!document.getElementById('hq-tests-dialog')) document.body.insertAdjacentHTML('beforeend', homeTestsDialogHtml());
  const dialog = element<HTMLDialogElement>('hq-tests-dialog');
  element('hq-tests-close').addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-hq-test-open],[data-hq-test-call],[data-hq-test-undo],#hq-tests-confirm,#hq-tests-cancel') : null;
    if (!target || busy || !current) return;
    if (target.id === 'hq-tests-cancel') { close(); return; }
    if (target.id === 'hq-tests-confirm') { if (pending) void press(pending); return; }
    const id = target.dataset.hqTestOpen ?? target.dataset.hqTestCall ?? target.dataset.hqTestUndo;
    const row = current.rows.find(item => item.id === id); if (!row) return;
    if (target.hasAttribute('data-hq-test-undo')) { void press(row, true); return; }
    show(row, target, target.hasAttribute('data-hq-test-call'));
  });
}
