import {dayCount, ukToday} from '../hero-range.js';
import type {SourceMode} from '../sources.js';
import type {KitFacts, KitOrderRow, KitRow} from './model.js';
import {KIT_STEPS, type HomeKits, type KitCardView, type KitFoldedView, type KitSheet, type KitSheetOrder, type KitStatusView} from './presentation-types.js';

export function kitStatus(status: string): KitStatusView {
  const tag = status.trim().toLowerCase();
  if (tag.startsWith('live')) return {kind: 'live', label: 'Live'};
  if (tag.startsWith('in flight')) return {kind: 'flight', label: 'In flight'};
  if (tag.startsWith('planned')) return {kind: 'planned', label: 'Planned'};
  if (tag.startsWith('proposed')) return {kind: 'proposed', label: 'Proposed'};
  if (tag.startsWith('optional')) return {kind: 'optional', label: 'Optional'};
  return {kind: 'other', label: status || 'Unlabelled'};
}
export function kitDateLabel(date: string | null, today: string): string {
  if (!date) return '';
  return new Intl.DateTimeFormat('en-GB', {timeZone: 'UTC', day: 'numeric', month: 'short',
    ...(date.slice(0, 4) === today.slice(0, 4) ? {} : {year: 'numeric' as const})}).format(new Date(`${date}T12:00:00Z`));
}
export function kitLaunchDistance(date: string | null, today: string): string {
  if (!date) return '';
  const days = dayCount(today, date) - 1;
  return days < 0 ? '' : days < 14 ? `${days} ${days === 1 ? 'day' : 'days'}` : `${Math.round(days / 7)} wks`;
}
/** Excludes the starting day, includes today; at most six iterations even for very old dates. */
export function kitWorkingDays(since: string, today: string): number {
  const days = Math.max(0, dayCount(since, today) - 1), weeks = Math.floor(days / 7);
  const weekday = new Date(`${since}T12:00:00Z`).getUTCDay();
  let count = weeks * 5;
  for (let offset = 1; offset <= days % 7; offset++) {
    const next = (weekday + offset) % 7;
    if (next !== 0 && next !== 6) count++;
  }
  return count;
}
export function kitWaitingChip(row: KitRow, today: string): string | null {
  if (!row.with || !row.waitingSince || kitWorkingDays(row.waitingSince, today) < 3) return null;
  return `${Math.max(0, dayCount(row.waitingSince, today) - 1)}d waiting`;
}
export function kitStepAside(row: Pick<KitRow, 'gate' | 'milestone'>): string {
  if (row.gate === KIT_STEPS.length - 1) return '';
  return row.milestone && Array.from(row.milestone).length <= 28 ? row.milestone : `${KIT_STEPS[row.gate + 1]} next`;
}
export function kitCard(row: KitRow, now: Date): KitCardView {
  const today = ukToday(now);
  return {id: row.id, name: row.name, series: row.series, status: kitStatus(row.status), gate: row.gate,
    launch: row.launchLabel || kitDateLabel(row.launchTarget, today), distance: kitLaunchDistance(row.launchTarget, today),
    stepAside: kitStepAside(row), nextAction: row.nextAction, owner: row.owner, waiting: kitWaitingChip(row, today)};
}
function foldedKit(row: KitRow, now: Date): KitFoldedView {
  return {id: row.id, name: row.name, status: kitStatus(row.status), gate: row.gate,
    launchMonth: row.launchTarget ? new Intl.DateTimeFormat('en-GB', {timeZone: 'UTC', month: 'short', year: 'numeric'})
      .format(new Date(`${row.launchTarget}T12:00:00Z`)) : '', distance: kitLaunchDistance(row.launchTarget, ukToday(now))};
}
function checkedLabel(instant: string, today: string): string {
  const date = new Date(instant), day = ukToday(date);
  const time = new Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(date);
  const label = new Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/London', day: 'numeric', month: 'short',
    ...(day.split('-')[0] === today.slice(0, 4) ? {} : {year: 'numeric' as const})}).format(date);
  return day === today ? time : `${label} ${time}`;
}
export function homeKits(facts: KitFacts, dashboardMode: SourceMode, now: Date): HomeKits {
  const file = facts.kits, suppressed = facts.mode === 'sample' && dashboardMode === 'live';
  const ready = !suppressed && file.readAt !== null && file.status !== 'missing' && file.status !== 'pending';
  if (!ready) return {mode: facts.mode, ready: false, summary: null, stale: false, notice: null, cards: [], folded: []};
  const active = file.rows.filter(row => ['live', 'flight'].includes(kitStatus(row.status).kind));
  const cards = active.slice(0, 4), cardIds = new Set(cards.map(row => row.id));
  const planned = file.rows.length - active.length;
  const updated = file.updatedAt, at = updated || file.readAt!;
  const stale = updated !== null && now.getTime() - Date.parse(updated) > 36 * 60 * 60 * 1000;
  return {mode: facts.mode, ready: true,
    summary: `${active.length} active · ${planned} planned · ${updated ? 'updated' : 'checked'} ${checkedLabel(at, ukToday(now))}`,
    stale, notice: file.status === 'unavailable' ? '△ Last saved kits · source unavailable' : null,
    cards: cards.map(row => kitCard(row, now)), folded: file.rows.filter(row => !cardIds.has(row.id)).map(row => foldedKit(row, now))};
}
export function kitOrder(row: KitOrderRow, now: Date, suppliers = false): KitSheetOrder {
  const today = ukToday(now);
  return {id: row.id, item: row.item, quantity: row.qty === null ? null : row.qty.toLocaleString('en-GB'), status: row.status,
    date: row.date ? kitDateLabel(row.date, today) : null, eta: row.eta ? kitDateLabel(row.eta, today) : null,
    ...(suppliers ? {supplier: row.supplier} : {})};
}
export function kitSheet(facts: KitFacts, id: string, now: Date, options: {suppliers?: boolean} = {}): KitSheet | null {
  const row = facts.kits.rows.find(kit => kit.id === id);
  if (!row) return null;
  const today = ukToday(now), name = row.name.trim().toLowerCase();
  return {id: row.id, name: row.name, series: row.series, mode: facts.mode, launch: row.launchLabel || kitDateLabel(row.launchTarget, today),
    gate: row.gate, nextAction: row.nextAction, owner: row.owner, milestone: row.milestone,
    brief: row.briefDue ? kitDateLabel(row.briefDue, today) : null,
    waiting: row.with && row.waitingSince ? {days: Math.max(0, dayCount(row.waitingSince, today) - 1), with: row.with} : null,
    note: row.note, orders: facts.orders.rows.filter(order => order.kit.trim().toLowerCase() === name).map(order => kitOrder(order, now, options.suppliers)),
    ordersNotice: facts.orders.status === 'unavailable' ? '△ Last saved orders · source unavailable' : null};
}
