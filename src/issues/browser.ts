import type {IssueCasesPage} from './presentation-types.js';
import {issueReasonLabel, issuesCasesHtml} from './view.js';

let installed = false, generation = 0, current: IssueCasesPage | undefined, opener: HTMLElement | null = null, busy = false;
const element = <T extends HTMLElement = HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;
class IssueReadError extends Error {constructor(readonly status: number) {super('Could not read issue cases.');}}
async function read(reason: string, offset = 0, version?: string): Promise<IssueCasesPage> {
  const query = new URLSearchParams({offset: String(offset), ...(version ? {version} : {})});
  const response = await fetch(`/api/issues/${encodeURIComponent(reason)}?${query}`, {credentials: 'same-origin', cache: 'no-store',
    headers: {Accept: 'application/json'}, signal: AbortSignal.timeout(10_000)});
  if (response.status === 401) {location.assign('/login'); throw new IssueReadError(401);}
  if (!response.ok) throw new IssueReadError(response.status);
  return await response.json() as IssueCasesPage;
}
function message(text: string): void {const target = element('issues-sheet-message'); if (target) target.textContent = text;}
export function issuesCanRefresh(): true | string {
  return element<HTMLDialogElement>('issues-sheet')?.open ? 'Close the issue cases before refreshing.' : true;
}
async function show(reason: string, source: HTMLElement): Promise<void> {
  const dialog = element<HTMLDialogElement>('issues-sheet'), body = element('issues-sheet-body'), title = element('issues-sheet-title');
  if (!dialog || !body || !title) return;
  const request = ++generation, root = document.querySelector<HTMLElement>('[data-issues-root]');
  current = undefined; opener = source; busy = false;
  title.textContent = issueReasonLabel(reason); body.innerHTML = '<p class="handover-context">ⓘ Loading cases…</p>'; message('');
  if (!dialog.open) dialog.showModal();
  dialog.querySelector<HTMLButtonElement>('[data-issues-close]')?.focus();
  try {
    const page = await read(reason);
    if (request !== generation || !dialog.open) return;
    if (page.reason !== reason || page.mode !== root?.dataset.mode || page.thisMonth !== root.dataset.thisMonth
      || page.lastMonth !== root.dataset.lastMonth) throw new IssueReadError(409);
    current = page; body.innerHTML = issuesCasesHtml(page);
  } catch (error) {
    if (request !== generation || !dialog.open) return;
    body.innerHTML = error instanceof IssueReadError && error.status === 409
      ? '<p class="handover-context">△ The source or month changed. Close, refresh Handover and open the reason again.</p>'
      : '<p class="handover-context">△ Cases could not be read. Close and open this reason to try again.</p>';
  }
}
async function more(button: HTMLButtonElement): Promise<void> {
  const page = current, request = generation, dialog = element<HTMLDialogElement>('issues-sheet');
  if (!page || page.nextOffset === null || busy || !dialog?.open) return;
  busy = true; button.disabled = true; message('ⓘ Loading more cases…');
  try {
    const next = await read(page.reason, page.nextOffset, page.version);
    if (request !== generation || current !== page || !dialog.open) return;
    if (next.reason !== page.reason || next.mode !== page.mode || next.version !== page.version || next.total !== page.total
      || next.cases.length === 0 || next.cases.length > 50 || page.cases.length + next.cases.length > page.total
      || next.nextOffset !== null && next.nextOffset !== page.cases.length + next.cases.length
      || next.nextOffset === null && page.cases.length + next.cases.length !== page.total
      || next.cases.some(row => page.cases.some(saved => saved.id === row.id))) throw new IssueReadError(409);
    current = {...next, cases: [...page.cases, ...next.cases]};
    element('issues-sheet-body')!.innerHTML = issuesCasesHtml(current); message('');
    const more = dialog.querySelector<HTMLButtonElement>('[data-issues-more]');
    (more ?? dialog.querySelector<HTMLButtonElement>('[data-issues-close]'))?.focus({preventScroll: true});
  } catch (error) {
    if (request !== generation || current !== page || !dialog.open) return;
    if (error instanceof IssueReadError && error.status === 409) {button.hidden = true; message('△ These cases changed. Close and open the reason again.');}
    else {button.disabled = false; button.textContent = 'Retry loading cases'; message('△ More cases could not be read. The loaded cases are still shown.');}
  } finally {if (request === generation) busy = false;}
}
export function installIssues(): void {
  const root = document.querySelector('[data-issues-root]'), dialog = element<HTMLDialogElement>('issues-sheet');
  if (installed || !root || !dialog) return;
  installed = true;
  root.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-issue-reason]') : null;
    if (target?.dataset.issueReason) void show(target.dataset.issueReason, target);
  });
  dialog.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    if (target === dialog || target?.closest('[data-issues-close]')) {dialog.close(); return;}
    const button = target?.closest<HTMLButtonElement>('[data-issues-more]'); if (button) void more(button);
  });
  dialog.addEventListener('close', () => {if (dialog.open) return; generation++; current = undefined; busy = false;
    if (opener?.isConnected) opener.focus(); opener = null;});
}
