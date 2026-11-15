import { ukToday } from '../hero-range.js';
import type { WaitingView } from './model.js';
import { waitingRowsHtml } from './view.js';

let installed = false, busy = false;
class SaveRefused extends Error {}
const formElement = (): HTMLFormElement | null => document.querySelector('#waiting-add-form');
type Draft = {contact: string; subject: string; since: string};
function draft(form: HTMLFormElement): Draft {
  const data = new FormData(form);
  return {contact: String(data.get('contact') ?? ''), subject: String(data.get('subject') ?? ''), since: String(data.get('since') ?? '')};
}
function matches(left: Draft, right: Draft): boolean {
  return left.contact === right.contact && left.subject === right.subject && left.since === right.since;
}

export function waitingCanRefresh(): true | string {
  if (busy) return 'Wait for this save to finish.';
  const form = formElement();
  if (!form) return true;
  const value = draft(form), since = form.elements.namedItem('since') as HTMLInputElement;
  return value.contact.trim() || value.subject.trim() || value.since !== since.defaultValue ? 'Save or clear the waiting item first.' : true;
}

function setBusy(value: boolean): void {
  busy = value;
  document.querySelectorAll<HTMLButtonElement>('[data-waiting-action],#waiting-add-form button[type="submit"]').forEach(button => {button.disabled = value;});
}

function message(text: string, error = false, undoId?: string): void {
  const status = document.querySelector<HTMLElement>('#waiting-message');
  if (!status) return;
  status.replaceChildren(document.createTextNode(text ? `${error ? '△' : text === 'Saving…' ? 'ⓘ' : '✓'} ${text}` : ''));
  status.toggleAttribute('data-error', error);
  if (undoId) {
    const undo = document.createElement('button');
    undo.className = 'btn'; undo.type = 'button'; undo.dataset.waitingAction = 'restore'; undo.dataset.waitingId = undoId;
    undo.textContent = '↶ Put back'; status.append(undo);
  }
}

function render(view: WaitingView): void {
  const root = document.querySelector<HTMLElement>('[data-waiting-rows]');
  if (!root) return;
  const expanded = ['data-waiting-more', 'data-waiting-done'].filter(attribute => root.querySelector(`details[${attribute}][open]`));
  root.innerHTML = waitingRowsHtml(view);
  for (const attribute of expanded) root.querySelector<HTMLDetailsElement>(`details[${attribute}]`)?.setAttribute('open', '');
  const date = formElement()?.elements.namedItem('since') as HTMLInputElement | null;
  if (date) date.max = ukToday(new Date(view.asOf));
}

async function save(action: 'add' | 'done' | 'restore', body: Draft | {id: string}): Promise<void> {
  if (busy) return;
  setBusy(true); message('Saving…');
  try {
    const response = await fetch(`/api/waiting-on/${action}`, {method: 'POST', credentials: 'same-origin',
      headers: {'Content-Type': 'application/json', Accept: 'application/json'}, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000)});
    if (response.status === 401) {location.assign('/login'); return;}
    if (!response.ok) {
      const result = await response.json().catch(() => null) as {error?: unknown} | null;
      throw new SaveRefused(typeof result?.error === 'string' ? result.error : 'Could not save this item. Check it and try again.');
    }
    const result = await response.json() as {saved: true; view: WaitingView | null; message?: string};
    if (result.view) render(result.view);
    if (action === 'add') {
      const form = formElement();
      // Typing during a slow save starts another draft and must not be discarded.
      if (form && matches(draft(form), body as Draft)) {
        form.reset();
        const since = form.elements.namedItem('since') as HTMLInputElement;
        since.defaultValue = since.value = result.view ? ukToday(new Date(result.view.asOf)) : since.max;
      }
      message(result.view ? 'Saved here.' : result.message ?? 'Saved. Refresh to see the waiting items.');
    } else if (action === 'done') message(result.view ? 'Done here.' : result.message ?? 'Saved. Refresh to see the waiting items.', false, (body as {id: string}).id);
    else message(result.view ? 'Put back.' : result.message ?? 'Saved. Refresh to see the waiting items.');
  } catch (error) {
    message(error instanceof SaveRefused ? `Not saved · ${error.message}` : 'Save unconfirmed · Refresh to check, then try again.', true);
  } finally {setBusy(false);}
}

export function installWaitingOn(): void {
  const root = document.querySelector<HTMLElement>('[data-waiting-root]'), form = formElement();
  if (installed || !root || !form) return;
  installed = true;
  root.addEventListener('click', event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-waiting-action]');
    const action = button?.dataset.waitingAction, id = button?.dataset.waitingId;
    if (id && (action === 'done' || action === 'restore')) void save(action, {id});
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const value = draft(form);
    if ([...value.contact.trim()].length > 80 || [...value.subject.trim()].length > 240) {
      message('Use up to 80 characters for the contact and 240 for the subject.', true); return;
    }
    void save('add', value);
  });
  form.addEventListener('reset', () => {if (!busy) message('');});
}
