import {dayCount, ukToday} from '../hero-range.js';
import type {SourceMode} from '../sources.js';
import type {KitFacts, KitOrderRow, KitRow} from './model.js';
import {KIT_STEPS, type HomeKits, type KitCardView, type KitFoldedView, type KitMoveView, type KitSheet, type KitSheetOrder, type KitStatusView} from './presentation-types.js';

export function kitStatus(status: string, gate = 0): KitStatusView {
  const tag = status.trim().toLowerCase();
  if (tag.startsWith('live')) return {kind: 'live', label: 'On sale'};
  if (tag.startsWith('in flight')) return {kind: 'flight', label: KIT_STEPS[gate]!};
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
  return days < 0 ? '' : days === 0 ? 'Today' : days < 14 ? `${days} ${days === 1 ? 'day' : 'days'}` : `${Math.round(days / 7)} wks`;
}
const waitingDays = (since: string | null, today: string): number => since ? Math.max(0, dayCount(since, today) - 1) : 0;

/** A move says whether the owner has anything to do; supplier age is never attached to their own move. */
export function kitMove(row: KitRow, today: string): KitMoveView | null {
  if (!row.nextAction.trim()) return null;
  const yours = row.owner === 'Will', days = waitingDays(row.waitingSince, today);
  return {yours, label: yours ? row.nextAction.trimEnd().endsWith('?') ? '◆ Your call' : '◆ Your move' : '○ Nothing for you right now',
    action: row.nextAction, note: !yours && days > 0 ? `Waiting ${days} ${days === 1 ? 'day' : 'days'}` : row.moveNote || null};
}
export function kitStepAside(row: Pick<KitRow, 'gate' | 'nextDate'>): string {
  if (row.gate === KIT_STEPS.length - 1) return '';
  return row.nextDate || `Next: ${KIT_STEPS[row.gate + 1]!.toLowerCase()}`;
}
export function kitCard(row: KitRow, now: Date): KitCardView {
  const today = ukToday(now), status = kitStatus(row.status, row.gate);
  const sellout = status.kind === 'live' && row.selloutTarget && row.selloutTarget > today ? row.selloutTarget : null;
  const target = sellout || (row.launchTarget && row.launchTarget > today ? row.launchTarget : null);
  return {id: row.id, name: row.name, series: row.series, status, gate: row.gate,
    launch: target ? `${sellout ? 'left on sale' : 'to launch'}: ${row.launchLabel || kitDateLabel(target, today)}` : row.launchLabel || '',
    distance: kitLaunchDistance(target, today), stepAside: kitStepAside(row), move: kitMove(row, today)};
}
function foldedKit(row: KitRow, now: Date): KitFoldedView {
  return {id: row.id, name: row.name, status: kitStatus(row.status, row.gate), gate: row.gate,
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
    summary: `${active.length} on the go · ${planned} planned · ${updated ? 'updated' : 'checked'} ${checkedLabel(at, ukToday(now))}`,
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
    gate: row.gate, move: kitMove(row, today), nextDate: row.nextDate || null, milestone: row.milestone,
    waiting: row.owner !== 'Will' && row.with ? {days: row.waitingSince ? waitingDays(row.waitingSince, today) : null, with: row.with} : null,
    note: row.note, orders: facts.orders.rows.filter(order => order.kit.trim().toLowerCase() === name).map(order => kitOrder(order, now, options.suppliers)),
    ordersNotice: facts.orders.status === 'unavailable' ? '△ Last saved orders · source unavailable' : null};
}
