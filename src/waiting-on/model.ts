import {addDays, ukToday} from '../hero-range.js';

export const WAITING_CONTACT_LIMIT = 80;
export const WAITING_SUBJECT_LIMIT = 240;
export const WAITING_FILE_ROW_LIMIT = 60;
export const WAITING_DONE_DAYS = 30;

export interface WaitingInput {contact: string; subject: string; since: string}
export interface WaitingItem extends WaitingInput {id: string; source: 'hq' | 'manual'; days: number}
export interface WaitingDoneItem extends WaitingItem {doneAt: string; returnsOn: string}
export interface WaitingView {
  mode: 'sample' | 'live';
  status: 'ready' | 'missing' | 'unavailable' | 'waiting_for_keys' | 'pending';
  updatedLabel: string | null;
  readAt: string | null;
  asOf: string;
  malformedRows: number;
  cappedRows: number;
  thresholdDays: number;
  rows: WaitingItem[];
  done: WaitingDoneItem[];
}

export function validWaitingDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value) || value.startsWith('0000-')) return false;
  const at = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === value;
}
/** Business-contact summaries only. Obvious contact details never enter either write path. */
export function waitingTextSafe(value: string): boolean {
  return !/[\u0000-\u001f\u007f\uD800-\uDFFF]/u.test(value)
    && !/[^\s@]+@[^\s@]+\.[a-z]{2,}/iu.test(value)
    && !/(?:https?:\/\/|www\.)\S+/iu.test(value)
    && !/(?:\+\d[\d ()-]{6,}\d|\b0\d[\d ()-]{6,}\d\b|\(?\b\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b)/u.test(value)
    && !/\b\d{10,}\b/u.test(value)
    && !/\b(?:[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}|\d{5}-\d{4})\b/iu.test(value)
    && !/\b(?:zip(?:\s+code)?|postcode|postal\s+code)\s*[:#-]?\s*\d{5}\b/iu.test(value)
    && !/\b[A-Z]{2}\s+\d{5}\b/iu.test(value)
    && !/\bP\.?\s*O\.?\s*box\s+\d+\b/iu.test(value)
    && !/\b\d{1,6}\s+(?:[a-z'-]+\s+){0,4}(?:street|st\.?|road|rd\.?|avenue|ave\.?|lane|ln\.?|drive|dr\.?|boulevard|blvd\.?|crescent|close|court|way|place|terrace|gardens|grove)\b/iu.test(value);
}

export class WaitingValidationError extends Error {
  constructor(message = 'Use a business contact or role, a short subject without personal contact details, and a valid past or present date.') {super(message);}
}
export function validateWaitingInput(value: unknown, now: Date): WaitingInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new WaitingValidationError();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join(',') !== 'contact,since,subject') throw new WaitingValidationError();
  const text = (value: unknown, limit: number): string => {
    if (typeof value !== 'string') throw new WaitingValidationError();
    const trimmed = value.trim();
    if (!trimmed || Array.from(trimmed).length > limit || !waitingTextSafe(trimmed)) throw new WaitingValidationError();
    return trimmed;
  };
  const contact = text(row.contact, WAITING_CONTACT_LIMIT), subject = text(row.subject, WAITING_SUBJECT_LIMIT);
  if (!validWaitingDate(row.since) || row.since > ukToday(now)) throw new WaitingValidationError();
  return {contact, subject, since: row.since};
}
/** Date-label subtraction deliberately ignores the length of a UK clock-change day. */
export function waitingDays(since: string, now: Date): number {
  return Math.max(0, Math.round((Date.parse(`${ukToday(now)}T00:00:00Z`) - Date.parse(`${since}T00:00:00Z`)) / 86_400_000));
}
export function waitingDoneUntil(doneAt: string | Date): string {
  return addDays(ukToday(new Date(doneAt)), WAITING_DONE_DAYS);
}
export function validWaitingId(value: unknown): value is string {
  return typeof value === 'string' && /^(?:hq|manual):[a-f0-9]{64}$/u.test(value);
}
