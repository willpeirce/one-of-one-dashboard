import {setDecisions} from './decisions/browser.js';
import {footerChipHtml} from './home-layout.js';
import {arrangeHomeDials} from './home-layout-browser.js';
import { hourLabel, hourlyTop, monotoneSegments } from './hourly-orders.js';
import {updateAdSets} from './meta-adsets/browser.js';
import { metricSign } from './metric-sign.js';
import { dropsHtml, radarMeasure, radarSummary, weakestRadarGauge, type DropArea } from './radar.js';
import { glance } from './fulfilment/view.js';
import { updateCreativeSnapshot } from './creatives/browser.js';
import { liveHtml, storePanelsHtml } from './shopify/presentation.js';
import type { DashboardSnapshot, Detail, DialModel, HeroMarket, HeroMetric, HeroPeriod, Period, RingModel, SheetModel, State, TestModel, Zone } from './dashboard-types.js';
import { createDatePicker } from './dashboard-dates.js';
import { rangeLabel } from './hero-range.js';
import { installPullToRefresh } from './pull-refresh.js';
import { greetingAt } from './greeting.js';
import { formatLike, formatMetricNumber, formatNumber, formatPounds } from './money.js';
import { paceState, seriesPaceCardHtml, seriesPaceDial, seriesPaceFacts, seriesPaceSheetHtml, type SeriesPaceCard } from './series-pace/presentation.js';
import type { SeriesPaceMarket } from './series-pace/model.js';
import { reviewsGreeting, reviewsPanelHtml, reviewSheetHtml } from './judgeme/presentation.js';

const states: Record<State, [string, string]> = {
  good: ['Good', '✓'], warn: ['Watch', '△'], decide: ['Decide', '◆'], alarm: ['Alarm', '✕'],
  info: ['Info', 'i'], sofar: ['So far', '·'], est: ['Estimate', '≈'],
};
const rank: Record<State, number> = { good: 0, info: 0, sofar: 0, est: 0, warn: 1, decide: 2, alarm: 3 };
const colour: Record<State, string> = {
  good: 'var(--good)', warn: 'var(--warn)', decide: 'var(--decide)', alarm: 'var(--alarm)',
  info: 'var(--info)', sofar: 'var(--info)', est: 'var(--info)',
};
const icons: Record<string, string> = { meta: 'i-meta', google: 'i-google', shopify: 'i-bag', mail: 'i-mail', growth: 'i-growth', stock: 'i-box' };
const groups = [['meta', 'Meta'], ['google', 'Google'], ['growth', 'Growth'], ['store', 'Store'], ['email', 'Email'], ['stock', 'Stock']] as const;
const panelGroups: Record<string, string> = { ads: 'meta', store: 'store', growth: 'growth', stock: 'stock' };
const iconGroups: Record<string, string> = { 'i-meta': 'meta', 'i-google': 'google', 'i-bag': 'store', 'i-mail': 'email', 'i-growth': 'growth', 'i-box': 'stock' };
const sourceGroups: Record<string, string> = { meta: 'meta', google: 'google', shopify: 'store', mail: 'email', growth: 'growth', stock: 'stock' };
const all = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T[] => Array.from(root.querySelectorAll<T>(selector));
function get<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error('Dashboard element missing');
  return element;
}
const esc = (value: string | number): string => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const rounded = (value: number): number => Math.round(value * 100) / 100;
const chip = (state: State): string => `<span class="chip ${state}">${states[state][1]} ${states[state][0]}</span>`;
const reducedMotion = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;
const scrollTo = (element: Element): void => element.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });

function zoneIndex(value: number, zones: Zone[]): number {
  const index = zones.findIndex(([min, max], i) => value >= min && (value < max || (i === zones.length - 1 && value <= max)));
  return index >= 0 ? index : value < (zones[0]?.[0] ?? 0) ? 0 : zones.length - 1;
}
const zoneOf = (value: number, zones: Zone[]): State => zones[zoneIndex(value, zones)]?.[2] ?? 'info';
const angle = (value: number, min: number, max: number): number => Math.PI * (1 - clamp((value - min) / (max - min), 0, 1));
const point = (a: number, radius: number, cx = 50, cy = 50): [number, number] => [rounded(cx + radius * Math.cos(a)), rounded(cy - radius * Math.sin(a))];
function arc(start: number, end: number, radius = 40): string {
  const [x1, y1] = point(start, radius), [x2, y2] = point(end, radius);
  return `M${x1} ${y1}A${radius} ${radius} 0 ${start - end > Math.PI ? 1 : 0} 1 ${x2} ${y2}`;
}
function watermark(element: HTMLElement): void {
  const icon = icons[element.dataset.src ?? ''];
  if (icon && !element.querySelector('.wm')) element.insertAdjacentHTML('afterbegin', `<svg class="ic wm" aria-hidden="true"><use href="#${icon}"/></svg>`);
}

interface SheetDetail { state: State; title: string; detail: Detail; mode: 'sample' | 'live'; dial?: Pick<DialModel, 'min' | 'max' | 'z' | 't'> }
const details = new WeakMap<HTMLElement, SheetDetail>();
let selectedPeriod: Period | 'pick' = 'today';
let selectedMarket: HeroMarket = 'all';
let pickedHero: HeroPeriod | undefined;
let rangeRequest: AbortController | undefined;
let rangeGeneration = 0;
let selectedDeck = ['ads', 'store', 'growth', 'stock'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'ads';
let snapshot: DashboardSnapshot;
let openDetail: HTMLElement | undefined;
let openTemplateId: string | undefined;
let seriesSheetGeneration = 0;
let stream: EventSource | undefined;

function renderDial(element: HTMLElement, data: DialModel, mode: 'sample' | 'live'): void {
  const { v, min, max, z } = data;
  // An explicit status also owns a shared zone boundary (Series 1 includes +5 in green).
  const cappedZone = z.findIndex(([start, end, state]) => state === data.cap && v >= start && v <= end);
  const activeZone = cappedZone >= 0 ? cappedZone : zoneIndex(v, z), state = data.cap ?? zoneOf(v, z), format = data.hidePointer || data.t === 'No data' ? (value: number) => formatNumber(Math.round(value)) : formatLike(data.t);
  let svg = `<span class="well"><svg viewBox="0 0 100 64" aria-hidden="true"><path d="${arc(Math.PI, 0)}" fill="none" stroke="var(--line)" stroke-width="7"/>`;
  z.forEach(([start, end, status], index) => {
    const a = angle(start, min, max) - (index ? 0.035 : 0), b = angle(end, min, max) + (index < z.length - 1 ? 0.035 : 0);
    if (a > b) svg += `<path d="${arc(a, b)}" fill="none" stroke="${colour[data.cap === 'info' ? 'info' : status]}" stroke-width="7" stroke-opacity="${index === activeZone ? 1 : 0.28}"/>`;
  });
  const [x, y] = point(angle(v, min, max), 40);
  svg += `${data.hidePointer || data.t === 'No data' ? '' : `<circle cx="${x}" cy="${y}" r="5" fill="var(--ink)" stroke="var(--pointer-ring)" stroke-width="2.5"/>`}<text x="50" y="52" text-anchor="middle" font-family="var(--disp)" font-size="15" font-weight="700" fill="var(--ink)">${esc(data.t)}</text><text x="10" y="62" text-anchor="middle" font-size="7.5" fill="var(--muted)">${esc(format(min))}</text><text x="90" y="62" text-anchor="middle" font-size="7.5" fill="var(--muted)">${esc(format(max))}</text></svg></span>`;
  element.innerHTML = `${svg}<span class="dl">${esc(data.l)}</span><span class="ds">${esc(data.s)}</span>${chip(state)}`;
  element.dataset.state = state;
  element.setAttribute('aria-label', `${data.l}: ${data.t}, ${states[state][0]}`);
  details.set(element, { state, title: data.l, detail: data.d, mode, dial: data });
  watermark(element);
}

function renderSeriesPace(element: HTMLElement, card: SeriesPaceCard, mode: 'sample' | 'live'): void {
  if (!element.querySelector('[data-series-market]')) element.innerHTML = seriesPaceCardHtml(card, mode);
  element.dataset.state = Object.values(card.markets).some(model => model.state === 'warn') ? 'warn' : Object.values(card.markets).every(model => model.state === 'good') ? 'good' : 'info';
  element.querySelectorAll(':scope > .sample-label').forEach(label => label.remove());
  if (mode === 'sample') element.insertAdjacentHTML('beforeend', '<small class="sample-label">Sample data</small>');
  for (const market of ['UK', 'US'] as const) {
    const button = get(`[data-series-market="${market}"]`, element), model = card.markets[market];
    renderDial(button, seriesPaceDial(market, model), mode);
    button.insertAdjacentHTML('beforeend', seriesPaceFacts(model));
    button.setAttribute('aria-label', `Series 1 sell-out pace · ${market}: ${model.verdict}`);
    button.querySelector('.well')?.insertAdjacentHTML('afterend', '<span class="pace-scale" aria-hidden="true"><span>Too slow</span><span>On pace</span><span>Too fast</span></span>');
  }
}

function showSeriesPaceDetail(element: HTMLElement, market: SeriesPaceMarket, reopen: boolean): void {
  const widget = snapshot.widgets.w017;
  if (widget?.kind !== 'series-pace') return;
  if (reopen) seriesSheetGeneration += 1;
  // A heartbeat may update the dial, but it must never replace an unsaved date.
  if (!reopen && document.querySelector<HTMLFormElement>('#series-target-form')?.dataset.dirty === 'true') return;
  openDetail = element; openTemplateId = undefined;
  const model = widget.value.markets[market], dial = seriesPaceDial(market, model), state = paceState(model);
  get('#sh-title').textContent = `Series 1 sell-out pace · ${market}`;
  get('#sh-dot').className = `dot ${state}`; get('#sh-dot').textContent = states[state][1];
  get('#sh-dl').hidden = false;
  get('#sh-why').textContent = dial.d.why;
  get('#sh-rule').textContent = dial.d.rule;
  get('#sh-src').textContent = `${dial.d.src} · ${widget.mode === 'sample' ? 'sample data' : 'live'}`;
  get('#sh-chart').replaceChildren();
  get('#sh-extra').innerHTML = seriesPaceSheetHtml(market, model, widget.mode);
  const sheet = get<HTMLDialogElement>('#sheet');
  if (reopen && !sheet.open) sheet.showModal();
}

async function saveSeriesTarget(value: string): Promise<void> {
  const form = document.querySelector<HTMLFormElement>('#series-target-form'), widget = snapshot.widgets.w017;
  if (!form || form.dataset.pending === 'true' || widget?.kind !== 'series-pace' || widget.mode === 'sample') return;
  const market = form.dataset.market === 'US' ? 'US' : 'UK', generation = seriesSheetGeneration;
  const targetKey = market === 'UK' ? 'series1UkTargetDate' : 'series1UsTargetDate';
  form.dataset.pending = 'true'; form.dataset.dirty = 'true';
  get<HTMLFieldSetElement>('fieldset', form).disabled = true;
  const status = get('#series-target-status', form);
  status.textContent = 'Saving target date…';
  let saved = false;
  try {
    // Read the latest version and preserve every unrelated Settings field.
    const currentResponse = await fetch('/api/settings', { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!currentResponse.ok) throw new Error('settings-read');
    const current = await currentResponse.json() as { version: number; values: Record<string, unknown> };
    const response = await fetch('/api/settings', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: current.version, values: { ...current.values, [targetKey]: value } }) });
    if (response.status === 409) { status.textContent = 'Settings changed on another device. Your date is still here. Try Save again to use the latest settings.'; return; }
    if (response.status === 400) { status.textContent = 'Enter a real target date, or use the landing date.'; return; }
    if (response.status === 401) { status.textContent = 'Your session has ended. Sign in again before saving.'; return; }
    if (!response.ok) throw new Error('settings-save');
    saved = true; form.dataset.dirty = 'false';
    await refreshDashboard(new AbortController().signal);
    // A delayed save must never claim that another sheet or a newer draft was saved.
    const activeForm = document.querySelector<HTMLFormElement>('#series-target-form');
    if (generation === seriesSheetGeneration && activeForm?.dataset.market === market
      && activeForm.dataset.dirty !== 'true' && get<HTMLDialogElement>('#sheet').open
      && get<HTMLInputElement>('#series-target-date', activeForm).value === value) {
      get('#series-target-status', activeForm).textContent = value ? 'Target date saved.' : 'Using the landing date.';
    }
  } catch {
    status.textContent = saved ? 'Target saved. Refresh to see the updated dial.' : 'Could not save the target. Your date is still here. Try again.';
  } finally {
    form.dataset.pending = 'false';
    get<HTMLFieldSetElement>('fieldset', form).disabled = false;
  }
}

function renderRing(element: HTMLElement, data: RingModel, mode: 'sample' | 'live'): void {
  const state = data.z ? zoneOf(data.v, data.z) : data.state ?? 'info', circumference = 2 * Math.PI * 40;
  element.innerHTML = `<span class="well"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="40" fill="none" stroke="var(--line)" stroke-width="8"/><circle cx="50" cy="50" r="40" fill="none" stroke="${colour[state]}" stroke-width="8" stroke-linecap="round" transform="rotate(-90 50 50)" stroke-dasharray="${rounded(clamp(data.v / data.max, 0, 1) * circumference)} ${rounded(circumference)}"/><text x="50" y="56" text-anchor="middle" font-family="var(--disp)" font-size="17" font-weight="700" fill="var(--ink)">${esc(data.t)}</text></svg></span><span class="dl">${esc(data.l)}</span><span class="ds">${esc(data.s)}</span>${chip(state)}`;
  element.dataset.state = state;
  element.setAttribute('aria-label', `${data.l}: ${data.t}, ${states[state][0]}`);
  details.set(element, { state, title: data.l, detail: data.d, mode, ...(data.z ? { dial: { min: 0, max: data.max, z: data.z, t: data.t } } : {}) });
  watermark(element);
}

function renderSpark(element: HTMLElement, values: number[], detail?: Detail): void {
  element.dataset.spark = values.join(',');
  const high = Math.max(...values, 1), gap = values.length > 14 ? 2 : 6;
  const width = (220 - gap * (values.length - 1)) / values.length;
  element.innerHTML = `<svg viewBox="0 0 220 34" preserveAspectRatio="none"${detail?.ha ? ` role="img" aria-label="${esc(detail.ha)}"` : ' aria-hidden="true"'}>${values.map((value, index) => {
    const height = Math.max(3, 34 * value / high), marker = detail?.hm?.[index];
    return `<rect x="${rounded(index * (width + gap))}" y="${rounded(34 - height)}" width="${rounded(width)}" height="${rounded(height)}" rx="${rounded(Math.min(3, width / 2))}" fill="${index === values.length - 1 ? 'var(--spark)' : 'var(--line-2)'}"${marker ? ' class="spike" stroke="currentColor" stroke-width="1"' : ''}>${marker ? `<title>${esc(marker)}</title>` : ''}</rect>`;
  }).join('')}</svg>`;
}

function statChip(element: HTMLElement, state: State, label?: string): void {
  element.querySelector(':scope > .chip')?.remove();
  element.insertAdjacentHTML('beforeend', label ? `<span class="chip ${state}">${states[state][1]} ${esc(label)}</span>` : chip(state));
  watermark(element);
}

const animations = new WeakMap<HTMLElement, number>();
function metricNumber(element: HTMLElement, data: HeroMetric, animate: boolean): void {
  element.style.setProperty('--number-chars', String(formatMetricNumber(data.n, data).length));
  if (data.unavailable) { animations.set(element, (animations.get(element) ?? 0) + 1); element.textContent = data.unavailableLabel ?? 'No data'; return; }
  const show = (value: number): void => { element.textContent = formatMetricNumber(value, data); };
  const generation = (animations.get(element) ?? 0) + 1;
  animations.set(element, generation);
  if (!animate || reducedMotion()) { show(data.n); return; }
  const start = performance.now();
  function frame(now: number): void {
    if (animations.get(element) !== generation) return;
    const progress = clamp((now - start) / 900, 0, 1);
    show(data.n * (1 - (1 - progress) ** 3));
    if (progress < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function activeHero(): HeroPeriod {
  const period = selectedPeriod === 'pick' && pickedHero ? pickedHero : snapshot.hero[selectedPeriod === 'pick' ? 'today' : selectedPeriod];
  return selectedMarket === 'all' ? period : period.markets?.[selectedMarket] ?? period;
}
function cancelRangeRequest(): void {
  rangeGeneration += 1; rangeRequest?.abort(); rangeRequest = undefined;
}
function setPeriod(period: Period, animate = true): void {
  cancelRangeRequest();
  selectedPeriod = period;
  pickedHero = undefined;
  renderHero(snapshot.hero[period], animate);
}
function renderHourlyOrders(): void {
  const hero = snapshot.hero.today.markets?.[selectedMarket] ?? snapshot.hero.today;
  const data = hero.hourly, host = get('#hourly-orders');
  if (!data?.ready) { host.innerHTML = '<p class="hourly-unavailable">Hourly orders unavailable</p>'; return; }
  const width = Math.max(260, host.clientWidth), left = 24, right = width - 8;
  const x = (hour: number): number => left + hour * (right - left) / 23;
  const top = hourlyTop([...data.today.map(n => n ?? 0), ...data.yesterday]);
  const y = (count: number): number => 100 - 96 * count / top;
  const today = data.today.slice(0, data.nowHour + 1).map(n => n ?? 0);
  const segments = monotoneSegments(today, x, y), previous = monotoneSegments(data.yesterday, x, y);
  const sum = (values: readonly number[]): number => values.reduce((n, value) => n + value, 0);
  const date = (day: string): string => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${day}T12:00:00Z`)).replace(',', '');
  const summary = `Orders by hour, UK time. Today ${sum(today)} so far to ${hourLabel(data.nowHour)}. Yesterday ${sum(data.yesterday.slice(0, data.nowHour + 1))} by ${hourLabel(data.nowHour)}, ${sum(data.yesterday)} all day.`;
  const stroke = 'fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  const key = (yesterday: boolean): string => `<svg aria-hidden="true" viewBox="0 0 20 8"><path d="M1 4H19" ${stroke} stroke="var(--${yesterday ? 'muted' : 'accent'})"${yesterday ? ' stroke-dasharray="6 4"' : ''}/></svg>`;
  const drawing = document.createElement('div');
  drawing.innerHTML = `<p class="hourly-heading">Orders by hour <span>UK time${hero.orders.mode === 'sample' ? ' · Sample data' : ''}</span></p>
    <div class="hourly-plot" tabindex="0" role="img" aria-label="${esc(summary)}">
    <svg viewBox="0 0 ${width} 112" aria-hidden="true">
      ${[0, top / 2, top].map(tick => `<line x1="${left}" y1="${y(tick)}" x2="${right}" y2="${y(tick)}" stroke="var(--line)" stroke-width="1"/><text x="${left - 6}" y="${y(tick) + 3}" text-anchor="end" fill="var(--muted)" font-size="10">${tick}</text>`).join('')}
      ${[0, 6, 12, 18].map(hour => `<text x="${x(hour)}" y="112" text-anchor="middle" fill="var(--muted)" font-size="10">${hourLabel(hour)}</text>`).join('')}
      <path data-hourly-yesterday d="M${x(0)} ${y(data.yesterday[0]!)}${previous.join('')}" ${stroke} stroke="var(--muted)" stroke-dasharray="6 4"/>
      <path data-hourly-today d="M${x(0)} ${y(today[0]!)}${segments.slice(0, -1).join('')}" ${stroke} stroke="var(--accent)"/>
      ${data.nowHour > 0 ? `<path data-hourly-partial d="M${x(data.nowHour - 1)} ${y(today[data.nowHour - 1]!)}${segments.at(-1)}" ${stroke} stroke="var(--accent)" stroke-dasharray="2 4"/>` : ''}
      <circle cx="${x(data.nowHour)}" cy="${y(today.at(-1)!)}" r="4" fill="var(--accent)" stroke="var(--glass)" stroke-width="2"/>
      <g data-hourly-hover visibility="hidden"><line y1="4" y2="100" stroke="var(--muted)" stroke-width="1"/><circle data-today-dot r="3" fill="var(--accent)"/><circle data-yesterday-dot r="3" fill="var(--muted)"/></g>
    </svg><div class="hourly-tooltip" hidden></div></div>
    <div class="hourly-legend"><span>${key(false)}Today, ${esc(date(data.todayDay))}</span><span>${key(true)}Yesterday, ${esc(date(data.yesterdayDay))}</span></div>
    <table class="visually-hidden"><caption>Hourly orders, UK time</caption><thead><tr><th>Hour</th><th>Today</th><th>Yesterday</th></tr></thead><tbody>${data.today.map((value, hour) => `<tr><th>${hourLabel(hour)}</th><td>${value === null ? 'Not yet' : value}</td><td>${data.yesterday[hour]}</td></tr>`).join('')}</tbody></table>`;
  const plot = get('.hourly-plot', drawing), hover = get('[data-hourly-hover]', drawing), tooltip = get('.hourly-tooltip', drawing);
  let selected = data.nowHour;
  const hide = (): void => { hover.setAttribute('visibility', 'hidden'); tooltip.hidden = true; };
  const show = (hour: number): void => {
    selected = clamp(hour, 0, 23);
    hover.setAttribute('visibility', 'visible'); tooltip.hidden = false;
    const line = get('line', hover); line.setAttribute('x1', String(x(selected))); line.setAttribute('x2', String(x(selected)));
    for (const [selector, value] of [['[data-today-dot]', data.today[selected]], ['[data-yesterday-dot]', data.yesterday[selected]]] as const) {
      const dot = get(selector, hover); dot.setAttribute('visibility', value == null ? 'hidden' : 'visible');
      dot.setAttribute('cx', String(x(selected))); dot.setAttribute('cy', String(y(value ?? 0)));
    }
    tooltip.replaceChildren();
    for (const [text, strong] of [[`${hourLabel(selected)} · Today `, false], [data.today[selected] === null ? 'Not yet' : String(data.today[selected]), true], [' · Yesterday ', false], [String(data.yesterday[selected]), true]] as const) {
      const part = document.createElement(strong ? 'strong' : 'span'); part.textContent = text; tooltip.append(part);
    }
  };
  const pointHour = (event: PointerEvent): void => {
    const bounds = plot.getBoundingClientRect();
    show(Math.round(((event.clientX - bounds.left) * width / bounds.width - left) * 23 / (right - left)));
  };
  plot.addEventListener('pointermove', pointHour); plot.addEventListener('pointerdown', pointHour);
  plot.addEventListener('pointerleave', event => { if (event.pointerType !== 'touch') hide(); }); plot.addEventListener('blur', hide);
  plot.addEventListener('keydown', event => {
    if (event.key === 'Escape') { hide(); return; }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); show(selected + (event.key === 'ArrowRight' ? 1 : -1)); }
  });
  const focused = host.contains(document.activeElement);
  host.replaceChildren(...Array.from(drawing.childNodes));
  if (focused) plot.focus({ preventScroll: true });
}

function renderHero(hero: HeroPeriod, animate = false): void {
  hero = selectedMarket === 'all' ? hero : hero.markets?.[selectedMarket] ?? hero;
  all('#market [data-market]').forEach(element => element.setAttribute('aria-selected', String(element.dataset.market === selectedMarket)));
  get('#hero').dataset.market = selectedMarket;
  const period = selectedPeriod;
  all('#period [data-period]').forEach((element) => element.setAttribute('aria-selected', String(element.dataset.period === period)));
  get('#picklbl').textContent = period === 'pick' ? hero.short : 'Dates';
  get('#pickbtn').setAttribute('aria-label', period === 'pick' ? `Dates, showing ${hero.short}` : 'Pick a day or dates');
  get('#hero').dataset.from = hero.from; get('#hero').dataset.to = hero.to;
  get('#eyebrow').textContent = hero.eyebrow;
  get('#sub1').textContent = hero.sub1;
  for (const key of ['net', 'orders', 'aov', 'cac', 'cr', 'spend', 'roas', 'margin', 'contribution', 'profit'] as const) {
    const element = get(`#hero [data-k="${key}"]`), metric = hero[key];
    element.dataset.mode = metric.mode;
    element.dataset.source = metric.source.join(' ');
    if (metric.mode === 'live') element.querySelector('.sample-label')?.remove();
    metricNumber(get('.sv', element), metric, animate);
    if (key === 'net') {
      let gross = element.querySelector<HTMLElement>('.gross');
      if (!gross) { get('.sv', element).insertAdjacentHTML('afterend', '<span class="gross"></span>'); gross = get<HTMLElement>('.gross', element); }
      gross.textContent = hero.grossUnavailable ? 'Total unavailable' : `Total ${formatPounds(hero.gross)}`;
    }
    get('.ss', element).textContent = metric.ss;
    element.dataset.state = metric.state;
    if (['margin', 'contribution', 'profit'].includes(key)) element.dataset.sign = metricSign(metric);
    element.dataset.detail = JSON.stringify(metric.d);
    statChip(element, metric.state, metric.statusLabel);
    details.set(element, { state: metric.state, title: key === 'profit' ? 'Net profit' : key === 'contribution' ? 'Contribution' : key === 'margin' ? 'Net margin' : get('.sl', element).textContent ?? '', detail: metric.d, mode: metric.mode });
    const spark = element.querySelector<HTMLElement>('.spark');
    if (spark) renderSpark(spark, hero.spark, metric.d);
  }
  for (const key of ['ukcpo', 'uscpo'] as const) {
    const element = get(`[data-k="${key}"]`);
    element.hidden = selectedMarket !== 'all' && element.dataset.marketOnly !== selectedMarket;
    element.dataset.dial = JSON.stringify(hero[key]);
    element.dataset.source = hero[key].source.join(' ');
    element.dataset.mode = hero[key].mode;
    renderDial(element, hero[key], hero[key].mode);
  }
  if (hero.business) for (const [kind, widgetId, valueKey, subKey] of [['email','w039','t0269','t0270'], ['refill','w037','t0266','t0267']] as const) {
    const model = hero.business[kind], element = document.querySelector<HTMLElement>(`[data-model-id="${widgetId}"]`);
    all(`[data-sample-text="${valueKey}"]`).forEach(e => { e.textContent = formatNumber(model.count); });
    all(`[data-sample-text="${subKey}"]`).forEach(e => { e.textContent = `${rangeLabel(hero.from, hero.to)} · Shopify ${hero.net.mode}`; });
    if (element) details.set(element, { state: 'info', title: kind === 'email' ? 'Email · Shopify' : 'Refill Pack', detail: model.detail, mode: hero.net.mode });
  }
  setDecisions({amberDials:all('#dials .tile[data-state=warn][data-mode=live]').length});
  renderHourlyOrders();
}

async function applyPickedRange(from: string, to: string): Promise<boolean> {
  const preset = (Object.keys(snapshot.hero) as Period[]).find((key) => snapshot.hero[key].from === from && snapshot.hero[key].to === to);
  if (preset) { setPeriod(preset); return true; }
  cancelRangeRequest();
  const generation = rangeGeneration;
  const controller = new AbortController(); rangeRequest = controller;
  try {
    const response = await fetch(`/api/hero?${new URLSearchParams({ from, to })}`, { signal: controller.signal, credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (response.status === 401) { window.location.assign('/login'); return false; }
    if (!response.ok) return false;
    const hero = await response.json() as HeroPeriod;
    if (generation !== rangeGeneration || hero.from !== from || hero.to !== to) return false;
    pickedHero = hero; selectedPeriod = 'pick'; renderHero(hero, true);
    return true;
  } catch { return false; }
  finally { if (generation === rangeGeneration) rangeRequest = undefined; }
}

function renderTest(card: HTMLElement, data: TestModel): void {
  const top = Math.max(...data.arms.map((arm) => arm.x + 1.28 * Math.sqrt(arm.x))) * 1.08 || 1;
  const leader = Math.max(...data.arms.map((arm) => arm.x)), tied = data.arms.every((arm) => arm.x === leader);
  get('[data-bars]', card).innerHTML = data.arms.map((arm) => {
    const band = 1.28 * Math.sqrt(arm.x), low = Math.max(arm.x - band, 0), high = arm.x + band;
    return `<div class="tbar${arm.x === leader && !tied ? ' lead' : ''}"><div class="tl2"><span>${esc(arm.k)} · ${esc(arm.l)}</span><b>${formatNumber(arm.x)}<small>${esc(data.unit)}</small></b></div><div class="trk"><i class="fill" style="width:${rounded(arm.x / top * 100)}%"></i><i class="band" style="left:${rounded(low / top * 100)}%;width:${rounded((high - low) / top * 100)}%"></i></div></div>`;
  }).join('');
  const result = data.presentation;
  let dial = '<svg viewBox="0 0 100 58" aria-hidden="true">';
  result.sureZones.forEach(([start, end, state], index) => {
    dial += `<path d="${arc(angle(start, 0, 100) - (index ? 0.035 : 0), angle(end, 0, 100) + (index < result.sureZones.length - 1 ? 0.035 : 0))}" fill="none" stroke="${colour[state]}" stroke-width="7" stroke-linecap="round" opacity="${state === 'info' ? 0.45 : 0.9}"/>`;
  });
  const [x1, y1] = point(angle(result.sure, 0, 100), 31), [x2, y2] = point(angle(result.sure, 0, 100), 39);
  dial += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--ink)" stroke-width="3" stroke-linecap="round"/><text x="50" y="44" text-anchor="middle" font-size="22" font-weight="700" fill="var(--ink)" font-family="var(--disp)">${result.sure}%</text><text x="50" y="55" text-anchor="middle" font-size="7.5" fill="var(--muted)">${esc(result.sureLabel)}</text></svg>`;
  get('[data-sure]', card).innerHTML = `${dial}<div class="tstrip" title="${esc(result.stripLabel)}">${data.strip.map((value) => `<i class="${value === 'A' ? 'a' : value === 'B' ? 'b' : ''}">${esc(value)}</i>`).join('')}<i>·</i><i>·</i></div><span class="tcap">${esc(result.sureCaption)}</span>`;
  card.dataset.state = result.state;
  const badge = get('[data-tchip]', card);
  badge.className = `chip ${result.state}`;
  badge.textContent = result.chipText;
  get('[data-say]', card).innerHTML = card.closest('#tests') ? 'Grey until 95% on two mornings · Rates unavailable' : `${esc(result.say)}<small>${esc(result.small)}</small>`;
  get('[data-prog]', card).textContent = result.progress;
  const call = card.querySelector<HTMLButtonElement>('[data-call]');
  if (call) call.disabled = true;
}

interface Tally { good: number; warn: number; alarm: number; decide: number; info: number }
const emptyTally = (): Tally => ({ good: 0, warn: 0, alarm: 0, decide: 0, info: 0 });
const radarTargets = new Map<string, HTMLElement>();
function radarGroup(element: HTMLElement): string | undefined {
  const panel = element.closest<HTMLElement>('[data-panel]')?.dataset.panel ?? '';
  const icon = element.querySelector('.src use')?.getAttribute('href')?.slice(1) ?? '';
  return element.dataset.g || sourceGroups[element.dataset.src ?? ''] || iconGroups[icon] || panelGroups[panel];
}
document.addEventListener('pulse:decisions-rendered',()=>renderHealth());
function renderHealth(): void {
  const total = emptyTally(), byGroup: Record<string, Tally> = {};
  const gauges: Record<string, HTMLElement[]> = {};
  radarTargets.clear();
  all('.tile[data-state],.dcard[data-state],.tcard[data-state],#deck [data-state]').forEach((element) => {
    const state = element.dataset.state ?? '';
    if (!(state in total)) return;
    const group = radarGroup(element);
    if (group && group !== 'hero' && element.matches('.tile') && details.has(element)
      && !(element.hidden && (element.dataset.k === 'ukcpo' || element.dataset.k === 'uscpo'))) {
      (gauges[group] ??= []).push(element);
    }
    if (snapshot.shopify && element.dataset.mode === 'sample' && !element.hasAttribute('data-ingested-shopify') && !element.closest('#deck') && !element.closest('#hero')) return;
    total[state as keyof Tally] += 1;
    if (!group || group === 'hero' || element.dataset.mode !== 'live' || !element.matches('.tile')) return;
    byGroup[group] ??= emptyTally();
    byGroup[group][state as keyof Tally] += 1;
  });
  const areas: DropArea[] = groups.map(([key, name]) => {
    const candidates = gauges[key] ?? [], live = candidates.filter(element => element.dataset.mode === 'live');
    const weakest = weakestRadarGauge(live, element => element.dataset.state ?? '')
      ?? weakestRadarGauge(candidates, element => element.dataset.state ?? '') ?? live[0] ?? candidates[0];
    const measure = radarMeasure(key, byGroup[key] ? { ...byGroup[key], reason: weakest ? details.get(weakest)?.detail.why : undefined } : undefined, snapshot.adSources);
    if (weakest) {
      weakest.id ||= `radar-gauge-${key}-${weakest.dataset.modelId ?? weakest.dataset.k ?? candidates.indexOf(weakest)}`;
      radarTargets.set(key, weakest);
    }
    return { key, name, measure, alarms: byGroup[key]?.alarm ?? 0, title: weakest ? details.get(weakest)?.title ?? measure.label : measure.label, ...(weakest ? { target: weakest.id } : {}) };
  });
  const { health } = radarSummary(areas), healthLabel = health === null ? 'Not enough data' : `${formatNumber(health)} health`;
  const rows = all('#deck [data-state]'), alarmCount = rows.filter((row) => row.dataset.state === 'alarm').length, decisions = rows.filter((row) => row.dataset.state === 'decide').length;
  const reviewCount = snapshot.reviews?.rows.length ?? 0;
  get('#counts').innerHTML = `<span class="pk health">${health === null ? healthLabel : `<b>${formatNumber(health)}</b> health`}</span>` + ([['alarm', alarmCount, alarmCount === 1 ? 'alarm' : 'alarms'], ['decide', decisions, decisions === 1 ? 'decision' : 'decisions'], ['warn', total.warn, 'to watch'], ['good', total.good, 'good']] as const).map(([state, count, label]) => `<span class="pk" style="--c:${colour[state]}"><i>${states[state][1]}</i><b>${formatNumber(count)}</b> ${label}</span>`).join('') + `<button class="pk" type="button" data-rv style="--c:var(--decide)"><i>★</i>${reviewCount ? `<b>${formatNumber(reviewCount)}</b> ${snapshot.reviews?.mode === 'sample' ? 'sample ' : 'new '}${reviewCount === 1 ? 'review' : 'reviews'}` : esc(snapshot.reviews ? reviewsGreeting(snapshot.reviews) : 'All caught up')}</button>`;
  get('#subrv').textContent = snapshot.reviews ? ` ${reviewsGreeting(snapshot.reviews)}.` : '';
  get('#deckcount').textContent = `${formatNumber(alarmCount)} ${alarmCount === 1 ? 'alarm' : 'alarms'} · ${formatNumber(decisions)} ${decisions === 1 ? 'decision' : 'decisions'}`;
  const html = dropsHtml(areas), drops = get('#drops');
  if (drops.dataset.content !== html) { drops.innerHTML = html; drops.dataset.content = html; }
}

function miniChart(detail: Detail, dial?: SheetDetail['dial']): string {
  const values = detail.hist;
  if (!values?.length) return '';
  const format = formatLike(detail.hp ? `${detail.hp}0` : detail.hs ? `0${detail.hs}` : dial?.t ?? '');
  const lines = dial?.z.slice(1).flatMap((zone, index) => (rank[dial.z[index]![2]] >= 2) !== (rank[zone[2]] >= 2) ? [zone[0]] : []) ?? [];
  const gap = values.length > 14 ? 2 : 6, width = (320 - gap * (values.length - 1)) / values.length;
  const high = Math.max(...values, ...lines, 1) * 1.08;
  const y = (value: number): number => 16 + 66 * (1 - Math.max(0, value) / high);
  let svg = `<svg viewBox="0 0 320 96" role="img" aria-label="${esc(detail.ha ?? 'Sample history')}">`;
  values.forEach((value, index) => {
    const fill = dial ? colour[zoneOf(value, dial.z)] : index === values.length - 1 ? 'var(--spark)' : 'var(--line-2)';
    const top = Math.min(y(value), 80), marker = detail.hm?.[index];
    svg += `<rect x="${rounded(index * (width + gap))}" y="${rounded(top)}" width="${rounded(width)}" height="${rounded(82 - top)}" rx="${rounded(Math.min(4, width / 2))}" fill="${fill}" fill-opacity="${dial && index < values.length - 1 ? 0.55 : 1}"${marker ? ' class="spike" stroke="var(--accent)" stroke-width="1"' : ''}>${marker ? `<title>${esc(marker)}</title>` : ''}</rect>`;
  });
  lines.forEach((bar) => { svg += `<line x1="0" x2="320" y1="${rounded(y(bar))}" y2="${rounded(y(bar))}" stroke="var(--muted)" stroke-width="1" stroke-dasharray="4 4"/><text x="320" y="${rounded(y(bar) - 3)}" text-anchor="end" font-size="10" fill="var(--muted)">bar ${esc(format(bar))}</text>`; });
  const narrow = width < 24;
  const labels = detail.hl ?? ['Earlier', 'Latest sample'];
  svg += `<text x="${rounded(narrow ? 0 : width / 2)}" y="${rounded(y(values[0]!) - 4)}" text-anchor="${narrow ? 'start' : 'middle'}" font-size="10" fill="var(--ink-2)">${esc(format(values[0]!))}</text><text x="${rounded(narrow ? 320 : 320 - width / 2)}" y="${rounded(y(values.at(-1)!) - 4)}" text-anchor="${narrow ? 'end' : 'middle'}" font-size="10" font-weight="700" fill="var(--ink)">${esc(format(values.at(-1)!))}</text><text x="0" y="96" font-size="9.5" fill="var(--muted)">${esc(labels[0])}</text><text x="320" y="96" text-anchor="end" font-size="9.5" fill="var(--muted)">${esc(labels[1])}</text></svg>`;
  return svg;
}

function showDetail(element: HTMLElement, reopen = true): void {
  const reviewId = element.dataset.reviewOpen;
  if (reviewId && snapshot.reviews) {
    const review = snapshot.reviews.rows.find(row => row.id === reviewId);
    openDetail = element; openTemplateId = undefined;
    get('#sh-title').textContent = review ? `${review.rating}★ · ${review.productTitle}` : 'Review no longer waiting';
    get('#sh-dot').className = `dot ${review && review.rating <= 3 ? 'warn' : 'decide'}`;
    get('#sh-dot').textContent = review && review.rating <= 3 ? '△' : '◆';
    get('#sh-dl').hidden = true;
    get('#sh-chart').replaceChildren();
    get('#sh-extra').innerHTML = review ? reviewSheetHtml(review, snapshot.reviews) : '<p>This review is no longer waiting in Judge.me.</p>';
    get('#sh-src').textContent = `Judge.me · ${snapshot.reviews.mode === 'sample' ? 'sample data' : 'live'}`;
    const sheet = get<HTMLDialogElement>('#sheet');
    if (reopen && !sheet.open) sheet.showModal();
    return;
  }
  const market = element.dataset.seriesMarket;
  if (market === 'UK' || market === 'US') { showSeriesPaceDetail(element, market, reopen); return; }
  const data = details.get(element);
  if (!data) return;
  openDetail = element; openTemplateId = undefined;
  const sheet = get<HTMLDialogElement>('#sheet');
  get('#sh-title').textContent = data.title;
  get('#sh-dot').className = `dot ${data.state}`;
  get('#sh-dot').textContent = states[data.state][1];
  get('#sh-dl').hidden = false;
  get('#sh-why').textContent = data.detail.why;
  get('#sh-rule').textContent = data.detail.rule;
  get('#sh-src').textContent = `${data.detail.src} · ${data.mode === 'sample' ? 'sample data' : 'live'}`;
  get('#sh-chart').innerHTML = miniChart(data.detail, data.dial);
  if (element.matches('#hero [data-k="orders"]') && activeHero().business) {
    const rows = activeHero().business!.orderDays;
    const high = Math.max(1, ...rows.map(r => r.total));
    const colors = { UK: '--good', US: '--info', EU: '--warn', TikTok: '--decide', unknown: '--muted' };
    get('#sh-chart').innerHTML = `<div class="orders-bars" role="img" aria-label="Orders by UK day, UK, US, EU and TikTok separately. Spike days are marked in the chart above.">${rows.map(r => `<span title="${esc(r.day)}: UK ${formatNumber(r.UK)}, US ${formatNumber(r.US)}, EU ${formatNumber(r.EU)}, TikTok ${formatNumber(r.TikTok)}, unknown ${formatNumber(r.unknown)}, total ${formatNumber(r.total)}" class="order-bar">${Object.entries(colors).map(([k, c]) => `<i style="height:${40 * r[k as keyof typeof colors] / high}px;background:var(${c})"></i>`).join('')}${r.detailAvailable ? '' : `<i style="height:${40*r.total/high}px;background:var(--muted)"></i>`}</span>`).join('')}</div><p class="note">UK · US · EU · TikTok · unknown. TikTok is counted once. ${rows.length > 31 ? 'Scroll for every UK day.' : ''}</p>` + miniChart(data.detail, data.dial);
  }
  get('#sh-extra').innerHTML = data.detail.extra?.length ? `<dl class="xdl">${data.detail.extra.map(([key, value]) => `<dt>${esc(key)}</dt><dd>${esc(value)}</dd>`).join('')}</dl>` : '';
  if (reopen && !sheet.open) sheet.showModal();
}

function showTemplate(id: string, title: string, reopen = true): void {
  openTemplateId = id; openDetail = undefined;
  get('#sh-title').textContent = title;
  get('#sh-dot').className = 'dot info'; get('#sh-dot').textContent = 'i';
  get('#sh-dl').hidden = true; get('#sh-chart').replaceChildren();
  get('#sh-extra').replaceChildren(get<HTMLTemplateElement>(id).content.cloneNode(true));
  const sheet = get<HTMLDialogElement>('#sheet');
  if (reopen && !sheet.open) sheet.showModal();
}

function selectDeck(deck: string): void {
  selectedDeck = deck;
  all('.tab[data-tab]').forEach((element) => element.setAttribute('aria-selected', String(element.dataset.tab === deck)));
  all('[data-panel]').forEach((element) => { element.hidden = element.dataset.panel !== deck; });
  history.replaceState(null, '', `#${deck}`);
}
const sampleOpenBeforeSearch=new Map<HTMLDetailsElement,boolean>();
function filterDials(): void {
  const query = get<HTMLInputElement>('#q').value.trim().toLowerCase();
  const tiles = all('[data-panel] .tile');
  if (!query) {
    for(const [group,open] of sampleOpenBeforeSearch)if(group.isConnected)group.open=open;
    sampleOpenBeforeSearch.clear();
    tiles.forEach((tile) => { tile.hidden = !!tile.dataset.marketOnly && selectedMarket !== 'all' && tile.dataset.marketOnly !== selectedMarket; });
    selectDeck(selectedDeck);
    get('#dialcount').textContent = 'Tap any dial for the detail';
    return;
  }
  all('[data-panel]').forEach((panel) => { panel.hidden = false; });
  let matches = 0;
  tiles.forEach((tile) => { tile.hidden = (!!tile.dataset.marketOnly && selectedMarket !== 'all' && tile.dataset.marketOnly !== selectedMarket) || !tile.textContent?.toLowerCase().includes(query); if (!tile.hidden) matches += 1; });
  all<HTMLDetailsElement>('.sample-dials').forEach(group=>{if(!sampleOpenBeforeSearch.has(group))sampleOpenBeforeSearch.set(group,group.open);group.open=all('.tile',group).some(tile=>!tile.hidden);});
  all('.tab[data-tab]').forEach((tab) => tab.setAttribute('aria-selected', 'false'));
  get('#dialcount').textContent = `${formatNumber(matches)} ${matches === 1 ? 'dial' : 'dials'} match “${get<HTMLInputElement>('#q').value.trim()}”`;
}

function updateSnapshot(next: DashboardSnapshot, initial = false): void {
  snapshot = next;
  if(snapshot.adSets)updateAdSets(snapshot.adSets,selectedMarket);
  if (snapshot.creatives) updateCreativeSnapshot(snapshot.creatives);
  if (snapshot.reviews) get('#reviews').innerHTML = reviewsPanelHtml(snapshot.reviews);
  for (const root of [document, ...all<HTMLTemplateElement>('template').map((template) => template.content)]) {
    all('[data-sample-text]', root).forEach((element) => {
      const sample = snapshot.textValues[element.dataset.sampleText ?? ''];
      if (sample) element.textContent = sample.value;
    });
    all('[data-sample-attributes]', root).forEach((element) => {
      const attributes = JSON.parse(element.dataset.sampleAttributes ?? '{}') as Record<string, string>;
      for (const [attribute, key] of Object.entries(attributes)) {
        const sample = snapshot.textValues[key];
        if (sample) element.setAttribute(attribute, sample.value);
      }
    });
    all<HTMLButtonElement>('[data-unbuilt]', root).forEach((button) => {
      button.textContent = button.getAttribute('aria-label')?.replace(/ · Not built yet$/, '') ?? '';
    });
  }
  all('[data-model-id]').forEach((element) => {
    const widget = snapshot.widgets[element.dataset.modelId ?? ''];
    if (!widget) return;
    element.dataset.mode = widget.mode;
    element.dataset.source = widget.source.join(' ');
    if (element.hasAttribute('data-ingested-shopify')) element.querySelector('.sample-label')?.remove();
    if (element.hasAttribute('data-ingested-shopify') && element.dataset.src !== 'stock') element.dataset.src = 'shopify';
    element.setAttribute(`data-${widget.kind}`, JSON.stringify(widget.value));
    if (widget.kind === 'series-pace') renderSeriesPace(element, widget.value, widget.mode);
    else if (widget.kind === 'dial') renderDial(element, widget.markets?.[selectedMarket] ?? widget.value, widget.mode);
    else if (widget.kind === 'ring') renderRing(element, widget.value, widget.mode);
    else if (widget.kind === 'test') renderTest(element, widget.value);
    else if (widget.kind === 'sheet') {
      const data: SheetModel = widget.value;
      details.set(element, { state: data.state, title: data.title, detail: data, mode: widget.mode });
    } else if (widget.kind === 'detail') {
      const state = element.hasAttribute('data-ingested-shopify') ? 'info' : (element.dataset.state ?? 'info') as State;
      element.dataset.state = state;
      details.set(element, { state, title: element.querySelector('.sl')?.textContent ?? '', detail: widget.value, mode: widget.mode });
      statChip(element, state);
    }
  });
  if (snapshot.shopify) {

    if (snapshot.fulfilment) { get('#fulfilment-glance').innerHTML = glance(snapshot.fulfilment); }
    get('[data-sp="live"]').innerHTML = liveHtml(snapshot.shopify);
    get('#shopify-panels').innerHTML = storePanelsHtml(snapshot.shopify);
    all('[data-custom-detail]').forEach(element => details.set(element, { state: 'info', title: element.querySelector('.sl')?.textContent ?? '', detail: JSON.parse(element.dataset.customDetail!) as Detail, mode: snapshot.shopify!.mode }));
    all('.tile[data-mode="sample"]').filter(e => !e.closest('#hero')).forEach(element => { if (!element.querySelector('.sample-label')) element.insertAdjacentHTML('beforeend', '<small class="sample-label">Sample data</small>'); });
  }
  updateGreeting();
  for (const [id, count, label] of [
    ['source-health-count', snapshot.shopify?.checks.filter(check => check.status === 'tripped').length ?? 0, 'failing checks'],
    ['settings-count', snapshot.metaCampaigns?.unconfirmedCount ?? 0, 'campaigns to confirm'],
  ] as const) {
    const badge = get(`#${id}`);
    badge.textContent = formatNumber(count); badge.hidden = count === 0;
    badge.setAttribute('aria-label', `${formatNumber(count)} ${label}`);
  }
  all('.tile[data-src]').forEach(watermark);
  all('.spark[data-spark]').forEach((element) => renderSpark(element, (element.dataset.spark ?? '').split(',').map(Number)));
  all('#reviews .stars').forEach((element) => {
    const rating = Number(element.dataset.stars);
    element.setAttribute('role', 'img'); element.setAttribute('aria-label', `${rating} out of 5 stars`);
    element.innerHTML = [1, 2, 3, 4, 5].map((star) => `<svg class="${star <= rating ? 'on' : 'off'}" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-star"/></svg>`).join('');
  });
  renderHero(activeHero(), initial);
  all('#tabs .tab[data-tab]').forEach((tab) => {
    const panel = document.querySelector<HTMLElement>(`[data-panel="${tab.dataset.tab}"]`);
    if (!panel) return;
    const worst = all('.tile[data-state]', panel).reduce<State>((previous, tile) => rank[(tile.dataset.state ?? 'info') as State] > rank[previous] ? tile.dataset.state as State : previous, 'info');
    const dot = get('.dot', tab); dot.className = `dot ${worst}`; dot.textContent = states[worst][1];
  });
  filterDials();
  const connectionStatus=document.querySelector<HTMLElement>('#connection-status');
  if(connectionStatus)connectionStatus.innerHTML=footerChipHtml(snapshot.sourceHealth);
  arrangeHomeDials(document);
  setDecisions({shopify:snapshot.shopify,amberDials:all('#dials .tile[data-state=warn][data-mode=live]').length});
  document.documentElement.dataset.updatedAt = snapshot.generatedAt;
  get('#update-status').textContent = `Updated ${new Date(snapshot.generatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/London' })}`;
  if (get<HTMLDialogElement>('#sheet').open) {
    const scroll = get('#sheet').scrollTop;
    if (openDetail) showDetail(openDetail, false);
    else if (openTemplateId) showTemplate(openTemplateId, get('#sh-title').textContent ?? '', false);
    get('#sheet').scrollTop = scroll;
  }
}

function updateGreeting(): void {
  get('#greeting').textContent = greetingAt(new Date());
}
setInterval(updateGreeting, 60_000);

function connectUpdates(): void {
  if (stream && stream.readyState !== EventSource.CLOSED) return;
  const connection = new EventSource('/api/events');
  stream = connection;
  connection.addEventListener('dashboard', (event: MessageEvent<string>) => {
    try {
      const next = JSON.parse(event.data) as DashboardSnapshot;
      if (next.schemaVersion === 1 && next.mode === 'sample') updateSnapshot(next);
    } catch { get('#update-status').textContent = 'Could not refresh, showing the last data'; }
  });
  connection.addEventListener('error', () => { get('#update-status').textContent = 'Reconnecting · showing the last data'; });
  connection.addEventListener('signed-out', () => { connection.close(); window.location.assign('/login'); });
  connection.addEventListener('unavailable', () => { get('#update-status').textContent = 'Reconnecting · showing the last data'; });
}

async function refreshDashboard(signal: AbortSignal): Promise<void> {
  const picked = selectedPeriod === 'pick' && pickedHero
    ? { from: pickedHero.from, to: pickedHero.to, generation: rangeGeneration } : undefined;
  const read = async <T>(path: string): Promise<T> => {
    const response = await fetch(path, { signal, credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } });
    if (response.status === 401) { window.location.assign('/login'); throw new Error('Sign in to continue'); }
    if (!response.ok) throw new Error('Refresh unavailable');
    return await response.json() as T;
  };
  const next = await read<DashboardSnapshot>('/api/dashboard');
  if (next.schemaVersion !== 1 || next.mode !== 'sample') throw new Error('Refresh unavailable');
  const hero = picked
    ? await read<HeroPeriod>(`/api/hero?${new URLSearchParams({ from: picked.from, to: picked.to })}`) : undefined;
  if (hero && (hero.from !== picked!.from || hero.to !== picked!.to)) throw new Error('Refresh unavailable');
  signal.throwIfAborted();
  const previousSnapshot = snapshot, previousPicked = pickedHero;
  if (hero && selectedPeriod === 'pick' && rangeGeneration === picked!.generation
    && pickedHero?.from === picked!.from && pickedHero.to === picked!.to) pickedHero = hero;
  try { updateSnapshot(next); }
  catch (error) {
    pickedHero = previousPicked;
    updateSnapshot(previousSnapshot);
    throw error;
  }
  connectUpdates();
}

function boot(): void {
  updateSnapshot(JSON.parse(get('#dashboard-state').getAttribute('data-snapshot') ?? '{}') as DashboardSnapshot, true);
  get('#dashboard-state').remove();
  const dates = createDatePicker({ bounds: () => snapshot.bounds, selected: activeHero, apply: applyPickedRange, cancel: cancelRangeRequest });
  get('#q').addEventListener('input', filterDials);
  get('.hero-controls').addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const group = (event.target as Element).closest('[role=tablist]');
    if (!group) return;
    const tabs = all<HTMLButtonElement>('[role=tab]', group);
    const index = tabs.findIndex((tab) => tab === event.target);
    if (index < 0) return;
    event.preventDefault();
    tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]?.focus();
  });
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : undefined;
    if (!target) return;
    const drop = target.closest('[data-drop-key]');
    if (drop) {
      const gauge = radarTargets.get(drop.getAttribute('data-drop-key') ?? '');
      if (gauge) {
        get<HTMLInputElement>('#q').value = '';
        const panel = gauge.closest<HTMLElement>('[data-panel]')?.dataset.panel;
        if (panel) selectDeck(panel);
        filterDials();
        const samples = gauge.closest<HTMLDetailsElement>('details.sample-dials');
        if (samples) samples.open = true;
        scrollTo(gauge); gauge.focus({ preventScroll: true });
        all('.drop-highlight').forEach(element => element.classList.remove('drop-highlight'));
        gauge.classList.add('drop-highlight');
        setTimeout(() => gauge.classList.remove('drop-highlight'), 3000);
      } else location.href = '/sources';
      return;
    }
    const review = target.closest<HTMLElement>('[data-review-open]');
    if (review) { showDetail(review); return; }
    if (target.closest('[data-series-use-landing]')) { void saveSeriesTarget(''); return; }
    const element = target.closest<HTMLElement>('[data-series-market],.tile,.profit-line,.rt[data-sheet]');
    if (element && details.has(element)) { showDetail(element); return; }
    const market = target.closest<HTMLElement>('#market [data-market]')?.dataset.market;
    if (market === 'all' || market === 'uk' || market === 'us') { selectedMarket = market; const attribution=snapshot.widgets.w019; const tile=document.querySelector<HTMLElement>('[data-model-id="w019"]'); if(tile&&attribution?.kind==='dial')renderDial(tile,attribution.markets?.[selectedMarket]??attribution.value,attribution.mode); if(snapshot.adSets)updateAdSets(snapshot.adSets,selectedMarket); renderHero(activeHero()); filterDials(); return; }
    const period = target.closest<HTMLElement>('[data-period]')?.dataset.period;
    if (period === 'pick') { dates.open(); return; }
    if (period === 'today' || period === 'yday' || period === '7d' || period === '30d') { setPeriod(period); return; }
    const deck = target.closest<HTMLElement>('.tab[data-tab]')?.dataset.tab;
    if (deck) { get<HTMLInputElement>('#q').value = ''; selectDeck(deck); filterDials(); if(target.closest('#deck'))scrollTo(get('#dials')); return; }
    const scoreTab = target.closest<HTMLElement>('[data-st]')?.dataset.st;
    if (scoreTab) {
      all('[data-st]').forEach((tab) => tab.setAttribute('aria-selected', String(tab.dataset.st === scoreTab)));
      all('[data-sp]').forEach((panel) => { panel.hidden = panel.dataset.sp !== scoreTab; });
      return;
    }
    const nav = target.closest<HTMLElement>('[data-go]');
    if (nav) {
      const destination = document.getElementById(nav.dataset.go ?? '');
      if (destination) scrollTo(destination);
      all('[data-go]').forEach((item) => item.setAttribute('aria-current', String(item === nav)));
      return;
    }
    if (target.closest('[data-rv]')) { scrollTo(get('#reviews')); return; }
    const rowTitle = target.closest<HTMLElement>('.dcard .rt');
    if (rowTitle) {
      const expanded = rowTitle.getAttribute('aria-expanded') === 'true';
      rowTitle.setAttribute('aria-expanded', String(!expanded));
      const why = rowTitle.closest('.dcard')?.querySelector<HTMLElement>('.why');
      if (why) why.hidden = expanded;
    }
    const rowTarget = target.closest<HTMLElement>('[data-goto]')?.dataset.goto;
    if (rowTarget) {
      const row = document.querySelector<HTMLElement>(`.dcard[data-id="${rowTarget}"]`);
      if (row) scrollTo(row);
    }
  });
  get('#livesets').addEventListener('click', () => showTemplate('#t-livesets', 'Sample live sets, ours'));
  get('#alldates').addEventListener('click', () => showTemplate('#t-dates', 'Sample dates'));
  document.addEventListener('input', event => {
    const form = event.target instanceof Element ? event.target.closest<HTMLFormElement>('#series-target-form') : null;
    if (form) form.dataset.dirty = 'true';
  });
  document.addEventListener('submit', event => {
    if (!(event.target instanceof HTMLFormElement) || event.target.id !== 'series-target-form') return;
    event.preventDefault();
    if (event.target.reportValidity()) void saveSeriesTarget(get<HTMLInputElement>('#series-target-date', event.target).value);
  });
  const sheet = get<HTMLDialogElement>('#sheet');
  get('#sh-x').addEventListener('click', () => sheet.close());
  sheet.addEventListener('click', (event) => { if (event.target === sheet) sheet.close(); });
  connectUpdates();
  installPullToRefresh({ refresh: refreshDashboard, status: get('#update-status') });
  let hourlyResizePending = false;
  window.addEventListener('resize', () => {
    if (hourlyResizePending) return;
    hourlyResizePending = true;
    requestAnimationFrame(() => { hourlyResizePending = false; renderHourlyOrders(); });
  });
  window.addEventListener('pagehide', () => stream?.close(), { once: true });
  window.addEventListener('pageshow', (event) => { if (event.persisted) window.location.reload(); });
  document.documentElement.dataset.dashboardReady = 'true';
}

try { boot(); } catch { const status = document.getElementById('update-status'); if (status) status.textContent = 'Could not finish loading. Refresh to try again.'; }
