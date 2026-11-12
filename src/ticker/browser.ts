import type { TickerItem, TickerSnapshot } from './model.js';
import { tickerEscape as e, tickerChip, tickerIcon } from './view.js';

const strip = document.querySelector<HTMLElement>('#tk-strip');
if (strip) setupTicker(strip);

function setupTicker(root: HTMLElement): void {
  const get = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const band = get<HTMLButtonElement>('#tk-band'), content = get<HTMLSpanElement>('#tk-content');
  const next = get<HTMLButtonElement>('#tk-next'), undo = get<HTMLButtonElement>('#tk-undo');
  const saved = get<HTMLSpanElement>('#tk-saved'), savedLabel = get<HTMLSpanElement>('#tk-saved-label');
  const retry = get<HTMLButtonElement>('#tk-retry'), sheetRetry = get<HTMLButtonElement>('#tk-sheet-retry'), add = get<HTMLAnchorElement>('#tk-add-date');
  const dialog = get<HTMLDialogElement>('#tk-dialog'), close = get<HTMLButtonElement>('#tk-close');
  const more = get<HTMLButtonElement>('#tk-more'), status = get<HTMLParagraphElement>('#tk-status');
  const sheetStatus = get<HTMLParagraphElement>('#tk-sheet-status');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const phone = window.matchMedia('(max-width: 559px)');
  let snapshot: TickerSnapshot | null = null, readFailed = false, busy = false, expanded = false;
  let revision = 0, animation = 0, glintAnimation = 0, undoTimer: ReturnType<typeof setTimeout> | undefined;
  let opener: HTMLElement = band, undoStack: { key: string; name: string }[] = [], restoredNotice = false;
  type Press = { action: 'next' | 'restore'; key: string; name: string; source: 'next' | 'undo' | 'put-back' };
  let failedPress: Press | null = null;

  function accessibleLine(data: TickerSnapshot): string {
    return data.current ? `Next up: ${data.current.name}, ${data.current.dateLabel}, ${data.current.chip}.${data.then.length
      ? ` Then ${data.then.map(item => `${item.name}, ${item.dateLabel}`).join('; ')}.` : ''} Open all dates.`
      : 'Nothing ahead. Open all dates.';
  }
  function runHtml(data: TickerSnapshot): string {
    const item = data.current!;
    return `<span class="tk-run">${tickerIcon(item.kind)}<strong class="tk-name">${e(item.name)}</strong><span class="tk-date">${e(item.dateLabel)}</span>${tickerChip(item)}${data.then.length
      ? `<span class="tk-then-word">then</span>${data.then.map(row => `<span class="tk-then-item">${tickerIcon(row.kind)}${e(row.name)} <span class="tk-date">${e(row.dateLabel)}</span></span>`).join('<span class="tk-separator">·</span>')}` : ''}${data.mode === 'sample' ? '<span class="tk-sample">Sample dates</span>' : ''}</span>`;
  }
  function bandHtml(data: TickerSnapshot): string {
    if (!data.current) return `<span class="tk-empty">${tickerIcon('check')} Nothing ahead</span>`;
    const item = data.current;
    return `<span class="tk-track" aria-hidden="true">${runHtml(data)}${runHtml(data)}</span><span class="tk-static" aria-hidden="true">${tickerIcon(item.kind)}<span class="tk-static-copy"><strong class="tk-static-name" id="tk-current-name">${e(item.name)}</strong><span class="tk-static-detail${item.days < 0 ? ' tk-late-detail' : ''}">${e(item.dateLabel)} · ${item.days < 0 ? tickerIcon('warn') : ''}${e(item.chip)}</span></span></span>`;
  }
  function measure(): void {
    const run = get<HTMLElement>('.tk-run');
    if (run) root.style.setProperty('--tk-duration', `${Math.max(18, run.getBoundingClientRect().width / 40)}s`);
  }
  function renderActions(): void {
    const available = !!snapshot && !readFailed;
    next.hidden = !available || !snapshot?.current || !!failedPress;
    next.setAttribute('aria-disabled', String(busy));
    if (snapshot?.current) next.setAttribute('aria-label', `Next: mark ${snapshot.current.name} as passed and show ${snapshot.then[0]?.name ?? 'nothing ahead'}`);
    retry.hidden = !failedPress;
    retry.setAttribute('aria-disabled', String(busy));
    get<HTMLElement>('#tk-sheet-error').hidden = !failedPress;
    sheetRetry.setAttribute('aria-disabled', String(busy));
    add.hidden = !available || !!snapshot?.current || !!failedPress;
    saved.hidden = !!failedPress || (!undoStack.length && !restoredNotice);
    undo.hidden = !undoStack.length;
    undo.setAttribute('aria-disabled', String(busy));
    undo.textContent = `Undo${undoStack.length > 1 ? ` (${undoStack.length})` : ''}`;
    const last = undoStack.at(-1);
    if (last) undo.setAttribute('aria-label', `Saved. Undo, put back ${last.name}`);
    savedLabel.textContent = last ? 'Saved ·' : 'Restored';
    saved.classList.toggle('tk-restored', !last);
    for (const button of Array.from(dialog.querySelectorAll<HTMLButtonElement>('[data-tk-put-back]'))) button.setAttribute('aria-disabled', String(busy));
  }
  function clearUndo(): void {
    if (undoTimer) clearTimeout(undoTimer);
    undoTimer = undefined; undoStack = []; restoredNotice = false;
  }
  function armUndo(): void {
    if (undoTimer) clearTimeout(undoTimer);
    undoTimer = setTimeout(() => { clearUndo(); renderActions(); }, 8_000);
  }
  function itemRow(item: TickerItem): string {
    return `<article class="tk-row" data-tk-ahead-row="${e(item.key)}"><span class="tk-row-date">${e(item.dateLabel)}</span><div class="tk-row-copy"><strong>${tickerIcon(item.kind)}${e(item.name)}</strong>${item.note ? `<p>${e(item.note)}</p>` : ''}</div>${tickerChip(item)}</article>`;
  }
  const passedDay = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short' });
  const passedTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  function renderSheet(): void {
    if (!snapshot) return;
    get<HTMLElement>('#tk-mode').hidden = snapshot.mode !== 'sample';
    get<HTMLElement>('#tk-ahead').innerHTML = snapshot.ahead.length ? snapshot.ahead.slice(0, expanded ? undefined : 3).map(itemRow).join('')
      : `<p class="tk-sheet-empty">${tickerIcon('check')} Nothing ahead</p><a class="tk-sheet-add" href="/settings#keyDates">Add a date ${tickerIcon('chevron')}</a>`;
    more.hidden = snapshot.ahead.length <= 3;
    more.textContent = expanded ? 'Show fewer' : `+${snapshot.ahead.length - 3} more`;
    more.setAttribute('aria-expanded', String(expanded));
    get<HTMLElement>('#tk-passed-heading').textContent = `Passed (${snapshot.passed.length})`;
    get<HTMLElement>('#tk-passed').innerHTML = snapshot.passed.map(item => {
      const at = new Date(item.passed_at);
      return `<article class="tk-passed-row" data-tk-passed-row="${e(item.key)}"><div class="tk-row-copy"><strong>${tickerIcon(item.kind)}${e(item.name)}</strong><p>${e(item.dateLabel)}</p><small>Passed ${e(passedDay.format(at))}, ${e(passedTime.format(at))} UK</small></div><button class="tk-put-back" type="button" data-tk-put-back="${e(item.key)}" aria-label="Put back ${e(item.name)}">Put back</button></article>`;
    }).join('') || '<p class="tk-passed-empty">No dates passed yet.</p>';
  }
  async function display(data: TickerSnapshot, changed = false, glint = false): Promise<void> {
    if (changed && !reduced.matches) {
      animation = animation ? 0 : 1;
      content.className = `tk-content tk-leave-${animation}`;
      await new Promise<void>(resolve => setTimeout(resolve, 220));
    }
    if (snapshot?.mode !== data.mode) clearUndo();
    snapshot = data; readFailed = false;
    content.innerHTML = bandHtml(data);
    content.className = `tk-content${changed && !reduced.matches ? ` tk-enter-${animation}` : ''}`;
    band.setAttribute('aria-label', accessibleLine(data)); band.setAttribute('aria-disabled', 'false');
    if (glint && !reduced.matches) {
      glintAnimation = glintAnimation ? 0 : 1;
      band.classList.remove('tk-glint-0', 'tk-glint-1'); band.classList.add(`tk-glint-${glintAnimation}`);
    }
    root.dataset.tkReady = 'true'; root.dataset.tkMode = data.mode;
    renderSheet(); renderActions(); measure(); positionDialog();
    if (changed) {
      const announcement = data.current ? `Next up: ${data.current.name}, ${data.current.dateLabel}, ${data.current.chip}.` : 'Nothing ahead.';
      status.textContent = dialog.open ? '' : announcement;
      sheetStatus.textContent = dialog.open ? announcement : '';
    }
  }
  async function read(): Promise<void> {
    if (busy) return;
    const token = ++revision;
    try {
      const response = await fetch('/api/ticker', { cache: 'no-store', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error('Ticker unavailable');
      const data = await response.json() as TickerSnapshot;
      if (token !== revision || busy) return;
      failedPress = null; await display(data);
    } catch {
      if (token !== revision || busy) return;
      readFailed = true;
      content.className = 'tk-content';
      content.innerHTML = `<span class="tk-quiet">${tickerIcon('info')} Dates unavailable</span>`;
      band.setAttribute('aria-label', 'Next up: dates unavailable.'); band.setAttribute('aria-disabled', 'true');
      root.dataset.tkReady = 'error'; renderActions();
    }
  }
  async function press(command: Press): Promise<void> {
    if (busy) return;
    busy = true; ++revision; renderActions();
    try {
      const response = await fetch(`/api/ticker/${command.action}`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ eventKey: command.key }), signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error('Ticker save failed');
      const data = await response.json() as TickerSnapshot;
      failedPress = null;
      if (command.source === 'next') { undoStack.push({ key: command.key, name: command.name }); restoredNotice = false; armUndo(); }
      else if (command.source === 'undo') { undoStack.pop(); restoredNotice = !undoStack.length; armUndo(); }
      else clearUndo();
      await display(data, true, command.source === 'next');
      root.dispatchEvent(new CustomEvent('pulse:ticker-saved'));
      if (dialog.open) close.focus({ preventScroll: true });
      else if (!next.hidden) next.focus({ preventScroll: true });
      else if (!add.hidden) add.focus({ preventScroll: true });
    } catch {
      failedPress = command;
      status.textContent = dialog.open ? '' : 'Not saved. Try again.';
      sheetStatus.textContent = dialog.open ? 'Not saved. Try again.' : '';
    } finally {
      busy = false; renderActions();
      if (failedPress) (dialog.open ? sheetRetry : retry).focus({ preventScroll: true });
    }
  }
  function positionDialog(): void {
    if (!dialog.open) return;
    if (phone.matches) { dialog.style.top = 'auto'; dialog.style.maxHeight = ''; return; }
    const headerBottom = document.querySelector<HTMLElement>('header.top')?.getBoundingClientRect().bottom ?? 0;
    const stripBox = root.getBoundingClientRect();
    const top = Math.max(8, (stripBox.bottom > headerBottom && stripBox.top < window.innerHeight ? stripBox.bottom : headerBottom) + 8);
    dialog.style.top = `${top}px`;
    dialog.style.maxHeight = `${Math.max(100, window.innerHeight - top - 16)}px`;
  }
  function openDialog(source: HTMLElement): void {
    if (!snapshot || readFailed || dialog.open) return;
    opener = source; renderSheet(); renderActions();
    dialog.showModal(); root.classList.add('tk-open'); band.setAttribute('aria-expanded', 'true'); positionDialog(); close.focus();
  }
  band.addEventListener('click', () => openDialog(band));
  next.addEventListener('click', () => { if (snapshot?.current && !readFailed && !failedPress) void press({ action: 'next', key: snapshot.current.key, name: snapshot.current.name, source: 'next' }); });
  undo.addEventListener('click', () => { const last = undoStack.at(-1); if (last) void press({ action: 'restore', ...last, source: 'undo' }); });
  retry.addEventListener('click', () => { if (failedPress) void press(failedPress); });
  sheetRetry.addEventListener('click', () => { if (failedPress) void press(failedPress); });
  close.addEventListener('click', () => dialog.close());
  more.addEventListener('click', () => { expanded = !expanded; renderSheet(); renderActions(); });
  dialog.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-tk-put-back]');
    const item = snapshot?.passed.find(row => row.key === button?.dataset.tkPutBack);
    if (item) void press({ action: 'restore', key: item.key, name: item.name, source: 'put-back' });
    if (event.target === dialog) {
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    }
  });
  dialog.addEventListener('close', () => { root.classList.remove('tk-open'); band.setAttribute('aria-expanded', 'false'); if (opener.isConnected) opener.focus({ preventScroll: true }); });
  window.addEventListener('resize', positionDialog);
  window.addEventListener('scroll', positionDialog, { passive: true });
  new ResizeObserver(measure).observe(band);
  void document.fonts.ready.then(measure);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void read(); });
  // Morning already has the saved ticker response; share it without another read or poll.
  root.addEventListener('pulse:ticker-state', event => {
    if (!(event instanceof CustomEvent)) return;
    const data = event.detail as TickerSnapshot;
    if (!data || !['sample', 'live'].includes(data.mode) || !Array.isArray(data.ahead) || !Array.isArray(data.passed)) return;
    ++revision; clearUndo(); failedPress = null; void display(data);
  });
  void read();
}
