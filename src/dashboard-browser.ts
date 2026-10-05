import { checksHtml, liveHtml, needsHtml, storePanelsHtml } from './shopify/presentation.js';
import type { DashboardSnapshot, Detail, DialModel, HeroMetric, HeroPeriod, Period, RingModel, SheetModel, State, TestModel, Zone } from './dashboard-types.js';
import { createDatePicker } from './dashboard-dates.js';

const states: Record<State, [string, string]> = {
  good: ['Good', '✓'], warn: ['Watch', '!'], decide: ['Decide', '◆'], alarm: ['Alarm', '✕'],
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
function formatLike(text: string): (value: number) => string {
  const prefix = text.match(/^[^\d-]+/)?.[0] ?? '', suffix = text.match(/[^\d.,]+$/)?.[0] ?? '';
  return (value) => prefix + (Math.abs(value) >= 1000 ? value.toLocaleString('en-GB') : String(rounded(value))) + suffix;
}
function watermark(element: HTMLElement): void {
  const icon = icons[element.dataset.src ?? ''];
  if (icon && !element.querySelector('.wm')) element.insertAdjacentHTML('afterbegin', `<svg class="ic wm" aria-hidden="true"><use href="#${icon}"/></svg>`);
}

interface SheetDetail { state: State; title: string; detail: Detail; dial?: Pick<DialModel, 'min' | 'max' | 'z' | 't'> }
const details = new WeakMap<HTMLElement, SheetDetail>();
let selectedPeriod: Period | 'pick' = 'today';
let pickedHero: HeroPeriod | undefined;
let rangeRequest: AbortController | undefined;
let rangeGeneration = 0;
let selectedDeck = ['ads', 'store', 'growth', 'stock'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'ads';
let snapshot: DashboardSnapshot;
let openDetail: HTMLElement | undefined;
let openTemplateId: string | undefined;

function renderDial(element: HTMLElement, data: DialModel): void {
  const { v, min, max, z } = data, activeZone = zoneIndex(v, z), state = data.cap ?? zoneOf(v, z), format = data.t === 'No data' ? (value: number) => String(Math.round(value)) : formatLike(data.t);
  let svg = `<span class="well"><svg viewBox="0 0 100 64" aria-hidden="true"><path d="${arc(Math.PI, 0)}" fill="none" stroke="var(--line)" stroke-width="7"/>`;
  z.forEach(([start, end, status], index) => {
    const a = angle(start, min, max) - (index ? 0.035 : 0), b = angle(end, min, max) + (index < z.length - 1 ? 0.035 : 0);
    if (a > b) svg += `<path d="${arc(a, b)}" fill="none" stroke="${colour[data.cap === 'info' ? 'info' : status]}" stroke-width="7" stroke-opacity="${index === activeZone ? 1 : 0.28}"/>`;
  });
  const [x, y] = point(angle(v, min, max), 40);
  svg += `${data.t === 'No data' ? '' : `<circle cx="${x}" cy="${y}" r="5" fill="var(--ink)" stroke="var(--pointer-ring)" stroke-width="2.5"/>`}<text x="50" y="52" text-anchor="middle" font-family="var(--disp)" font-size="15" font-weight="700" fill="var(--ink)">${esc(data.t)}</text><text x="10" y="62" text-anchor="middle" font-size="7.5" fill="var(--muted)">${esc(format(min))}</text><text x="90" y="62" text-anchor="middle" font-size="7.5" fill="var(--muted)">${esc(format(max))}</text></svg></span>`;
  element.innerHTML = `${svg}<span class="dl">${esc(data.l)}</span><span class="ds">${esc(data.s)}</span>${chip(state)}`;
  element.dataset.state = state;
  element.setAttribute('aria-label', `${data.l}: ${data.t}, ${states[state][0]}`);
  details.set(element, { state, title: data.l, detail: data.d, dial: data });
  watermark(element);
}

function renderRing(element: HTMLElement, data: RingModel): void {
  const state = data.z ? zoneOf(data.v, data.z) : data.state ?? 'info', circumference = 2 * Math.PI * 40;
  element.innerHTML = `<span class="well"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="40" fill="none" stroke="var(--line)" stroke-width="8"/><circle cx="50" cy="50" r="40" fill="none" stroke="${colour[state]}" stroke-width="8" stroke-linecap="round" transform="rotate(-90 50 50)" stroke-dasharray="${rounded(clamp(data.v / data.max, 0, 1) * circumference)} ${rounded(circumference)}"/><text x="50" y="56" text-anchor="middle" font-family="var(--disp)" font-size="17" font-weight="700" fill="var(--ink)">${esc(data.t)}</text></svg></span><span class="dl">${esc(data.l)}</span><span class="ds">${esc(data.s)}</span>${chip(state)}`;
  element.dataset.state = state;
  element.setAttribute('aria-label', `${data.l}: ${data.t}, ${states[state][0]}`);
  details.set(element, { state, title: data.l, detail: data.d, ...(data.z ? { dial: { min: 0, max: data.max, z: data.z, t: data.t } } : {}) });
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

function statChip(element: HTMLElement, state: State): void {
  element.querySelector(':scope > .chip')?.remove();
  element.insertAdjacentHTML('beforeend', chip(state));
  watermark(element);
}

const animations = new WeakMap<HTMLElement, number>();
function metricNumber(element: HTMLElement, data: HeroMetric, animate: boolean): void {
  if (data.unavailable) { animations.set(element, (animations.get(element) ?? 0) + 1); element.textContent = 'No data'; return; }
  const show = (value: number): void => { element.textContent = (data.pre ?? '') + (data.dp ? value.toFixed(data.dp) : Math.round(value).toLocaleString('en-GB')) + (data.suf ?? ''); };
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
  return selectedPeriod === 'pick' && pickedHero ? pickedHero : snapshot.hero[selectedPeriod === 'pick' ? 'today' : selectedPeriod];
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
function renderHero(hero: HeroPeriod, animate = false): void {
  const period = selectedPeriod;
  all('#period [data-period]').forEach((element) => element.setAttribute('aria-selected', String(element.dataset.period === period)));
  get('#picklbl').textContent = period === 'pick' ? hero.short : 'Dates';
  get('#pickbtn').setAttribute('aria-label', period === 'pick' ? `Dates, showing ${hero.short}` : 'Pick a day or dates');
  get('#hero').dataset.from = hero.from; get('#hero').dataset.to = hero.to;
  get('#eyebrow').textContent = hero.eyebrow;
  get('#sub1').textContent = hero.sub1;
  for (const key of ['net', 'orders', 'cr', 'spend', 'roas', 'margin'] as const) {
    const element = get(`#hero .tile[data-k="${key}"]`), metric = hero[key];
    element.dataset.mode = metric.mode;
    if (metric.mode === 'live') element.querySelector('.sample-label')?.remove();
    get('.per', element).textContent = `${hero.per} · ${metric.unavailable ? 'unavailable' : metric.mode === 'live' ? 'live' : 'sample'}`;
    metricNumber(get('.sv', element), metric, animate);
    get('.ss', element).textContent = metric.ss;
    element.dataset.state = metric.state;
    element.dataset.detail = JSON.stringify(metric.d);
    statChip(element, metric.state);
    details.set(element, { state: metric.state, title: get('.sl', element).textContent ?? '', detail: metric.d });
    const spark = element.querySelector<HTMLElement>('.spark');
    if (spark) renderSpark(spark, hero.spark, metric.d);
  }
  for (const key of ['ukcpo', 'uscpo'] as const) {
    const element = get(`#hero [data-k="${key}"]`);
    element.dataset.dial = JSON.stringify(hero[key]);
    renderDial(element, hero[key]);
  }
  if (hero.business) for (const [kind, widgetId, valueKey, subKey] of [['email','w039','t0269','t0270'], ['refill','w037','t0266','t0267']] as const) {
    const model = hero.business[kind], element = document.querySelector<HTMLElement>(`[data-model-id="${widgetId}"]`);
    all(`[data-sample-text="${valueKey}"]`).forEach(e => { e.textContent = String(model.count); });
    all(`[data-sample-text="${subKey}"]`).forEach(e => { e.textContent = `${hero.from}–${hero.to} · Shopify ${hero.net.mode}`; });
    if (element) details.set(element, { state: 'info', title: kind === 'email' ? 'Email · Shopify' : 'Refill Pack', detail: model.detail });
  }
  renderHealth();
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
    return `<div class="tbar${arm.x === leader && !tied ? ' lead' : ''}"><div class="tl2"><span>${esc(arm.k)} · ${esc(arm.l)}</span><b>${arm.x}<small>${esc(data.unit)}</small></b></div><div class="trk"><i class="fill" style="width:${rounded(arm.x / top * 100)}%"></i><i class="band" style="left:${rounded(low / top * 100)}%;width:${rounded((high - low) / top * 100)}%"></i></div></div>`;
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
  get('[data-say]', card).innerHTML = `${esc(result.say)}<small>${esc(result.small)}</small>`;
  get('[data-prog]', card).textContent = result.progress;
  const call = card.querySelector<HTMLButtonElement>('[data-call]');
  if (call) call.disabled = true;
}

interface Tally { good: number; warn: number; alarm: number; decide: number; info: number }
const emptyTally = (): Tally => ({ good: 0, warn: 0, alarm: 0, decide: 0, info: 0 });
const score = (value: Tally): number => value.good + value.warn + value.alarm ? (value.good + 0.5 * value.warn) / (value.good + value.warn + value.alarm) : 1;
function renderHealth(): void {
  const total = emptyTally(), byGroup: Record<string, Tally> = {};
  all('.tile[data-state],.dcard[data-state],.tcard[data-state]').forEach((element) => {
    const state = element.dataset.state ?? '';
    if (!(state in total)) return;
    if (snapshot.shopify && element.dataset.mode === 'sample' && !element.hasAttribute('data-ingested-shopify') && !element.closest('#shopify-needs') && !element.closest('#hero')) return;
    total[state as keyof Tally] += 1;
    const panel = element.closest<HTMLElement>('[data-panel]')?.dataset.panel ?? '';
    const icon = element.querySelector('.src use')?.getAttribute('href')?.slice(1) ?? '';
    const group = element.dataset.g || panelGroups[panel] || iconGroups[icon];
    if (!group || group === 'hero') return;
    byGroup[group] ??= emptyTally();
    byGroup[group][state as keyof Tally] += 1;
  });
  const health = Math.round(100 * score(total));
  const rows = snapshot.shopify ? all('#shopify-needs .dcard[data-state]') : all('.dcard[data-state]'), alarmCount = rows.filter((row) => row.dataset.state === 'alarm').length, decisions = rows.filter((row) => row.dataset.state === 'decide').length;
  const reviewCount = all('#reviews .rv').length;
  get('#counts').innerHTML = `<span class="pk health"><b>${health}</b> health</span>` + ([['alarm', alarmCount, alarmCount === 1 ? 'alarm' : 'alarms'], ['decide', decisions, decisions === 1 ? 'decision' : 'decisions'], ['warn', total.warn, 'to watch'], ['good', total.good, 'good']] as const).map(([state, count, label]) => `<span class="pk" style="--c:${colour[state]}"><i>${states[state][1]}</i><b>${count}</b> ${label}</span>`).join('') + (reviewCount ? `<button class="pk" type="button" data-rv style="--c:var(--decide)"><i>★</i><b>${reviewCount}</b> ${snapshot.shopify ? 'sample ' : 'new '}${reviewCount === 1 ? 'review' : 'reviews'}</button>` : '');
  get('#rvcount').textContent = reviewCount ? `◆ ${reviewCount} waiting` : '✓ All caught up';
  get('#rvcount').className = `chip ${reviewCount ? 'decide' : 'good'}`;
  get('#subrv').textContent = reviewCount ? ` ${reviewCount} ${snapshot.shopify ? 'sample' : 'new'} ${reviewCount === 1 ? 'review' : 'reviews'} to check.` : '';
  get('#deckcount').textContent = `${alarmCount} ${alarmCount === 1 ? 'alarm' : 'alarms'} · ${decisions} ${decisions === 1 ? 'decision' : 'decisions'}`;
  const radarPoint = (index: number, radius: number): [number, number] => [rounded(160 + radius * Math.cos(-Math.PI / 2 + index * 2 * Math.PI / groups.length)), rounded(150 + radius * Math.sin(-Math.PI / 2 + index * 2 * Math.PI / groups.length))];
  const polygon = (points: [number, number][]): string => points.map((p) => p.join(',')).join(' ');
  let svg = '<svg viewBox="0 0 320 300" aria-hidden="true">';
  for (const scale of [0.25, 0.5, 0.75, 1]) svg += `<polygon points="${polygon(groups.map((_, index) => radarPoint(index, 108 * scale)))}" fill="none" stroke="var(--line)" stroke-width="1"/>`;
  groups.forEach((_, index) => { const [x, y] = radarPoint(index, 108); svg += `<line x1="160" y1="150" x2="${x}" y2="${y}" stroke="var(--line)" stroke-width="1"/>`; });
  svg += `<text x="160" y="172" text-anchor="middle" font-family="var(--disp)" font-size="64" font-weight="800" fill="var(--ink)" fill-opacity=".18">${health}</text><text x="160" y="190" text-anchor="middle" font-family="var(--disp)" font-size="11" font-weight="700" letter-spacing="1.5" fill="var(--ink)" fill-opacity=".45">HEALTH</text>`;
  const measured = (key: string) => { const g = byGroup[key]; return !!g && g.good + g.warn + g.alarm > 0; };
  const scores = groups.map(([key]) => measured(key) ? score(byGroup[key]!) : 0), points = groups.map((_, index) => radarPoint(index, 108 * scores[index]!));
  svg += `<polygon points="${polygon(points)}" fill="var(--accent)" fill-opacity=".28" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round"/>`;
  points.forEach(([x, y]) => { svg += `<circle cx="${x}" cy="${y}" r="4.5" fill="var(--accent)" stroke="var(--pointer-ring)" stroke-width="2"/>`; });
  const described: string[] = [];
  groups.forEach(([key, name], index) => {
    const [x, y] = radarPoint(index, 132), percent = Math.round(scores[index]! * 100);
    svg += `<text x="${x}" y="${y}" text-anchor="${Math.abs(x - 160) < 2 ? 'middle' : x > 160 ? 'start' : 'end'}" font-family="var(--disp)" font-size="13" font-weight="600" fill="var(--ink)">${name}<tspan x="${x}" dy="14" font-size="11" font-weight="500" fill="var(--muted)">${measured(key) ? percent + '%' : 'Unknown'}</tspan></text>`;
    described.push(`${name} ${measured(key) ? percent + '%' : 'unknown'}`);
  });
  get('#radar').innerHTML = `${svg}</svg>`;
  get('#radar').setAttribute('aria-label', `Shopify health ${health}. ${described.join(', ')}.`);
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
  get('#sh-src').textContent = `${data.detail.src}${/sample|live|Not built/.test(data.detail.src) ? '' : ' · sample data'}`;
  get('#sh-chart').innerHTML = miniChart(data.detail, data.dial);
  if (element.matches('#hero [data-k="orders"]') && activeHero().business) {
    const rows = activeHero().business!.orderDays;
    const high = Math.max(1, ...rows.map(r => r.total));
    const colors = { UK: '--good', US: '--info', EU: '--warn', TikTok: '--decide', unknown: '--muted' };
    get('#sh-chart').innerHTML = `<div class="orders-bars" role="img" aria-label="Orders by UK day, UK, US, EU and TikTok separately. Spike days are marked in the chart above.">${rows.map(r => `<span title="${esc(r.day)}: UK ${r.UK}, US ${r.US}, EU ${r.EU}, TikTok ${r.TikTok}, unknown ${r.unknown}, total ${r.total}" class="order-bar">${Object.entries(colors).map(([k, c]) => `<i style="height:${40 * r[k as keyof typeof colors] / high}px;background:var(${c})"></i>`).join('')}${r.detailAvailable ? '' : `<i style="height:${40*r.total/high}px;background:var(--muted)"></i>`}</span>`).join('')}</div><p class="note">UK · US · EU · TikTok · unknown. TikTok is counted once. ${rows.length > 31 ? 'Scroll for every UK day.' : ''}</p>` + miniChart(data.detail, data.dial);
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
function filterDials(): void {
  const query = get<HTMLInputElement>('#q').value.trim().toLowerCase();
  const tiles = all('[data-panel] .tile');
  if (!query) {
    tiles.forEach((tile) => { tile.hidden = false; });
    selectDeck(selectedDeck);
    get('#dialcount').textContent = 'Tap any dial for the detail';
    return;
  }
  all('[data-panel]').forEach((panel) => { panel.hidden = false; });
  let matches = 0;
  tiles.forEach((tile) => { tile.hidden = !tile.textContent?.toLowerCase().includes(query); if (!tile.hidden) matches += 1; });
  all('.tab[data-tab]').forEach((tab) => tab.setAttribute('aria-selected', 'false'));
  get('#dialcount').textContent = `${matches} ${matches === 1 ? 'dial' : 'dials'} match “${get<HTMLInputElement>('#q').value.trim()}”`;
}

function updateSnapshot(next: DashboardSnapshot, initial = false): void {
  snapshot = next;
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
    element.dataset[widget.kind] = JSON.stringify(widget.value);
    if (widget.kind === 'dial') renderDial(element, widget.value);
    else if (widget.kind === 'ring') renderRing(element, widget.value);
    else if (widget.kind === 'test') renderTest(element, widget.value);
    else if (widget.kind === 'sheet') {
      const data: SheetModel = widget.value;
      details.set(element, { state: data.state, title: data.title, detail: data });
    } else if (widget.kind === 'detail') {
      const state = element.hasAttribute('data-ingested-shopify') ? 'info' : (element.dataset.state ?? 'info') as State;
      element.dataset.state = state;
      details.set(element, { state, title: element.querySelector('.sl')?.textContent ?? '', detail: widget.value });
      statChip(element, state);
    }
  });
  if (snapshot.shopify) {
    get('#shopify-needs').innerHTML = needsHtml(snapshot.shopify);
    const watchdogsOpen = get('#shopify-checks details').hasAttribute('open');
    get('#shopify-checks').innerHTML = checksHtml(snapshot.shopify);
    if (watchdogsOpen) get('#shopify-checks details').setAttribute('open', '');
    get('[data-sp="live"]').innerHTML = liveHtml(snapshot.shopify);
    get('#shopify-panels').innerHTML = storePanelsHtml(snapshot.shopify);
    all('[data-custom-detail]').forEach(element => details.set(element, { state: 'info', title: element.querySelector('.sl')?.textContent ?? '', detail: JSON.parse(element.dataset.customDetail!) as Detail }));
    all('.tile[data-mode="sample"]').filter(e => !e.closest('#hero')).forEach(element => { if (!element.querySelector('.sample-label')) element.insertAdjacentHTML('beforeend', '<small class="sample-label">Sample data</small>'); });
    if (snapshot.banner) get('.sample-banner').textContent = snapshot.banner;
  }
  all('.tile[data-src]').forEach(watermark);
  all('.spark[data-spark]').forEach((element) => renderSpark(element, (element.dataset.spark ?? '').split(',').map(Number)));
  all('#reviews .stars').forEach((element) => {
    const rating = Number(element.dataset.stars);
    element.setAttribute('role', 'img'); element.setAttribute('aria-label', `${rating} out of 5 stars`);
    element.innerHTML = [1, 2, 3, 4, 5].map((star) => `<svg class="${star <= rating ? 'on' : 'off'}" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-star"/></svg>`).join('');
  });
  renderHero(activeHero(), initial);
  all('.tab[data-tab]').forEach((tab) => {
    const panel = document.querySelector<HTMLElement>(`[data-panel="${tab.dataset.tab}"]`);
    if (!panel) return;
    const worst = all('.tile[data-state]', panel).reduce<State>((previous, tile) => rank[(tile.dataset.state ?? 'info') as State] > rank[previous] ? tile.dataset.state as State : previous, 'info');
    const dot = get('.dot', tab); dot.className = `dot ${worst}`; dot.textContent = states[worst][1];
  });
  filterDials();
  const healthLabels = { waiting_for_keys: 'waiting for keys', not_implemented: 'client not built', healthy: 'connected', error: 'source unavailable' };
  get('#feeds').innerHTML = (snapshot.sourceHealth ?? []).map((row) => `<span><i style="background:var(--info)"></i>${esc(row.name)} · ${row.source === 'shopify' && row.status === 'not_implemented' ? 'first sync pending' : healthLabels[row.status]}</span>`).join('') + '<a href="/sources">Connection details</a>';
  document.documentElement.dataset.updatedAt = snapshot.generatedAt;
  get('#update-status').textContent = `Connected · updated ${new Date(snapshot.generatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/London' })} UK`;
  if (get<HTMLDialogElement>('#sheet').open) {
    const scroll = get('#sheet').scrollTop;
    if (openDetail) showDetail(openDetail, false);
    else if (openTemplateId) showTemplate(openTemplateId, get('#sh-title').textContent ?? '', false);
    get('#sheet').scrollTop = scroll;
  }
}

function boot(): void {
  updateSnapshot(JSON.parse(get('#dashboard-state').getAttribute('data-snapshot') ?? '{}') as DashboardSnapshot, true);
  get('#dashboard-state').remove();
  const dates = createDatePicker({ bounds: () => snapshot.bounds, selected: activeHero, apply: applyPickedRange, cancel: cancelRangeRequest });
  get('#q').addEventListener('input', filterDials);
  get('#period').addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const tabs = all<HTMLButtonElement>('#period [data-period]');
    const index = tabs.findIndex((tab) => tab === event.target);
    if (index < 0) return;
    event.preventDefault();
    tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]?.focus();
  });
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : undefined;
    if (!target) return;
    const element = target.closest<HTMLElement>('.tile,.rt[data-sheet]');
    if (element && details.has(element)) { showDetail(element); return; }
    const period = target.closest<HTMLElement>('[data-period]')?.dataset.period;
    if (period === 'pick') { dates.open(); return; }
    if (period === 'today' || period === 'yday' || period === '7d' || period === '30d') { setPeriod(period); return; }
    const deck = target.closest<HTMLElement>('.tab[data-tab]')?.dataset.tab;
    if (deck) { get<HTMLInputElement>('#q').value = ''; selectDeck(deck); filterDials(); return; }
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
  const sheet = get<HTMLDialogElement>('#sheet');
  get('#sh-x').addEventListener('click', () => sheet.close());
  sheet.addEventListener('click', (event) => { if (event.target === sheet) sheet.close(); });
  const stream = new EventSource('/api/events');
  stream.addEventListener('dashboard', (event: MessageEvent<string>) => {
    try {
      const next = JSON.parse(event.data) as DashboardSnapshot;
      if (next.schemaVersion === 1 && next.mode === 'sample') updateSnapshot(next);
    } catch { get('#update-status').textContent = 'Could not refresh · showing the last sample snapshot'; }
  });
  stream.addEventListener('error', () => { get('#update-status').textContent = 'Reconnecting · showing the last sample snapshot'; });
  stream.addEventListener('signed-out', () => { stream.close(); window.location.assign('/login'); });
  stream.addEventListener('unavailable', () => { get('#update-status').textContent = 'Reconnecting · showing the last sample snapshot'; });
  window.addEventListener('pagehide', () => stream.close(), { once: true });
  window.addEventListener('pageshow', (event) => { if (event.persisted) window.location.reload(); });
  document.documentElement.dataset.dashboardReady = 'true';
}

try { boot(); } catch { const status = document.getElementById('update-status'); if (status) status.textContent = 'Could not finish loading. Refresh to try again.'; }
