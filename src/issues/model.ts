import {ukToday} from '../hero-range.js';
import {gorgiasTicketHref} from '../gorgias/model.js';
import {scrubGorgiasText} from '../gorgias/privacy.js';
import type {SourceMode} from '../sources.js';
import type {DashboardNeed} from '../shopify/dashboard.js';
import {ISSUE_REASONS, type IssueReason, type IssueTagRule} from './taxonomy.js';
import {issueClassification} from './keywords.js';
import {classifyIssueTicket} from './intents.js';
import {issueWatchState} from './trend.js';
export {issueDoubled} from './trend.js';
export {ISSUE_REASONS, type IssueReason, type IssueTagRule} from './taxonomy.js';

export interface IssueReview {id: string; rating: number; body: string; createdAt: string}
export interface IssueTicket {id: string; subject: string; tags: string[]; createdAt: string; aiIntent?: string | null}
export interface IssueSource<T> {
  mode: SourceMode; status: 'ready' | 'pending' | 'unavailable'; rows: T[];
  checkedAt?: string | null; note?: string;
}
export interface IssueInputs {
  dashboardMode: SourceMode;
  reviews: IssueSource<IssueReview>;
  tickets: IssueSource<IssueTicket> & {domain: string; historyCoversLastMonth?: boolean};
}
export interface IssueCase {
  id: string; reason: IssueReason; month: string; createdAt: string; orderNumber: string | null;
  sources: ('judgeme' | 'gorgias')[]; quote: string | null; ticketHref: string | null; reference: string;
}
export interface IssueReasonRow {reason: IssueReason; current: number; previous: number; cases: IssueCase[]}
export interface IssuesView {
  mode: SourceMode; status: 'ready' | 'pending' | 'unavailable'; thisMonth: string; lastMonth: string;
  asOf: string; checkedAt: string | null; rows: IssueReasonRow[]; notes: string[]; ticketHistoryCoversLastMonth: boolean;
}
export function issueMonths(now: Date): {thisMonth: string; lastMonth: string} {
  const thisMonth = ukToday(now).slice(0, 7), year = Number(thisMonth.slice(0, 4)), month = Number(thisMonth.slice(5));
  return {thisMonth, lastMonth: `${String(month === 1 ? year - 1 : year).padStart(4, '0')}-${String(month === 1 ? 12 : month - 1).padStart(2, '0')}`};
}
/** Only one explicit order marker can support a join. Ambiguous or longer numbers never guess. */
export function issueOrderNumber(text: string): string | null {
  const matches = new Set(Array.from(text.matchAll(/(?<!#)#(\d{4,5})(?![\d\p{L}_]|[./-]\d)/gu), match => match[1]!));
  return matches.size === 1 ? [...matches][0]! : null;
}
interface Evidence {
  source: 'judgeme' | 'gorgias'; id: string; createdAt: string; orderNumber: string | null;
  reason: IssueReason; rank: 0 | 1 | 2; quote: string | null; ticketHref: string | null;
}
const sourceOrder = (source: Evidence['source']): number => source === 'judgeme' ? 0 : 1;
const evidenceOrder = (a: Evidence, b: Evidence): number => a.createdAt.localeCompare(b.createdAt)
  || sourceOrder(a.source) - sourceOrder(b.source) || a.id.localeCompare(b.id);
function evidence(input: IssueInputs, mode: SourceMode, tagRules: readonly IssueTagRule[], now: Date): {
  rows: Evidence[]; excludedThisMonth: number; excludedLastMonth: number;
} {
  const rows: Evidence[] = [], seen = new Set<string>();
  const {thisMonth, lastMonth} = issueMonths(now);
  let excludedThisMonth = 0, excludedLastMonth = 0;
  const take = (source: Evidence['source'], id: string, createdAt: string): string | null => {
    const key = `${source}:${id}`, time = Date.parse(createdAt);
    if (!id || seen.has(key) || !Number.isFinite(time) || time > now.getTime()) return null;
    seen.add(key); return new Date(time).toISOString();
  };
  if (input.reviews.mode === mode && input.reviews.status !== 'pending') for (const review of input.reviews.rows) {
    if (!Number.isInteger(review.rating) || review.rating < 1 || review.rating > 3) continue;
    const createdAt = take('judgeme', review.id, review.createdAt); if (!createdAt) continue;
    const text = scrubGorgiasText(review.body, [], Array.from(review.body).length), classified = issueClassification(text);
    rows.push({source: 'judgeme', id: review.id, createdAt, orderNumber: issueOrderNumber(text), reason: classified.reason, rank: 0,
      quote: Array.from(text).slice(0, 120).join('') || null, ticketHref: null});
  }
  if (input.tickets.mode === mode && input.tickets.status !== 'pending') for (const ticket of input.tickets.rows) {
    const createdAt = take('gorgias', ticket.id, ticket.createdAt); if (!createdAt) continue;
    const classified = classifyIssueTicket(ticket.subject, ticket.tags, ticket.aiIntent, tagRules);
    if (classified === null) {
      const month = ukToday(new Date(createdAt)).slice(0, 7);
      if (month === thisMonth) excludedThisMonth++;
      else if (month === lastMonth) excludedLastMonth++;
      continue;
    }
    rows.push({source: 'gorgias', id: ticket.id, createdAt, orderNumber: issueOrderNumber(ticket.subject), ...classified,
      quote: null, ticketHref: mode === 'live' ? gorgiasTicketHref(input.tickets.domain, ticket.id) : null});
  }
  return {rows: rows.sort(evidenceOrder), excludedThisMonth, excludedLastMonth};
}
export function buildIssuesView(input: IssueInputs, tagRules: readonly IssueTagRule[], now: Date): IssuesView {
  const mode: SourceMode = input.dashboardMode === 'live' || input.reviews.mode === 'live' || input.tickets.mode === 'live' ? 'live' : 'sample';
  const sources = [input.reviews, input.tickets].filter(source => source.mode === mode), completed = sources.some(source => source.status !== 'pending');
  const status = !completed ? 'pending' : sources.some(source => source.status !== 'ready') ? 'unavailable' : 'ready';
  const {thisMonth, lastMonth} = issueMonths(now), groups = new Map<string, Evidence[]>();
  const observed = evidence(input, mode, tagRules, now);
  for (const row of observed.rows) {
    const key = row.orderNumber ? `order:${row.orderNumber}` : `${row.source}:${row.id}`;
    const group = groups.get(key) ?? []; group.push(row); groups.set(key, group);
  }
  const cases: IssueCase[] = [];
  for (const [id, group] of groups) {
    const first = group[0]!, month = ukToday(new Date(first.createdAt)).slice(0, 7);
    if (month !== thisMonth && month !== lastMonth) continue;
    // Tag mapping outranks intent, then keywords. Chronological order resolves equal evidence.
    const picked = group.reduce((best, row) => row.rank > best.rank ? row : best, first);
    const quote = group.find(row => row.quote)?.quote ?? null, ticket = group.find(row => row.ticketHref);
    cases.push({id, reason: picked.reason, month, createdAt: first.createdAt, orderNumber: first.orderNumber,
      sources: [...new Set(group.map(row => row.source))], quote, ticketHref: ticket?.ticketHref ?? null,
      reference: first.orderNumber ? `Order #${first.orderNumber}` : `${first.source === 'judgeme' ? 'Review' : 'Ticket'} #${first.id}`});
  }
  cases.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  const notes = ['Counts cover stored observations, not a complete account history. Handover tickets are those observed in the selected view or tag.',
    'Each explicit order number counts once, in its earliest observed month. Without one unambiguous order number, each review or ticket counts once.'];
  if (observed.excludedThisMonth || observed.excludedLastMonth)
    notes.push(`${observed.excludedThisMonth} handover tickets this month and ${observed.excludedLastMonth} last month were questions or requests, not problems, and are left out.`);
  for (const [name, source] of [['Judge.me reviews', input.reviews], ['Gorgias handover', input.tickets]] as const) {
    if (source.mode !== mode) notes.push(`${name}: waiting for keys; sample cases are excluded.`);
    else if (source.status === 'pending') notes.push(`${name}: waiting for the first successful read.`);
    else if (source.status === 'unavailable') notes.push(`${name}: unavailable; last successful stored cases are shown.`);
    if (source.mode === mode && source.note) notes.push(`${name}: ${source.note}`);
  }
  if (mode === 'sample') notes.unshift('Sample data · invented cases and dates.');
  const checkedAt = sources.map(source => source.checkedAt).filter((at): at is string => !!at && Number.isFinite(Date.parse(at))).sort()[0] ?? null;
  const view: IssuesView = {mode, status, thisMonth, lastMonth, asOf: now.toISOString(), checkedAt, notes,
    ticketHistoryCoversLastMonth: input.tickets.mode === mode && input.tickets.historyCoversLastMonth === true,
    rows: ISSUE_REASONS.map(reason => ({reason, current: cases.filter(row => row.reason === reason && row.month === thisMonth).length,
      previous: cases.filter(row => row.reason === reason && row.month === lastMonth).length, cases: cases.filter(row => row.reason === reason)}))};
  if (mode === 'live' && view.rows.some(row => issueWatchState(row, view) === 'history'))
    notes.push('Watch needs involving handover tickets wait until stored ticket history covers the whole of last month.');
  return view;
}
export function issuesNeeds(view: IssuesView): DashboardNeed[] {
  if (view.mode !== 'live' || view.status !== 'ready') return [];
  return view.rows.filter(row => issueWatchState(row, view) === 'watch').map(row => ({
    id: `issues-${ISSUE_REASONS.indexOf(row.reason)}`, source: 'pulse', sourceMode: 'live', readScope: 'needs:issues', state: 'warn',
    title: `${row.reason[0]!.toUpperCase()}${row.reason.slice(1)} · ${row.current} this month`,
    why: `${row.current} observed cases this month against ${row.previous} last month. ${row.cases.filter(item => item.month === view.thisMonth).slice(0, 5).map(item => item.reference).join(' · ')}.`,
    link: '/handover', figure: {value: String(row.current), label: 'Observed cases this month'},
  }));
}
export function sampleIssuesView(now: Date): IssuesView {
  // A rebuild is not a new sample read: unchanged SSE snapshots must stay equal within the hour.
  const sampleNow = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
  const months = issueMonths(sampleNow), current = sampleNow.toISOString(), previous = `${months.lastMonth}-03T12:00:00Z`;
  return buildIssuesView({dashboardMode: 'sample', reviews: {mode: 'sample', status: 'ready', checkedAt: current, rows: [
    {id: '91001', rating: 2, body: 'The invented slab has a scratch. Order #41001.', createdAt: current},
    {id: '91002', rating: 3, body: 'The slab arrived scratched. Order #41002.', createdAt: current},
    {id: '91003', rating: 2, body: 'A scratched slab was in this invented kit. Order #41003.', createdAt: current},
    {id: '91004', rating: 2, body: 'The invented slab was scratched. Order #41004.', createdAt: previous},
    {id: '91005', rating: 3, body: 'The invented box arrived with a bent corner.', createdAt: current},
  ]}, tickets: {mode: 'sample', status: 'ready', checkedAt: current, domain: 'invented-helpdesk', historyCoversLastMonth: true, rows: [
    {id: '81001', subject: 'Scratched slab for order #41001', tags: [], aiIntent: 'Product::Quality Issues', createdAt: current},
    {id: '81002', subject: 'New invented message', tags: [], aiIntent: 'Order::Missing Item', createdAt: current},
    {id: '81003', subject: 'New invented question', tags: [], aiIntent: 'Product::Availability', createdAt: current},
  ]}}, [], sampleNow);
}
