import { ukToday } from '../hero-range.js';
import type { Check } from '../shopify/watchdogs.js';
import type { AlertCheckId } from './alert-types.js';
import type { PushPayload } from './sender.js';

export type KnownAlertStatus = 'pass' | 'tripped';
export interface AlertState {
  evaluationId: string;
  rawStatus: Check['status'];
  candidateStatus: KnownAlertStatus | null;
  candidateCount: number;
  confirmedStatus: KnownAlertStatus | null;
  revision: number;
  transitionQuiet: boolean;
}
export interface AlertQuietHours { start: string; end: string }
export const ALERT_MIN_INTERVAL_MS = 30 * 60_000;
const ukClock = new Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});
export function inAlertQuietHours(now: Date, hours: AlertQuietHours): boolean {
  const time = ukClock.format(now);
  return hours.start === hours.end ? false : hours.start < hours.end
    ? time >= hours.start && time < hours.end : time >= hours.start || time < hours.end;
}

/** Unknown interrupts a streak; repeated reads of one evaluation cannot confirm it. */
export function observeAlert(previous: AlertState | null, status: Check['status'], evaluationId: string, quiet: boolean): AlertState {
  const base: AlertState = previous ?? {evaluationId: '', rawStatus: 'unknown', candidateStatus: null, candidateCount: 0,
    confirmedStatus: null, revision: 0, transitionQuiet: false};
  const epoch = (id: string): number => Date.parse(id.replace(/^stale:/u, ''));
  const at = epoch(evaluationId), previousAt = epoch(base.evaluationId);
  if (Number.isFinite(at) && Number.isFinite(previousAt) && (at < previousAt
    || at === previousAt && base.evaluationId.startsWith('stale:') && !evaluationId.startsWith('stale:'))) return base;
  if (status === 'unknown') return {...base,
    // A missing/stale read can suppress delivery without forgetting the last real evaluation watermark.
    evaluationId: !Number.isFinite(at) && Number.isFinite(previousAt) ? base.evaluationId : evaluationId,
    rawStatus: status, candidateStatus: null, candidateCount: 0};
  if (base.evaluationId === evaluationId) return base;
  const count = base.candidateStatus === status ? Math.min(2, base.candidateCount + 1) : 1;
  const changed = count === 2 && base.confirmedStatus !== status;
  return {...base, evaluationId, rawStatus: status, candidateStatus: status, candidateCount: count,
    confirmedStatus: count === 2 ? status : base.confirmedStatus,
    // The first two matching observations establish a silent baseline.
    revision: changed && base.confirmedStatus !== null ? base.revision + 1 : base.revision,
    transitionQuiet: changed ? quiet : base.transitionQuiet};
}

const names: Record<AlertCheckId, string> = {orders: 'Orders flowing', checkout: 'Checkout', dispatch: 'Dispatch',
  refunds: 'Refunds', webhooks: 'Shopify webhooks', geo: 'Session geo', self: 'Self-check', ads_check: 'Ads check'};
function safeExplanation(why: string): string {
  return Array.from(why.replace(/https?:\/\/\S+|www\.\S+/giu, '…')
    .replace(/[\w.!#$%&'*+/=?^`{|}~-]+@[\w.-]+\.[a-z]{2,}/giu, '…')
    .replace(/\+\d[\d ()-]{6,}\d|\b0\d[\d ()-]{6,}\d\b|\(?\b\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b/gu, '…')
    .replace(/\s+/g, ' ').trim()).slice(0, 600).join('');
}
/** Only the eight fixed watchdogs supply these generated count/time explanations. */
export function watchdogAlertPayload(id: AlertCheckId, status: KnownAlertStatus, why: string, now: Date): PushPayload {
  return {kind: 'alert', alertKey: id, title: status === 'tripped' ? `✕ ${names[id]}` : `✓ ${names[id]} recovered`,
    body: safeExplanation(why), path: `/alerts/check/${id}`, day: ukToday(now)};
}
export function monthlyUploadPayload(now: Date): PushPayload {
  return {kind: 'alert', alertKey: 'jj-monthly', title: "Upload last month's J&J export",
    body: 'The previous month still needs a complete export.', path: '/fulfilment', day: ukToday(now)};
}
