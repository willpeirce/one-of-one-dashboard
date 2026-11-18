import {addDays, ukToday} from '../hero-range.js';
import type {Estimate} from '../fulfilment/model.js';
import type {Settings} from '../settings.js';
import type {SourceMode} from '../sources.js';
import {costOrder, type ShopifyCost} from '../shopify/costs.js';
import type {Facts} from '../shopify/metrics.js';
import {isFreeOrder, isReplacementOrder, paidOrder, type Order} from '../shopify/model.js';

export type IssueCostFacts = Pick<Facts, 'mode' | 'records' | 'jobs'>;
export type IssueCostEstimate = Pick<Estimate, 'costPence' | 'source'> & {orderId: string};
export interface IssueCostMonth {
  month: string; orders: number | null; totalPence: number | null; knownPence: number | null;
  complete: boolean; historyComplete: boolean;
  actualFulfilmentOrders: number; estimatedFulfilmentOrders: number;
  unknownFulfilmentOrders: number; unknownLineCostOrders: number; unknownClassificationOrders: number; settingsCostOrders: number;
}
export interface IssueCosts {
  mode: SourceMode; status: 'sample' | 'live' | 'pending' | 'unavailable' | 'suppressed';
  checkedAt: string | null; current: IssueCostMonth; previous: IssueCostMonth;
}
const emptyMonth = (month: string): IssueCostMonth => ({month, orders: null, totalPence: null, knownPence: null,
  complete: false, historyComplete: false, actualFulfilmentOrders: 0, estimatedFulfilmentOrders: 0,
  unknownFulfilmentOrders: 0, unknownLineCostOrders: 0, unknownClassificationOrders: 0, settingsCostOrders: 0});
const knownMoney = (value: number | null | undefined): value is number => value != null && Number.isFinite(value) && value >= 0;

/** A paginated read's completion time is not its query's upper bound. */
function pollThrough(poll: IssueCostFacts['jobs'][number] | undefined, now: Date): number {
  if (!poll?.last_success_at || poll.state.continuing) return 0;
  const success = new Date(poll.last_success_at).getTime();
  if (!Number.isFinite(success) || success > now.getTime()) return 0;
  if (!Object.hasOwn(poll.state, 'query')) return success;
  if (typeof poll.state.query !== 'string') return 0;
  const match = /^updated_at:>=(\S+)\s+updated_at:<=(\S+)$/.exec(poll.state.query);
  if (!match) return 0;
  const bounds = match.slice(1).map(value => {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return NaN;
    const time = Date.parse(value), canonical = value.includes('.') ? value : value.replace('Z', '.000Z');
    return Number.isFinite(time) && new Date(time).toISOString() === canonical ? time : NaN;
  });
  return bounds.every(Number.isFinite) && bounds[0]! <= bounds[1]! ? bounds[1]! : 0;
}

/** Reuse the same observed goods costs and stored actual-or-estimated fulfilment as profit. */
export function buildIssueCosts(facts: IssueCostFacts, history: readonly ShopifyCost[], estimates: readonly IssueCostEstimate[],
  settings: Pick<Settings, 'startingCogs'>, now: Date, issuesMode: SourceMode = facts.mode): IssueCosts {
  const today = ukToday(now), first = `${today.slice(0, 7)}-01`, previousDay = addDays(first, -1);
  const current = emptyMonth(today.slice(0, 7)), previous = emptyMonth(previousDay.slice(0, 7));
  if (facts.mode === 'sample' && issuesMode === 'live') return {mode: 'sample', status: 'suppressed', checkedAt: null, current, previous};
  const backfill = facts.jobs.find(job => job.name === 'backfill'), poll = facts.jobs.find(job => job.name === 'poll');
  const successes = [poll?.last_success_at, backfill?.last_success_at].flatMap(value => {
    const time = value ? new Date(value).getTime() : NaN;
    return Number.isFinite(time) && time <= now.getTime() ? [time] : [];
  });
  const checkedAt = successes.length ? new Date(Math.max(...successes)).toISOString() : null;
  const unavailable = (poll?.failures ?? 0) > 0 || !backfill?.state.ordersDone && (backfill?.failures ?? 0) > 0;
  const status: IssueCosts['status'] = facts.mode === 'sample' ? 'sample' : unavailable ? 'unavailable'
    : !backfill?.state.ordersDone || !checkedAt || poll?.state.continuing ? 'pending' : 'live';
  const backfillUntil = backfill?.state.ordersDone && typeof backfill.state.until === 'string' ? Date.parse(backfill.state.until) : 0;
  const completedPoll = pollThrough(poll, now);
  const through = Math.max(Number.isFinite(backfillUntil) && backfillUntil <= now.getTime() ? backfillUntil : 0,
    completedPoll <= now.getTime() ? completedPoll : 0);
  const throughDay = through > 0 ? ukToday(new Date(through)) : '';
  const from = backfill?.state.ordersDone && typeof backfill.state.from === 'string' ? backfill.state.from : null;
  current.historyComplete = Boolean(from && from <= first && throughDay >= today && !poll?.state.continuing);
  previous.historyComplete = Boolean(from && from <= `${previous.month}-01` && throughDay >= first);
  const estimatesByOrder = new Map(estimates.map(row => [row.orderId, row])), seen = new Set<string>();
  for (const record of facts.records) {
    if (record.kind !== 'order') continue;
    const order = record.data as Order;
    if (seen.has(order.id) || !paidOrder(order)) continue;
    seen.add(order.id);
    const createdAt = Date.parse(order.createdAt);
    if (!Number.isFinite(createdAt) || createdAt > now.getTime()) continue;
    const month = ukToday(new Date(createdAt)).slice(0, 7), total = month === current.month ? current : month === previous.month ? previous : null;
    if (!total) continue;
    // Earlier stored orders are refreshed by the existing tag reader; absence is not a negative tag result.
    if (!Array.isArray(order.tags)) {total.unknownClassificationOrders++; continue;}
    if (!isFreeOrder(order) || !isReplacementOrder(order)) continue;
    total.orders = (total.orders ?? 0) + 1;
    const goods = costOrder(order, history, settings), fulfilment = estimatesByOrder.get(order.id);
    for (const line of goods.lines) if (knownMoney(line.costPence)) total.knownPence = (total.knownPence ?? 0) + line.costPence;
    if (!goods.lines.length || goods.lines.some(line => !knownMoney(line.costPence))) total.unknownLineCostOrders++;
    if (goods.sources.includes('settings')) total.settingsCostOrders++;
    if (!fulfilment || !knownMoney(fulfilment.costPence) || fulfilment.source === 'unknown') total.unknownFulfilmentOrders++;
    else {
      total.knownPence = (total.knownPence ?? 0) + fulfilment.costPence;
      if (fulfilment.source === 'actual') total.actualFulfilmentOrders++;
      else total.estimatedFulfilmentOrders++;
    }
  }
  for (const total of [current, previous]) {
    if (total.historyComplete && !total.unknownClassificationOrders) {
      total.orders ??= 0;
      if (total.orders === 0) total.knownPence = 0;
    }
    total.complete = total.historyComplete && status !== 'unavailable' && status !== 'pending'
      && total.unknownLineCostOrders === 0 && total.unknownFulfilmentOrders === 0 && total.unknownClassificationOrders === 0;
    total.totalPence = total.complete ? total.knownPence : null;
  }
  return {mode: facts.mode, status, checkedAt, current, previous};
}
