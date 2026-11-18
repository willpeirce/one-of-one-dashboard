import {ukToday} from '../hero-range.js';
import type {SourceMode} from '../sources.js';
import type {KitFacts, KitRow} from './model.js';
import {homeKits, kitCard, kitOrder} from './presentation.js';
import type {KitCardView, KitSheetOrder} from './presentation-types.js';

export const KIT_TIMELINE_TICK_LIMIT = 120;
export interface KitTimelineDate {
  date: string; label: string; position: number; outside: 'before' | 'after' | null;
}
export interface KitTimelineTick {date: string; label: string; year: string | null; position: number}
export interface KitTimeline {
  start: string; end: string; today: string; todayPosition: number; monthCount: number; compressed: boolean;
  ticks: KitTimelineTick[];
  kits: {id: string; name: string; launch: KitTimelineDate | null; brief: KitTimelineDate | null}[];
}
export interface KitOrderGroup {id: string; name: string; orders: KitSheetOrder[]}
export interface KitsPageView {
  mode: SourceMode; ready: boolean; summary: string | null; stale: boolean; notice: string | null;
  cards: KitCardView[]; timeline: KitTimeline | null;
  ordersReady: boolean; ordersNotice: string | null; orderGroups: KitOrderGroup[];
}

const monthIndex = (date: string): number => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
const monthDate = (index: number): string => `${String(Math.floor(index / 12)).padStart(4, '0')}-${String(index % 12 + 1).padStart(2, '0')}-01`;
const dayTime = (date: string): number => Date.parse(`${date}T00:00:00Z`);
function endOfMonth(date: string): string {
  const year = Number(date.slice(0, 4)), month = Number(date.slice(5, 7));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = month === 2 ? leap ? 29 : 28 : [4, 6, 9, 11].includes(month) ? 30 : 31;
  return `${date.slice(0, 7)}-${days}`;
}
const fullDateLabel = (date: string): string => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric',
}).format(new Date(`${date}T12:00:00Z`));

/** Calendar-day positions avoid daylight-saving shifts. Very distant targets never grow an unbounded tick list. */
export function kitTimeline(rows: readonly KitRow[], now: Date): KitTimeline {
  const [year, month, day] = ukToday(now).split('-'), today = `${year!.padStart(4, '0')}-${month}-${day}`;
  const start = `${today.slice(0, 7)}-01`;
  const last = rows.reduce((latest, row) => row.launchTarget && row.launchTarget > latest ? row.launchTarget : latest, start);
  const end = endOfMonth(last), from = dayTime(start), duration = dayTime(end) - from;
  const position = (date: string): number => Math.max(0, Math.min(100, (dayTime(date) - from) / duration * 100));
  const marker = (date: string | null): KitTimelineDate | null => date ? {date, label: fullDateLabel(date),
    position: position(date), outside: date < start ? 'before' : date > end ? 'after' : null} : null;
  const firstMonth = monthIndex(start), lastMonth = monthIndex(end), monthCount = lastMonth - firstMonth + 1;
  const stride = Math.max(1, Math.ceil((monthCount - 1) / (KIT_TIMELINE_TICK_LIMIT - 1)));
  const indexes: number[] = [];
  for (let index = firstMonth; index <= lastMonth; index += stride) indexes.push(index);
  if (indexes.at(-1) !== lastMonth) indexes.push(lastMonth);
  const ticks = indexes.map((index, offset): KitTimelineTick => {
    const date = monthDate(index), year = date.slice(0, 4), prior = offset > 0 ? monthDate(indexes[offset - 1]!).slice(0, 4) : null;
    return {date, label: new Intl.DateTimeFormat('en-GB', {timeZone: 'UTC', month: 'short'}).format(new Date(`${date}T12:00:00Z`)),
      year: year !== prior ? year : null, position: position(date)};
  });
  return {start, end, today, todayPosition: position(today), monthCount, compressed: stride > 1, ticks,
    kits: rows.map(row => ({id: row.id, name: row.name, launch: marker(row.launchTarget), brief: marker(row.briefDue)}))};
}

/** Kit groups follow the kits file, their order rows follow the orders file, and unmatched rows come last. */
export function kitOrderGroups(facts: KitFacts, now: Date): KitOrderGroup[] {
  const known = new Map<string, KitRow>();
  for (const kit of facts.kits.rows) {
    const name = kit.name.trim().toLowerCase();
    if (!known.has(name)) known.set(name, kit);
  }
  const groups = new Map<string, KitOrderGroup>([...known.values()].map(kit => [`kit:${kit.id}`, {id: `kit:${kit.id}`, name: kit.name, orders: []}]));
  for (const order of facts.orders.rows) {
    const kit = known.get(order.kit.trim().toLowerCase()), id = kit ? `kit:${kit.id}` : 'other';
    let group = groups.get(id);
    if (!group) {group = {id, name: kit?.name ?? 'Other', orders: []}; groups.set(id, group);}
    group.orders.push(kitOrder(order, now, true));
  }
  return [...groups.values()].filter(group => group.orders.length > 0);
}

/** The page and Home share their source boundary, summary and card projection. */
export function kitsPageView(facts: KitFacts, dashboardMode: SourceMode, now: Date): KitsPageView {
  const home = homeKits(facts, dashboardMode, now), suppressed = facts.mode === 'sample' && dashboardMode === 'live';
  const ordersReady = !suppressed && facts.orders.readAt !== null && !['missing', 'pending'].includes(facts.orders.status);
  return {mode: home.mode, ready: home.ready, summary: home.summary, stale: home.stale, notice: home.notice,
    cards: home.ready ? facts.kits.rows.map(row => kitCard(row, now)) : [],
    timeline: home.ready ? kitTimeline(facts.kits.rows, now) : null,
    ordersReady, ordersNotice: ordersReady && facts.orders.status === 'unavailable' ? '△ Last saved orders · source unavailable' : null,
    orderGroups: ordersReady ? kitOrderGroups({...facts, kits: {...facts.kits, rows: home.ready ? facts.kits.rows : []}}, now) : []};
}
