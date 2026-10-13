import type { CreativeView, CreativeSheet, CreativeSelection } from './presentation-types.js';
import { creativePanelHtml, creativeGalleryHtml, creativeCardsHtml, creativeSheetHtml } from './view.js';

let view: CreativeView | undefined;
let selection: CreativeSelection = { window: '3d', market: 'all', owner: 'all' };
let generation = 0;
let sheetGeneration = 0;
let lastMerge: string | undefined;
const element = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector);
async function read<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  if (response.status === 401) { window.location.assign('/login'); throw new Error('Sign in to continue.'); }
  if (!response.ok) throw new Error('Could not update creatives. Try again.');
  return await response.json() as T;
}
function status(message: string): void {
  for (const selector of ['#creative-status', '#creative-feedback', '#creative-gallery-status']) {
    const target = element(selector); if (target) target.textContent = message;
  }
}
function render(next: CreativeView): void {
  view = next;
  element('#creative-panel')?.replaceChildren();
  const panel = element('#creative-panel'); if (panel) panel.innerHTML = creativePanelHtml(next);
  const gallery = element('#creative-gallery'); if (gallery) gallery.innerHTML = creativeGalleryHtml(next);
  const cards = element('#creative-cards'); if (cards) cards.innerHTML = creativeCardsHtml(next.cards);
  const undo = element<HTMLButtonElement>('#creative-merge-undo'); if (undo) undo.hidden = !lastMerge;
  const form = element<HTMLFormElement>('#creative-filters');
  if (form) for (const key of ['kind', 'owner', 'market', 'live'] as const) {
    const input = form.elements.namedItem(key) as HTMLSelectElement | null;
    if (input) input.value = String(selection[key] ?? 'all');
  }
}
export function updateCreativeSnapshot(next: CreativeView): void {
  if (!view) selection = { ...next.selection };
  if ((selection.window ?? '3d') === (next.selection.window ?? '3d') && (selection.market ?? 'all') === 'all' && (selection.owner ?? 'all') === 'all') render(next);
  else void refresh();
}
async function refresh(): Promise<void> {
  const current = ++generation;
  const params = new URLSearchParams(Object.entries(selection).map(([key, value]) => [key, String(value)]));
  try {
    const next = await read<CreativeView>(`/api/creatives?${params}`);
    if (current === generation) render(next);
  } catch { if (current === generation) status('Could not refresh creatives. Showing the last read.'); }
}
async function openSheet(groupId: string): Promise<void> {
  const dialog = element<HTMLDialogElement>('#creative-sheet');
  const body = element('#creative-sheet-body');
  if (!dialog || !body) return;
  const current = ++sheetGeneration;
  body.innerHTML = '<h2 id="creative-sheet-title">Opening creative…</h2>';
  if (!dialog.open) dialog.showModal();
  try {
    const sheet = await read<CreativeSheet>(`/api/creatives/${encodeURIComponent(groupId)}?window=${selection.window ?? '3d'}`);
    if (current !== sheetGeneration || !dialog.open) return;
    body.innerHTML = creativeSheetHtml(sheet);
    const video = body.querySelector('video');
    video?.addEventListener('error', () => {
      const fallback = element('#creative-video-refused'); if (fallback) fallback.hidden = false;
    });
    if (video?.error) { const fallback = element('#creative-video-refused'); if (fallback) fallback.hidden = false; }
  } catch { if (current === sheetGeneration) body.innerHTML = '<h2 id="creative-sheet-title">Creative unavailable</h2><p>Could not read this creative. Close and try again.</p>'; }
}
async function copyBrief(text: string, button: HTMLButtonElement): Promise<void> {
  try { await navigator.clipboard.writeText(text); button.textContent = 'Copied'; }
  catch { status('Copy was unavailable. Open the creative and try again.'); }
}
async function cardAction(cardId: string, action: 'done' | 'snooze' | 'undo'): Promise<void> {
  try {
    await read('/api/creatives/cards', { cardId, action });
    await refresh();
    const feedback = element('#creative-feedback');
    if (feedback && action !== 'undo') {
      feedback.replaceChildren(document.createTextNode(action === 'snooze' ? 'Snoozed for 7 days. ' : 'Done. '));
      const undo = document.createElement('button'); undo.className = 'btn'; undo.textContent = 'Undo';
      undo.addEventListener('click', () => { void cardAction(cardId, 'undo'); }); feedback.append(undo);
    }
  } catch { status('Could not save this card. Try again.'); }
}
async function mergeAction(action: 'merge' | 'split' | 'undo', groupIds: string[] = []): Promise<void> {
  try {
    const result = await read<{ mergeId: string }>('/api/creatives/merges', { action, groupIds, mergeId: lastMerge });
    lastMerge = action === 'undo' ? undefined : result.mergeId;
    await refresh(); status(action === 'undo' ? 'Last change undone.' : 'Saved locally. Meta is unchanged.');
  } catch { status('Could not change these groups. Choose two different videos and try again.'); }
}
document.addEventListener('click', event => {
  const target = event.target instanceof Element ? event.target : undefined;
  if (!target) return;
  const open = target.closest<HTMLElement>('[data-creative-open]');
  if (open?.dataset.creativeOpen) { void openSheet(open.dataset.creativeOpen); return; }
  if (target.closest('[data-creative-close]')) { element<HTMLDialogElement>('#creative-sheet')?.close(); return; }
  const window = target.closest<HTMLElement>('[data-creative-window]')?.dataset.creativeWindow;
  if (window === '24h' || window === '3d' || window === '7d') { selection.window = window; void refresh(); return; }
  const market = target.closest<HTMLElement>('#market [data-market]')?.dataset.market;
  if (market === 'all' || market === 'uk' || market === 'us') { selection.market = market; void refresh(); }
  const copy = target.closest<HTMLButtonElement>('[data-creative-copy]');
  if (copy?.dataset.creativeCopy) { void copyBrief(copy.dataset.creativeCopy, copy); return; }
  const card = target.closest<HTMLElement>('[data-creative-action]');
  if (card?.dataset.cardId && (card.dataset.creativeAction === 'done' || card.dataset.creativeAction === 'snooze')) { void cardAction(card.dataset.cardId, card.dataset.creativeAction); return; }
  const split = target.closest<HTMLElement>('[data-creative-split]');
  if (split?.dataset.creativeSplit) { void mergeAction('split', [split.dataset.creativeSplit]); return; }
  if (target.closest('#creative-merge-undo')) { void mergeAction('undo'); return; }
  if (target.closest('#creative-merge')) {
    const ids = Array.from(document.querySelectorAll<HTMLInputElement>('[name="merge-group"]:checked')).map(input => input.value);
    if (ids.length !== 2) { status('Choose exactly two videos to merge.'); return; }
    void mergeAction('merge', ids);
  }
});
document.addEventListener('change', event => {
  if (!(event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement)) return;
  if (event.target.id === 'creative-ours') { selection.owner = (event.target as HTMLInputElement).checked ? 'ours' : 'all'; void refresh(); }
  const form = event.target.closest<HTMLFormElement>('#creative-filters');
  if (form) {
    const data = new FormData(form);
    selection = { ...selection, kind: data.get('kind') as CreativeSelection['kind'], owner: data.get('owner') as CreativeSelection['owner'], market: data.get('market') as CreativeSelection['market'], live: data.get('live') === 'all' ? 'all' : data.get('live') === 'true' };
    void refresh();
  }
});
const dialog = element<HTMLDialogElement>('#creative-sheet');
dialog?.addEventListener('close', () => { sheetGeneration++; dialog.querySelector('video')?.pause(); element('#creative-sheet-body')?.replaceChildren(); });
dialog?.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
const state = element('#creative-state');
if (state) {
  try { const next = JSON.parse(state.dataset.view ?? '{}') as CreativeView; selection = next.selection; render(next); state.remove(); }
  catch { status('Could not finish loading creatives. Refresh to try again.'); }
}
