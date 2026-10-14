import type { CreativeView, CreativeSheet, CreativeSelection } from './presentation-types.js';
import { creativePanelHtml, creativeGalleryHtml, creativeCardsHtml, creativeSheetHtml, creativeAttributesHtml, creativeTagRowHtml, creativeAttributeFiltersHtml } from './view.js';
import type { ResolvedAttribute } from './attributes.js';
import { creativeScanControlHtml, type CreativeScanView } from './scan-view.js';
import type { ScanResult } from './scan.js';

let view: CreativeView | undefined;
let selection: CreativeSelection = { window: '3d', market: 'all', owner: 'all' };
let generation = 0;
let sheetGeneration = 0;
let lastMerge: string | undefined;
let activeSheet: CreativeSheet | undefined;
let noteTimer: ReturnType<typeof setTimeout> | undefined;
let noteGeneration = 0;
let pendingNote: { sheet: CreativeSheet; value: string; generation: number } | undefined;
let noteWrites = Promise.resolve();
const savingTags = new Set<string>();
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
  const attributes = element('#creative-attribute-filters'); if (attributes) attributes.innerHTML = creativeAttributeFiltersHtml(next);
  const undo = element<HTMLButtonElement>('#creative-merge-undo'); if (undo) undo.hidden = !lastMerge;
  const form = element<HTMLFormElement>('#creative-filters');
  if (form) for (const key of ['kind', 'owner', 'market', 'live'] as const) {
    const input = form.elements.namedItem(key) as HTMLSelectElement | null;
    if (input) input.value = String(selection[key] ?? 'all');
  }
}
export function updateCreativeSnapshot(next: CreativeView): void {
  if (!view) selection = { ...next.selection };
  if ((selection.window ?? '3d') === (next.selection.window ?? '3d') && (selection.market ?? 'all') === 'all' && (selection.owner ?? 'all') === 'all' && !selection.attribute && !selection.value && (selection.kind ?? 'all') === 'all' && (selection.live ?? 'all') === 'all') render(next);
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
async function openSheet(groupId: string, tagging = false): Promise<void> {
  const dialog = element<HTMLDialogElement>('#creative-sheet');
  const body = element('#creative-sheet-body');
  if (!dialog || !body) return;
  const current = ++sheetGeneration;
  flushNote();
  activeSheet = undefined;
  noteGeneration++;
  body.innerHTML = '<h2 id="creative-sheet-title">Opening creative…</h2>';
  if (!dialog.open) dialog.showModal();
  try {
    const sheet = await read<CreativeSheet>(`/api/creatives/${encodeURIComponent(groupId)}?window=${selection.window ?? '3d'}`);
    if (current !== sheetGeneration || !dialog.open) return;
    activeSheet = sheet;
    body.innerHTML = creativeSheetHtml(sheet);
    if (tagging) {
      element('#creative-tagging')?.scrollIntoView({ block: 'start' });
      body.querySelector<HTMLButtonElement>('[data-creative-tag-key]')?.focus({ preventScroll: true });
    }
    const video = body.querySelector('video');
    video?.addEventListener('error', () => {
      const fallback = element('#creative-video-refused'); if (fallback) fallback.hidden = false;
    });
    if (video?.error) { const fallback = element('#creative-video-refused'); if (fallback) fallback.hidden = false; }
  } catch { if (current === sheetGeneration) body.innerHTML = '<h2 id="creative-sheet-title">Creative unavailable</h2><p>Could not read this creative. Close and try again.</p>'; }
}
function brieflySaved(target: HTMLElement | null, text = 'Saved'): void {
  if (!target) return;
  target.textContent = text;
  setTimeout(() => { if (target.isConnected && target.textContent === text) target.textContent = ''; }, 1800);
}
async function saveTag(key: string, value: string): Promise<void> {
  const sheet = activeSheet, generation = sheetGeneration;
  if (!sheet) return;
  const savingKey = `${sheet.group.group.id}:${key}`;
  if (savingTags.has(savingKey)) return;
  savingTags.add(savingKey);
  const row = element(`[data-tag-row="${CSS.escape(key)}"]`);
  row?.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = true; });
  try {
    const result = await read<{ attribute: ResolvedAttribute }>(`/api/creatives/${encodeURIComponent(sheet.group.group.id)}/attributes`, { key, value });
    if (generation !== sheetGeneration || activeSheet !== sheet) return;
    sheet.attributes = sheet.attributes.map(attribute => attribute.key === key ? result.attribute : attribute);
    const summary = element('.creative-attribute-section'); if (summary) summary.outerHTML = creativeAttributesHtml(sheet.attributes);
    if (row) row.outerHTML = creativeTagRowHtml(result.attribute);
    const updated = element(`[data-tag-row="${CSS.escape(key)}"]`);
    updated?.querySelector<HTMLButtonElement>(`[data-creative-tag-value="${CSS.escape(value)}"]`)?.focus({ preventScroll: true });
    brieflySaved(updated?.querySelector<HTMLElement>('.creative-tag-saved') ?? null);
    void refresh();
  } catch {
    if (generation === sheetGeneration) {
      const status = row?.querySelector<HTMLElement>('.creative-tag-saved');
      if (status) status.textContent = 'Could not save. Try again.';
    }
  } finally {
    savingTags.delete(savingKey);
    row?.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = false; });
  }
}
async function saveNote(sheet: CreativeSheet, value: string, generation: number): Promise<void> {
  try {
    const result = await read<{ note: string }>(`/api/creatives/${encodeURIComponent(sheet.group.group.id)}/attributes`, { key: 'note', value });
    if (activeSheet !== sheet || generation !== noteGeneration) return;
    sheet.note = result.note;
    brieflySaved(element('#creative-note-saved'));
    void refresh();
  } catch {
    if (activeSheet === sheet && generation === noteGeneration) {
      const status = element('#creative-note-saved'); if (status) status.textContent = 'Could not save. Try again.';
    }
  }
}
function flushNote(): void {
  if (noteTimer) clearTimeout(noteTimer);
  if (!pendingNote) return;
  const pending = pendingNote;
  pendingNote = undefined;
  noteWrites = noteWrites.then(() => saveNote(pending.sheet, pending.value, pending.generation));
}
async function scanNow(button: HTMLButtonElement): Promise<void> {
  const sheet = activeSheet, generation = sheetGeneration;
  if (!sheet || button.disabled) return;
  button.disabled = true; button.textContent = 'Scanning…';
  try {
    const result = await read<{ attributes: ResolvedAttribute[]; scan: CreativeScanView; result: ScanResult }>(`/api/creatives/${encodeURIComponent(sheet.group.group.id)}/scan`, {});
    if (generation !== sheetGeneration || activeSheet !== sheet) return;
    sheet.scan = result.scan; sheet.attributes = result.attributes;
    const summary = element('.creative-attribute-section'); if (summary) summary.outerHTML = creativeAttributesHtml(sheet.attributes);
    for (const attribute of sheet.attributes) {
      const row = element(`[data-tag-row="${CSS.escape(attribute.key)}"]`); if (row) row.outerHTML = creativeTagRowHtml(attribute);
    }
    const control = element('#creative-scan-control'); if (control) control.outerHTML = creativeScanControlHtml(sheet.scan);
    const status = element('#creative-scan-result');
    if (status) status.textContent = result.result.message ?? ({ done: 'Scan complete. Attributes updated.', failed: 'Scan failed. See Source health for the reason.',
      off: 'Creative scanning is off.', busy: 'A scan is already running. Try again shortly.', cooldown: 'This creative is waiting until its next retry.',
      idle: 'No creative is ready to scan.', cap: 'Daily scan cap reached; try again next UK day', prices: 'Set the scan prices in Settings' }[result.result.state]);
    void refresh();
  } catch {
    if (generation === sheetGeneration) {
      const status = element('#creative-scan-result'); if (status) status.textContent = 'Could not scan. Try again or check Source health.';
      button.disabled = false; button.textContent = 'Scan now';
    }
  }
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
  const scan = target.closest<HTMLButtonElement>('[data-creative-scan]');
  if (scan) { void scanNow(scan); return; }
  const tag = target.closest<HTMLElement>('[data-creative-tag]');
  if (tag?.dataset.creativeTag) { void openSheet(tag.dataset.creativeTag, true); return; }
  const pill = target.closest<HTMLButtonElement>('[data-creative-tag-key]');
  if (pill?.dataset.creativeTagKey && pill.dataset.creativeTagValue) { void saveTag(pill.dataset.creativeTagKey, pill.dataset.creativeTagValue); return; }
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
    if (event.target.name === 'kind') { delete selection.attribute; delete selection.value; }
    else {
      const attribute = String(data.get('attribute') ?? '');
      if (attribute) selection.attribute = attribute; else delete selection.attribute;
      const value = event.target.name === 'attribute' ? '' : String(data.get('value') ?? '');
      if (attribute && value) selection.value = value; else delete selection.value;
    }
    void refresh();
  }
});
document.addEventListener('input', event => {
  if (!(event.target instanceof HTMLTextAreaElement) || event.target.id !== 'creative-tag-note' || !activeSheet) return;
  const sheet = activeSheet, value = event.target.value, generation = ++noteGeneration;
  const count = element('#creative-note-count'); if (count) count.textContent = String([...value].length);
  const status = element('#creative-note-saved'); if (status) status.textContent = 'Saving…';
  if (noteTimer) clearTimeout(noteTimer);
  pendingNote = { sheet, value, generation };
  noteTimer = setTimeout(flushNote, 400);
});
const dialog = element<HTMLDialogElement>('#creative-sheet');
dialog?.addEventListener('close', () => { flushNote(); sheetGeneration++; activeSheet = undefined; noteGeneration++; dialog.querySelector('video')?.pause(); element('#creative-sheet-body')?.replaceChildren(); });
dialog?.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
const state = element('#creative-state');
if (state) {
  try { const next = JSON.parse(state.dataset.view ?? '{}') as CreativeView; selection = next.selection; render(next); state.remove(); }
  catch { status('Could not finish loading creatives. Refresh to try again.'); }
}
