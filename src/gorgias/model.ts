import {addDays, ukToday} from '../hero-range.js';

export const GORGIAS_POLL_MS = 2 * 60_000;
export const GORGIAS_TAG_POLL_MS = 10 * 60_000;
export const GORGIAS_SAMPLE_NOW = '2032-04-07T12:00:00.000Z';

/** Only this minimized ticket shape crosses the source boundary or reaches storage. */
export interface GorgiasTicket {
  id: string;
  status: 'open' | 'closed';
  channel: string;
  tags: string[];
  inHandover: boolean;
  viewId: string | null;
  createdAt: string;
  updatedAt: string | null;
  lastCustomerMessageAt: string | null;
  customer: string;
  subject: string;
}
export interface GorgiasSelection {gorgiasHandoverViewId: string; gorgiasHandoverTag: string}
export const gorgiasPollMs = (selection: Pick<GorgiasSelection, 'gorgiasHandoverViewId'>): number =>
  selection.gorgiasHandoverViewId ? GORGIAS_POLL_MS : GORGIAS_TAG_POLL_MS;
export const gorgiasFreshMs = (selection: Pick<GorgiasSelection, 'gorgiasHandoverViewId'>): number => 3 * gorgiasPollMs(selection);
export interface GorgiasPollInput {
  viewId: string;
  tag: string;
  knownTickets: ReadonlyArray<Pick<GorgiasTicket, 'id' | 'status' | 'inHandover'>>;
  /** ISO instants: the start is Monday midnight in Europe/London. */
  weekStart: string;
  asOf: string;
}
export interface GorgiasPollResult {tickets: GorgiasTicket[]; closedThisWeek: number}
export interface GorgiasFacts {
  mode: 'sample' | 'live';
  status: 'sample' | 'pending' | 'live' | 'unavailable';
  domain: string;
  checkedAt: string | null;
  asOf: string;
  weekStart: string;
  openedThisWeek: number | null;
  /** Observed weekly high-water mark; the page labels this as "At least". */
  closedThisWeek: number | null;
  tickets: GorgiasTicket[];
}

export function normalizeGorgiasDomain(value: string): string | null {
  const domain = value.trim().toLowerCase();
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(domain) ? domain : null;
}
export function gorgiasTicketHref(domain: string, id: string): string | null {
  const normalized = normalizeGorgiasDomain(domain);
  return normalized && /^\d{1,25}$/.test(id) ? `https://${normalized}.gorgias.com/app/ticket/${id}` : null;
}
export function gorgiasWaitStartedAt(ticket: GorgiasTicket): string {
  return ticket.lastCustomerMessageAt ?? ticket.createdAt;
}
export function gorgiasWaitHours(ticket: GorgiasTicket, asOf: string | Date): number {
  const at = typeof asOf === 'string' ? Date.parse(asOf) : asOf.getTime();
  return Math.max(0, (at - Date.parse(gorgiasWaitStartedAt(ticket))) / 3_600_000);
}
export function gorgiasWaitLabel(hours: number): string {
  if (hours < 1) return '<1h';
  const whole = Math.floor(hours);
  return whole < 24 ? `${whole}h` : `${Math.floor(whole / 24)}d${whole % 24 ? ` ${whole % 24}h` : ''}`;
}
export function gorgiasOldestFirst(tickets: readonly GorgiasTicket[]): GorgiasTicket[] {
  return [...tickets].sort((a, b) => gorgiasWaitStartedAt(a).localeCompare(gorgiasWaitStartedAt(b))
    || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

const ukClock = new Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'});
export function gorgiasWeekStart(now: Date): string {
  const today = ukToday(now), weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const monday = addDays(today, -((weekday + 6) % 7)), target = Date.parse(`${monday}T00:00:00Z`);
  let at = target;
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = ukClock.formatToParts(at), part = (type: Intl.DateTimeFormatPartTypes) => parts.find(row => row.type === type)!.value;
    const local = Date.parse(`${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}Z`);
    if (local === target) break;
    at += target - local;
  }
  return new Date(at).toISOString();
}
