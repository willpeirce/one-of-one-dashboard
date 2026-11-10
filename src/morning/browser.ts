import { escapeCreative as e } from '../creatives/html.js';
import { addDays } from '../hero-range.js';
import { updateMorningPushNudge } from '../push/browser.js';
import type { TickerSnapshot } from '../ticker/model.js';
import type { MorningAction, MorningButton, MorningCard, MorningLiveButton, MorningSnapshot, MorningState } from './model-types.js';
import { morningBriefHtml, morningDay, morningDeckHtml, morningFineHtml, morningLinesHtml, morningMenuHtml, morningProgressHtml, morningWhyHtml, type MorningWindow } from './view.js';

type PressUndo = {kind: 'morning'; cardKey: string; action: MorningAction | 'undo'; answer?: 'a' | 'b' | 'draw'};
type Undo = PressUndo | {kind: 'ticker'; eventKey: string; action: 'next' | 'restore'} | {kind: 'live'; button: MorningLiveButton};
type Command = {cardKey: string; button: MorningButton};
type SheetKind = 'why' | 'menu' | 'copy' | 'fine' | 'brief' | 'confirm';
const root = document.querySelector<HTMLElement>('#mn-root');
if (root) setup(root);

function setup(root: HTMLElement): void {
  const get = <T extends HTMLElement>(selector: string): T => root.querySelector<T>(selector)!;
  const stage = get<HTMLElement>('#mn-stage'), dialog = get<HTMLDialogElement>('#mn-dialog');
  const close = get<HTMLButtonElement>('#mn-close'), sheetBody = get<HTMLElement>('#mn-sheet-body'), sheetStatus = get<HTMLElement>('#mn-sheet-status');
  const toast = get<HTMLElement>('#mn-toast'), undoButton = get<HTMLButtonElement>('#mn-undo');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let snapshot: MorningSnapshot, busy = false, revision = 0, animation = false;
  let undo: Undo | null = null, toastTimer: ReturnType<typeof setTimeout> | undefined;
  let confirmation: Command | null = null, sheet: SheetKind | null = null, sheetCard: MorningCard | null = null;
  let opener: HTMLElement | null = null, expanded = false;
  const windows = new Map<string, MorningWindow>();
  const initial = get<HTMLTemplateElement>('#mn-initial');
  try { snapshot = JSON.parse(initial.content.textContent ?? '') as MorningSnapshot; initial.remove(); root.dataset.mnReady = 'true'; }
  catch { get<HTMLElement>('#mn-read-status').textContent = 'ⓘ Could not read Morning. Refresh to try again.'; return; }
  const current = (): MorningCard | undefined => snapshot.cards[0];
  const selectedWindow = (): MorningWindow => current() ? windows.get(current()!.key) ?? '3' : '3';
  function focusCard(): void { (root.querySelector<HTMLElement>('#mn-primary') ?? root.querySelector<HTMLElement>('#mn-all-clear h2'))?.focus({preventScroll: true}); }
  function setBusy(value: boolean): void {
    busy = value;
    for (const control of Array.from(root.querySelectorAll<HTMLButtonElement>('#mn-stage button,#mn-dialog button,#mn-undo'))) control.disabled = value;
    stage.setAttribute('aria-busy', String(value));
  }
  function render(error?: string): void {
    stage.innerHTML = morningDeckHtml(snapshot, {window: selectedWindow(), ...(confirmation ? {confirm: confirmation.button.kind === 'live' || confirmation.button.kind === 'save' && confirmation.button.target === 'morning' ? confirmation.button.confirm : undefined} : {}), error});
    get<HTMLElement>('#mn-progress').innerHTML = morningProgressHtml(snapshot);
    get<HTMLElement>('#mn-day').textContent = `${morningDay(snapshot.day)}${snapshot.mode === 'sample' ? ' · Sample data' : ''}`;
    get<HTMLElement>('#mn-lines').innerHTML = morningLinesHtml(snapshot);
    updateMorningPushNudge(snapshot.summaryEnabled === true);
    if (dialog.open && sheet === 'fine') sheetBody.innerHTML = morningFineHtml(snapshot, expanded);
    setBusy(busy);
    root.dataset.mnReady = 'true';
  }
  async function request<T>(path: string, body?: object, bounded = true): Promise<T> {
    const response = await fetch(path, {credentials: 'same-origin', cache: 'no-store', ...(bounded ? {signal: AbortSignal.timeout(10_000)} : {}),
      headers: {accept: 'application/json', ...(body ? {'content-type': 'application/json'} : {})}, ...(body ? {method: 'POST', body: JSON.stringify(body)} : {})});
    if (!response.ok) {
      const result = await response.json().catch(() => ({})) as {error?: unknown};
      throw new Error(typeof result.error === 'string' ? result.error.slice(0, 240) : 'Could not save. Try again.');
    }
    return await response.json() as T;
  }
  async function read(): Promise<void> {
    if (busy || confirmation) return;
    const token = ++revision;
    try {
      const next = await request<MorningSnapshot>('/api/morning');
      if (token !== revision || busy || confirmation) return;
      snapshot = next; confirmation = null; render(); get<HTMLElement>('#mn-read-status').textContent = '';
    } catch { if (token === revision && !busy) get<HTMLElement>('#mn-read-status').textContent = 'ⓘ Could not refresh Morning. Showing the last read.'; }
  }
  function hideToast(): void {
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = undefined; undo = null; toast.hidden = true;
  }
  function saved(message: string, reverse: Undo | null): void {
    hideToast(); undo = reverse; toast.hidden = false; undoButton.hidden = !reverse;
    undoButton.textContent = reverse?.kind === 'morning' && reverse.action === 'hold' ? 'Hold again' : 'Undo';
    get<HTMLElement>('#mn-toast-message').textContent = `✓ ${message}`;
    const drain = get<HTMLElement>('.mn-toast-drain'); drain.replaceWith(drain.cloneNode());
    toastTimer = setTimeout(hideToast, 8_000);
    if (dialog.open) sheetStatus.textContent = message;
  }
  async function update(next: MorningSnapshot, stamp: string): Promise<void> {
    get<HTMLElement>('#mn-feedback').textContent = stamp;
    if (!reduced.matches && current()) {
      const mark = get<HTMLElement>('#mn-stamp'); mark.textContent = stamp; mark.classList.add('mn-stamping');
      animation = !animation;
      stage.querySelector<HTMLElement>('.mn-card')?.classList.add(animation ? 'mn-leave-a' : 'mn-leave-b');
      await new Promise<void>(resolve => setTimeout(resolve, 220));
    }
    snapshot = next; confirmation = null; render();
    if (!reduced.matches) stage.querySelector<HTMLElement>('.mn-card')?.classList.add(animation ? 'mn-enter-a' : 'mn-enter-b');
  }
  function tickerState(next: TickerSnapshot): void {
    document.querySelector('#tk-strip')?.dispatchEvent(new CustomEvent('pulse:ticker-state', {detail: next}));
  }
  async function afterSourceSave(): Promise<MorningSnapshot | null> {
    try { return await request<MorningSnapshot>('/api/morning'); }
    catch { get<HTMLElement>('#mn-read-status').textContent = 'ⓘ Saved. The deck could not refresh; reload to see it.'; return null; }
  }
  function pressMessage(action: MorningAction, next: MorningSnapshot, key: string): {message: string; stamp: string} {
    if (action === 'hold') {
      const row = next.answers.find(row => row.cardKey === key);
      return {message: `Held here until ${row?.untilDay ? morningDay(row.untilDay) : 'the saved day'}. Nothing changed in Meta.`, stamp: 'Held'};
    }
    return {message: 'Saved', stamp: action === 'park' || action === 'remind' ? 'Parked' : action === 'hide' ? 'Hidden' : action === 'call' ? 'Called' : 'Seen'};
  }
  async function perform(command: Command): Promise<void> {
    if (busy) return;
    if (dialog.open && sheet === 'confirm') dialog.close();
    ++revision; setBusy(true);
    const button = command.button;
    if (button.kind === 'live' && button.action === 'undo') hideToast();
    try {
      let next: MorningSnapshot | null = null, reverse: Undo | null = null, message = 'Saved', stamp = 'Saved';
      if (button.kind === 'save' && button.target === 'morning') {
        next = await request<MorningSnapshot>('/api/morning/press', {cardKey: command.cardKey, action: button.action, ...(button.answer ? {answer: button.answer} : {})});
        reverse = {kind: 'morning', cardKey: command.cardKey, action: 'undo'};
        ({message, stamp} = pressMessage(button.action, next, command.cardKey));
      } else if (button.kind === 'save' && button.target === 'ticker') {
        tickerState(await request<TickerSnapshot>(`/api/ticker/${button.action}`, {eventKey: button.eventKey}));
        reverse = {kind: 'ticker', eventKey: button.eventKey, action: button.action === 'next' ? 'restore' : 'next'};
        next = await afterSourceSave(); stamp = button.action === 'next' ? 'Covered' : 'Put back';
      } else if (button.kind === 'live') {
        const result = await request<{id: string; refreshed: boolean}>(`/api/meta/adset/${encodeURIComponent(button.adSetId)}`, {action: button.action, ...(button.value !== undefined ? {value: button.value} : {})}, false);
        if (button.action !== 'undo') reverse = {kind: 'live', button: {kind: 'live', label: 'Undo', adSetId: button.adSetId, action: 'undo', value: result.id, confirm: 'Undo this saved Meta action?'}};
        next = await afterSourceSave(); stamp = button.action === 'pause' ? 'Paused' : button.action === 'undo' ? 'Undone' : 'Stepped';
      }
      if (next) await update(next, stamp);
      else { confirmation = null; render(); }
      saved(message, reverse);
    } catch (error) {
      // A failed response can follow a committed source write. Reconcile before offering another action.
      if (button.kind === 'live') {
        try { snapshot = await request<MorningSnapshot>('/api/morning'); }
        catch { get<HTMLElement>('#mn-read-status').textContent = 'ⓘ Could not refresh Morning. Check the saved actions before trying again.'; }
      }
      const message = error instanceof Error ? error.message : 'Could not save. Try again.';
      confirmation = null; render(message);
      if (!current()) get<HTMLElement>('#mn-read-status').textContent = `✕ ${message}`;
      if (dialog.open) sheetStatus.textContent = 'Could not save. Try again.';
    } finally { setBusy(false); if (dialog.open) close.focus({preventScroll: true}); else focusCard(); }
  }
  function priorAction(row: MorningState, next: MorningSnapshot): PressUndo | null {
    const card = next.cards.find(card => card.key === row.cardKey);
    if (!card) return null;
    const action: MorningAction = row.state === 'hidden' ? 'hide' : row.state === 'seen' ? 'ack' : row.answer === 'hold' ? 'hold' : row.answer ? 'call'
      : card.allowedPresses.includes('remind') && row.untilDay !== null && row.untilDay > addDays(snapshot.day, 1) ? 'remind' : 'park';
    return card.allowedPresses.includes(action) ? {kind: 'morning', cardKey: row.cardKey, action, ...(row.answer && row.answer !== 'hold' ? {answer: row.answer} : {})} : null;
  }
  async function restore(command: Undo): Promise<void> {
    if (busy) return;
    if (command.kind === 'live') { choose({cardKey: '', button: command.button}); return; }
    ++revision; setBusy(true);
    try {
      let next: MorningSnapshot | null, reverse: Undo | null = null;
      if (command.kind === 'ticker') {
        tickerState(await request<TickerSnapshot>(`/api/ticker/${command.action}`, {eventKey: command.eventKey}));
        next = await afterSourceSave(); reverse = {...command, action: command.action === 'next' ? 'restore' : 'next'};
      } else {
        const old = [...snapshot.presses, ...snapshot.parked.map(row => row.stateRow), ...snapshot.hidden.map(row => row.stateRow), ...snapshot.answers].find(row => row.cardKey === command.cardKey);
        next = await request<MorningSnapshot>('/api/morning/press', {cardKey: command.cardKey, action: command.action, ...(command.answer ? {answer: command.answer} : {})});
        if (command.action === 'undo' && old) reverse = priorAction(old, next);
        else if (command.action !== 'undo') reverse = {...command, action: 'undo', answer: undefined};
      }
      const feedback = command.kind === 'morning' && command.action !== 'undo' && next ? pressMessage(command.action, next, command.cardKey)
        : {message: reverse?.kind === 'morning' && reverse.action === 'hold' ? 'Put back. Hold again starts a new seven-day hold.' : 'Saved', stamp: command.kind === 'ticker' && command.action === 'next' ? 'Saved' : 'Put back'};
      if (next) await update(next, feedback.stamp);
      saved(feedback.message, reverse);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not put this back. Try again.';
      if (dialog.open) sheetStatus.textContent = message; else render(message);
    } finally { setBusy(false); if (dialog.open) close.focus({preventScroll: true}); else focusCard(); }
  }
  function openSheet(kind: SheetKind, source: HTMLElement, card = current()): void {
    if (busy) return;
    sheet = kind; sheetCard = card ?? null; opener = source; sheetStatus.textContent = '';
    const title = get<HTMLElement>('#mn-sheet-title');
    if (kind === 'why' && card) { title.textContent = 'Why this is here'; sheetBody.innerHTML = morningWhyHtml(card, windows.get(card.key) ?? '3'); }
    if (kind === 'menu' && card) { title.textContent = 'More actions'; sheetBody.innerHTML = morningMenuHtml(card); }
    if (kind === 'fine') { title.textContent = 'The rest of this morning'; expanded = false; sheetBody.innerHTML = morningFineHtml(snapshot); }
    if (kind === 'brief' && snapshot.brief) {
      const brief = snapshot.brief; title.textContent = 'Morning check';
      sheetBody.innerHTML = morningBriefHtml(brief);
    }
    if (!dialog.open) dialog.showModal(); close.focus({preventScroll: true});
  }
  function choose(command: Command, source?: HTMLElement): void {
    if (busy) return;
    const button = command.button;
    if (button.kind === 'copy') {
      const card = snapshot.cards.find(card => card.key === command.cardKey) ?? sheetCard;
      const text = card?.figure.kind === 'brief' ? card.figure.variants[windows.get(card.key) ?? '3'].text : button.text;
      openSheet('copy', source ?? get<HTMLElement>('#mn-primary'), card ?? undefined);
      get<HTMLElement>('#mn-sheet-title').textContent = 'Copy a note';
      sheetBody.innerHTML = `<label for="mn-copy-text">Your text to send</label><textarea id="mn-copy-text" readonly>${e(text)}</textarea><button type="button" id="mn-copy">Copy</button>`;
    } else if (button.kind === 'live' || button.kind === 'save' && button.target === 'morning' && button.confirm) {
      if (!command.cardKey) {
        // A previous action's Undo must not inherit a different card's inline question.
        confirmation = null; render();
        confirmation = command; sheet = 'confirm'; sheetCard = null; opener = source ?? get<HTMLElement>('#mn-good');
        get<HTMLElement>('#mn-sheet-title').textContent = 'Confirm Meta action'; sheetStatus.textContent = '';
        sheetBody.innerHTML = `<p>${e(button.confirm)}</p><div class="mn-confirm-actions"><button type="button" id="mn-confirm" class="mn-primary">Confirm</button><button type="button" id="mn-cancel" class="mn-secondary">Cancel</button></div>`;
        if (!dialog.open) dialog.showModal(); get<HTMLButtonElement>('#mn-confirm').focus({preventScroll: true}); return;
      }
      if (dialog.open) dialog.close();
      confirmation = command; render(); get<HTMLButtonElement>('#mn-confirm').focus({preventScroll: true});
    } else if (button.kind === 'save') { if (dialog.open) dialog.close(); void perform(command); }
  }
  root.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest('#mn-close')) { dialog.close(); return; }
    if (busy) { if (target.closest('#mn-stage a,#mn-stage button,#mn-dialog button,#mn-undo')) event.preventDefault(); return; }
    if (target.closest('#mn-undo') && undo) { const command = undo; if (command.kind !== 'live') hideToast(); void restore(command); return; }
    if (target.closest('#mn-confirm') && confirmation) { void perform(confirmation); return; }
    if (target.closest('#mn-cancel')) { confirmation = null; if (dialog.open) dialog.close(); render(); focusCard(); return; }
    const windowButton = target.closest<HTMLButtonElement>('[data-mn-window]');
    if (windowButton && current()) { windows.set(current()!.key, windowButton.dataset.mnWindow as MorningWindow); render(); root.querySelector<HTMLButtonElement>(`[data-mn-window="${windowButton.dataset.mnWindow}"]`)?.focus({preventScroll: true}); return; }
    for (const [selector, kind] of [['#mn-figure', 'why'], ['#mn-menu', 'menu'], ['#mn-good', 'fine'], ['#mn-brief', 'brief']] as const) {
      const source = target.closest<HTMLElement>(selector); if (source) { openSheet(kind, source); return; }
    }
    if (target.closest('#mn-away-more')) { expanded = !expanded; sheetBody.innerHTML = morningFineHtml(snapshot, expanded); get<HTMLElement>('#mn-away-more').focus({preventScroll: true}); return; }
    const putBack = target.closest<HTMLElement>('[data-mn-put-back]');
    if (putBack) { void restore({kind: 'morning', cardKey: putBack.dataset.mnPutBack!, action: 'undo'}); return; }
    const date = target.closest<HTMLElement>('[data-mn-ticker-restore]');
    if (date) { void restore({kind: 'ticker', eventKey: date.dataset.mnTickerRestore!, action: 'restore'}); return; }
    const liveUndo = target.closest<HTMLElement>('[data-mn-live-undo]');
    if (liveUndo) { const action = snapshot.metaActions.find(row => row.id === liveUndo.dataset.mnLiveUndo)?.undo; if (action) choose({cardKey: '', button: action}, liveUndo); return; }
    const control = target.closest<HTMLElement>('[data-mn-button]');
    if (control) {
      const card = dialog.open && sheet === 'menu' ? sheetCard : current(); if (!card) return;
      const position = control.dataset.mnButton!, button = position === 'primary' ? card.primary : position === 'secondary' ? card.secondary : card.menu[Number(position.slice(5))];
      if (button) choose({cardKey: card.key, button}, control);
    }
    if (target.closest('#mn-copy')) {
      const text = get<HTMLTextAreaElement>('#mn-copy-text');
      const fallback = (): void => { text.focus(); text.select(); sheetStatus.textContent = 'Copy was unavailable. Text selected — copy it, then send it yourself.'; };
      try { void (navigator.clipboard?.writeText(text.value) ?? Promise.reject()).then(() => { dialog.close(); saved('Copied. You send it.', null); }).catch(fallback); }
      catch { fallback(); }
    }
  });
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    if (sheet === 'confirm') { confirmation = null; render(); }
    sheet = null; sheetCard = null; sheetBody.replaceChildren(); sheetStatus.textContent = '';
    // A read or local press can replace the footer controls while their sheet is open.
    const returnTo = opener?.isConnected ? opener : opener && ['mn-brief', 'mn-good'].includes(opener.id) ? root.querySelector<HTMLElement>(`#${opener.id}`) : null;
    if (returnTo) returnTo.focus({preventScroll: true}); else focusCard();
  });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
  });
  const density = (): void => { const height = stage.getBoundingClientRect().height; stage.dataset.mnDensity = height < 455 ? 'tight' : height < 560 ? 'compact' : 'roomy'; };
  new ResizeObserver(density).observe(stage); density();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void read(); });
  document.querySelector('#tk-strip')?.addEventListener('pulse:ticker-saved', () => { void read(); });
  updateMorningPushNudge(snapshot.summaryEnabled === true);
  void read();
}
