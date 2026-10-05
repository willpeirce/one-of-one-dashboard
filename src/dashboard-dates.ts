import type { DashboardSnapshot, HeroPeriod } from './dashboard-types.js';

const dayMs = 86_400_000;
const dayNumber = (iso: string): number => Date.parse(`${iso}T00:00:00Z`) / dayMs;
const dateAt = (day: number): Date => new Date(day * dayMs);
const isoDay = (day: number): string => dateAt(day).toISOString().slice(0, 10);
const monthOf = (day: number): number => dateAt(day).getUTCFullYear() * 12 + dateAt(day).getUTCMonth();
const monthStart = (month: number): number => Date.UTC(Math.floor(month / 12), month % 12, 1) / dayMs;
const shortMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (day: number): string => `${dateAt(day).getUTCDate()} ${shortMonths[dateAt(day).getUTCMonth()]}`;
function rangeLabel(from: number, to: number): string {
  if (from === to) return shortDate(from);
  return monthOf(from) === monthOf(to) ? `${dateAt(from).getUTCDate()}–${shortDate(to)}` : `${shortDate(from)}–${shortDate(to)}`;
}
function element<T extends HTMLElement = HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error('Date picker element missing');
  return found;
}

/** Calendar state only: business values always come from the authenticated hero endpoint. */
export function createDatePicker(options: {
  bounds: () => DashboardSnapshot['bounds'];
  selected: () => Pick<HeroPeriod, 'from' | 'to'>;
  apply: (from: string, to: string) => Promise<boolean>;
  cancel: () => void;
}): { open: () => void } {
  const dialog = element<HTMLDialogElement>('#picker');
  const calendar = element('#pkcal');
  const go = element<HTMLButtonElement>('#pkgo');
  const breakpoint = matchMedia('(min-width:641px)');
  let from: number | null = null, to: number | null = null;
  let phase: 'fresh' | 'first' | 'range' | 'empty' = 'fresh';
  let view = 0, focusDay = 0, request = 0;
  const limits = (): { min: number; max: number; today: number; two: boolean; firstMonth: number; lastMonth: number } => {
    const bounds = options.bounds(), min = dayNumber(bounds.min), max = dayNumber(bounds.max);
    return { min, max, today: dayNumber(bounds.today), two: breakpoint.matches && monthOf(min) < monthOf(max), firstMonth: monthOf(min), lastMonth: monthOf(max) };
  };
  const clampView = (month: number): number => {
    const bounds = limits();
    return Math.min(bounds.lastMonth, Math.max(bounds.firstMonth + Number(bounds.two), month));
  };
  const quickRange = (name: string): [number, number] | undefined => {
    const { today } = limits(), month = monthOf(today);
    if (name === '14') return [today - 14, today - 1];
    if (name === 'mtd') return [monthStart(month), today];
    if (name === 'lm') return [monthStart(month - 1), monthStart(month) - 1];
    if (name === 'ytd') return [monthStart(Math.floor(month / 12) * 12), today];
    return undefined;
  };
  function draw(): void {
    const bounds = limits();
    view = clampView(view);
    calendar.classList.toggle('one', !bounds.two);
    calendar.replaceChildren();
    for (const month of bounds.two ? [view - 1, view] : [view]) {
      const start = monthStart(month), end = monthStart(month + 1);
      const name = dateAt(start).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      const group = document.createElement('div');
      group.className = 'mon'; group.setAttribute('role', 'group'); group.setAttribute('aria-label', name);
      const title = document.createElement('h4'); title.textContent = name; group.append(title);
      const weekdays = document.createElement('div'); weekdays.className = 'wk'; weekdays.setAttribute('aria-hidden', 'true');
      for (const letter of 'MTWTFSS') { const span = document.createElement('span'); span.textContent = letter; weekdays.append(span); }
      group.append(weekdays);
      const days = document.createElement('div'); days.className = 'days';
      for (let blank = 0; blank < (dateAt(start).getUTCDay() + 6) % 7; blank += 1) days.append(document.createElement('span'));
      for (let day = start; day < end; day += 1) {
        const button = document.createElement('button');
        const selected = from !== null && to !== null && day >= from && day <= to;
        button.type = 'button'; button.className = 'day';
        button.classList.toggle('today', day === bounds.today);
        button.classList.toggle('in', selected && from !== to);
        button.classList.toggle('a', day === from); button.classList.toggle('b', day === to);
        button.dataset.n = String(day); button.dataset.date = isoDay(day);
        button.textContent = String(dateAt(day).getUTCDate());
        button.disabled = day < bounds.min || day > bounds.max;
        button.tabIndex = day === focusDay ? 0 : -1;
        button.setAttribute('aria-label', dateAt(day).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) + (day === bounds.today ? ', sample today' : ''));
        button.setAttribute('aria-pressed', String(selected));
        if (day === bounds.today) button.setAttribute('aria-current', 'date');
        days.append(button);
      }
      group.append(days); calendar.append(group);
    }
    element<HTMLButtonElement>('#picker [data-nav="-1"]').disabled = view <= bounds.firstMonth + Number(bounds.two);
    element<HTMLButtonElement>('#picker [data-nav="1"]').disabled = view >= bounds.lastMonth;
    const chosenFrom = from, chosenTo = to;
    const hasRange = chosenFrom !== null && chosenTo !== null;
    const days = hasRange ? chosenTo - chosenFrom + 1 : 0;
    go.disabled = !hasRange;
    go.textContent = hasRange ? `Show ${rangeLabel(chosenFrom, chosenTo)}${days > 1 ? ` · ${days} days` : ''}` : 'Pick a day';
    const current = options.selected();
    element('#pkhint').textContent = phase === 'fresh' ? `Showing ${rangeLabel(dayNumber(current.from), dayNumber(current.to))}. Tap a day to start.`
      : phase === 'first' && from !== null ? `${shortDate(from)}. Tap another day for a range, or Show.`
      : phase === 'range' && hasRange ? `${rangeLabel(chosenFrom, chosenTo)} · ${days} days. Tap a day to start again.`
      : 'Tap a day. Tap a second day for a range.';
    element('#pkbounds').textContent = `Sample days ${rangeLabel(bounds.min, bounds.max)} ${dateAt(bounds.max).getUTCFullYear()}. Today is ${shortDate(bounds.today)} in this sample, so far.`;
    for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('#pkquick [data-q]'))) {
      const range = quickRange(button.dataset.q ?? '');
      button.disabled = !range || range[0] < bounds.min || range[1] > bounds.max;
    }
  }
  function focusCalendar(day: number): void {
    const bounds = limits();
    focusDay = Math.max(bounds.min, Math.min(bounds.max, day));
    const month = monthOf(focusDay);
    if (month < view - Number(bounds.two)) view = clampView(month + Number(bounds.two));
    else if (month > view) view = clampView(month);
    draw();
    calendar.querySelector<HTMLButtonElement>(`[data-n="${focusDay}"]`)?.focus();
  }
  function cancelPending(): void {
    request += 1; options.cancel(); dialog.removeAttribute('aria-busy');
  }
  function closePicker(): void {
    cancelPending(); dialog.close(); element('#pickbtn').focus();
  }
  function selectDay(day: number): void {
    cancelPending();
    if (phase !== 'first' || from === null) { from = to = day; phase = 'first'; }
    else { to = Math.max(from, day); from = Math.min(from, day); phase = 'range'; }
    element('#pkerror').textContent = '';
    focusCalendar(day);
  }
  async function submit(): Promise<void> {
    if (from === null || to === null) return;
    const generation = ++request;
    element('#pkerror').textContent = 'Loading sample dates…';
    dialog.setAttribute('aria-busy', 'true');
    const success = await options.apply(isoDay(from), isoDay(to));
    if (generation !== request || !dialog.open) return;
    dialog.removeAttribute('aria-busy');
    if (success) closePicker();
    else element('#pkerror').textContent = 'Could not load those dates. Try again.';
  }
  calendar.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('.day') : null;
    if (button && !button.disabled) selectDay(Number(button.dataset.n));
  });
  calendar.addEventListener('keydown', (event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('.day') : null;
    if (!button) return;
    const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
    if (delta !== undefined) { event.preventDefault(); focusCalendar(Number(button.dataset.n) + delta); }
  });
  for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('#picker [data-nav]'))) button.addEventListener('click', () => {
    view = clampView(view + Number(button.dataset.nav));
    const bounds = limits();
    focusDay = Math.max(bounds.min, Math.min(bounds.max, monthStart(view - Number(bounds.two))));
    draw();
  });
  element('#pkquick').addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-q]') : null;
    if (!button || button.disabled) return;
    const range = quickRange(button.dataset.q ?? '');
    if (!range) return;
    [from, to] = range; phase = 'range'; draw(); void submit();
  });
  go.addEventListener('click', () => { void submit(); });
  element('#pkclear').addEventListener('click', () => {
    cancelPending();
    from = to = null; phase = 'empty'; element('#pkerror').textContent = ''; draw();
  });
  element('#pk-x').addEventListener('click', closePicker);
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); closePicker(); });
  dialog.addEventListener('click', (event) => { if (event.target === dialog) closePicker(); });
  dialog.addEventListener('close', () => { if (!dialog.open) element('#pickbtn').focus(); });
  breakpoint.addEventListener('change', () => { if (dialog.open) focusCalendar(focusDay); });
  return { open(): void {
    const selected = options.selected();
    from = dayNumber(selected.from); to = dayNumber(selected.to); phase = 'fresh';
    focusDay = to; view = clampView(monthOf(to));
    element('#pkerror').textContent = ''; draw(); dialog.showModal(); focusCalendar(focusDay);
  } };
}
