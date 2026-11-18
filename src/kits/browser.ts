import type {HomeKits, KitSheet} from './presentation-types.js';
import {homeKitsHtml, kitSheetHtml} from './view.js';

let current: HomeKits | undefined, installed = false, beforeOpen: (() => void) | undefined, generation = 0;
let opener: HTMLElement | null = null;
const element = <T extends HTMLElement = HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;
const listed = (id: string): boolean => !!current?.ready && [...current.cards, ...current.folded].some(row => row.id === id);

/** A different use of the shared sheet owns any later response or refresh. */
export function releaseKitSheet(): void {
  const dialog = element('sheet');
  if (dialog) delete dialog.dataset.kitSheet;
  generation++; opener = null;
}

function fold(target: HTMLElement): void {
  const list = element('kits-planned');
  if (!list || !current) return;
  const expanded = target.getAttribute('aria-expanded') !== 'true';
  target.setAttribute('aria-expanded', String(expanded)); list.hidden = !expanded;
  target.textContent = expanded ? 'Hide planned' : `+${current.folded.length} planned · show`;
}
function orders(target: HTMLElement): void {
  const rest = element('kit-orders-rest'), count = document.querySelector('[data-kit-order-count]');
  if (!rest || !count) return;
  const expanded = target.getAttribute('aria-expanded') !== 'true', total = Number(target.dataset.total);
  target.setAttribute('aria-expanded', String(expanded)); rest.hidden = !expanded;
  target.textContent = expanded ? 'Show fewer' : `+${total - 3} more`;
  count.textContent = `On order · ${expanded ? total : 3} of ${total}`;
}
async function show(id: string, source: HTMLElement): Promise<void> {
  if (!listed(id)) return;
  const dialog = element<HTMLDialogElement>('sheet'), title = element('sh-title'), body = element('sh-extra'), dot = element('sh-dot');
  if (!dialog || !title || !body || !dot) return;
  beforeOpen?.(); const request = ++generation; opener = source;
  title.textContent = source.querySelector('.kit-name, .kit-folded-name strong')?.textContent ?? 'Kit';
  dot.className = 'dot info'; dot.textContent = '○';
  const detail = element('sh-dl'); if (detail) detail.hidden = true;
  element('sh-chart')?.replaceChildren();
  body.innerHTML = '<p class="kits-notice" role="status">Loading kit…</p>';
  dialog.dataset.kitSheet = id;
  if (!dialog.open) dialog.showModal();
  element('sh-x')?.focus();
  try {
    const response = await fetch(`/api/kits/${encodeURIComponent(id)}`, {credentials: 'same-origin', headers: {Accept: 'application/json'}});
    if (response.status === 401) { location.assign('/login'); return; }
    if (!response.ok) throw new Error(response.status === 404 ? 'This kit is no longer listed. Refresh to check the latest file.' : 'Could not load this kit. Close and try again.');
    const sheet = await response.json() as KitSheet;
    if (request !== generation || !dialog.open || dialog.dataset.kitSheet !== id || !listed(id) || sheet.mode !== current?.mode) return;
    title.textContent = sheet.name; body.innerHTML = kitSheetHtml(sheet);
  } catch (error) {
    if (request !== generation || !dialog.open || dialog.dataset.kitSheet !== id) return;
    const message = document.createElement('p'); message.className = 'kits-notice'; message.setAttribute('role', 'status');
    message.textContent = error instanceof Error ? error.message : 'Could not load this kit.';
    body.replaceChildren(message);
  }
}
export function updateHomeKits(view: HomeKits | undefined, onOpen?: () => void): void {
  const previousMode = current?.mode;
  current = view; beforeOpen = onOpen;
  const dialog = element<HTMLDialogElement>('sheet'), openId = dialog?.dataset.kitSheet;
  if (openId && (!listed(openId) || previousMode !== view?.mode)) {
    dialog?.close(); releaseKitSheet();
  }
  const root = element('kits');
  if (root) {
    const expanded = root.querySelector('[data-kits-fold]')?.getAttribute('aria-expanded') === 'true';
    root.innerHTML = homeKitsHtml(view);
    const toggle = root.querySelector<HTMLElement>('[data-kits-fold]'); if (expanded && toggle) fold(toggle);
  }
  if (installed) return;
  installed = true;
  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-kit-open],[data-kits-fold],[data-kit-orders-toggle]') : null;
    if (!target) return;
    if (target.hasAttribute('data-kits-fold')) { fold(target); return; }
    if (target.hasAttribute('data-kit-orders-toggle')) { orders(target); return; }
    const id = target.dataset.kitOpen;
    if (id) void show(id, target);
  });
  element<HTMLDialogElement>('sheet')?.addEventListener('close', () => {
    const dialog = element('sheet');
    const id = dialog?.dataset.kitSheet;
    if (!dialog || !id) return;
    delete dialog.dataset.kitSheet; generation++;
    if (opener?.isConnected) opener.focus();
    else document.querySelector<HTMLElement>(`[data-kit-open="${CSS.escape(id)}"]`)?.focus();
    opener = null;
  });
}
