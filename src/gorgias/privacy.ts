import type { GorgiasTicket } from './model.js';

const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const plain = (value: unknown): string => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, ' ').trim() : '';
const pattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Source free text is never retained before this projection. The bound is in Unicode code points. */
export function scrubGorgiasText(value: unknown, knownNames: readonly string[] = [], limit = 80): string {
  let text = plain(value).replace(/<[^>]*>/g, ' ');
  for (const name of knownNames.map(plain).filter(name => name.length > 2 && /\s/.test(name)))
    text = text.replace(new RegExp(name.split(/\s+/u).map(pattern).join('\\s+'), 'giu'), '…');
  text = text
    .replace(/\b(?:https?:\/\/|ftp:\/\/|www\.)[^\s<>"']+/giu, '…')
    .replace(/[^\s<>"']+@[^\s<>"']+\.[a-z]{2,}/giu, '…')
    .replace(/\bp\.?\s*o\.?\s*box\s+[\w-]+\b/giu, '…')
    .replace(/\b(?:(?:flat|apartment|apt|unit|suite|ste)\s*#?[\w-]+[, ]+)?\d{1,5}[a-z]?(?:[-/]\d{1,5})?\s+(?:[\p{L}][\p{L}'’.-]*\s+){0,5}(?:street|st|road|rd|lane|ln|avenue|ave|drive|dr|close|court|ct|way|boulevard|blvd|place|pl|terrace|tce|crescent|cres|gardens|grove|parkway|pkwy|circle|cir|square|sq)\b(?:[.,]?\s*(?:flat|apartment|apt|unit|suite|ste)\s*#?[\w-]+)?/giu, '…')
    .replace(/\b(?:GIR\s?0AA|[a-z]{1,2}\d[a-z\d]?\s?\d[a-z]{2})\b/giu, '…')
    // An explicit short order marker is operational identity, not a ZIP code. ZIP+4,
    // phone continuations and longer numbers still pass through the scrubbers below.
    .replace(/\b\d{5}(?:-\d{4})?\b/gu, (match: string, offset: number, body: string) =>
      body[offset - 1] === '#' && /^\d{5}$/.test(match) ? match : '…')
    .replace(/(?:\+\s*)?\(?\d[\d\s().-]{5,}\d\)?/gu, match => (match.match(/\d/g)?.length ?? 0) >= 7 ? '…' : match)
    .replace(/\d{6,}/gu, '…')
    .replace(/\s+/gu, ' ').trim();
  return Array.from(text).slice(0, limit).join('');
}

/** Gorgias examples use UTC datetimes without a zone; make that assumption explicit, never host-local. */
export function normalizedGorgiasDate(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})?$/.test(value))
    throw new Error('Invalid Gorgias date.');
  const zoned = /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}Z`;
  const time = Date.parse(zoned);
  const calendarDay = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  if (!Number.isFinite(time) || !Number.isFinite(calendarDay.getTime()) || calendarDay.toISOString().slice(0, 10) !== value.slice(0, 10))
    throw new Error('Invalid Gorgias date.');
  return new Date(time).toISOString();
}

export function gorgiasTicketId(value: unknown): string {
  const id = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof id !== 'string' || !/^[1-9]\d{0,24}$/.test(id)) throw new Error('Invalid Gorgias identifier.');
  return id;
}

/** Only the first two controlled intent levels may leave the read. Never retain a free-text leaf. */
export function normalizeGorgiasIntent(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const levels = value.split('::', 2);
  if (levels.length !== 2 || levels.some(level => /[^A-Za-z &]/.test(level) || !/[A-Za-z]/.test(level))) return null;
  const intent = levels.map(level => level.trim()).join('::');
  return intent.length <= 80 ? intent : null;
}

export function parseGorgiasIntentFields(value: unknown, fieldId: string | null): string | null {
  if (fieldId === null) return null;
  const fields = record(value);
  if (!Object.hasOwn(fields, fieldId)) return null;
  const field = record(fields[fieldId]);
  try { if (gorgiasTicketId(field.id) !== fieldId) return null; } catch { return null; }
  return normalizeGorgiasIntent(field.value);
}
function person(customer: Record<string, unknown>): { label: string; names: string[] } {
  const full = plain(customer.name), first = plain(customer.firstname), last = plain(customer.lastname);
  const words = full.split(/\s+/u);
  const valid = (value: string) => /^[\p{L}\p{M}][\p{L}\p{M}'’ -]{0,79}$/u.test(value);
  const given = valid(first) ? first.split(/\s+/u)[0]! : valid(full) ? words[0]! : '';
  const surname = valid(last) ? last : valid(full) && words.length > 1 ? words.at(-1)! : '';
  const initial = Array.from(surname)[0];
  return {label: given ? `${Array.from(given).slice(0, 30).join('')}${initial ? ` ${initial}.` : ''}` : 'Customer',
    names: [full, `${first} ${last}`.trim()]};
}

/** Explicit allowlist: bodies, customer objects, email, addresses and closure times cannot escape. */
export function parseGorgiasTicket(value: unknown, membership: {inHandover: boolean; viewId: string | null}, intentFieldId: string | null = null): GorgiasTicket {
  const row = record(value), customer = person(record(row.customer));
  if (row.status !== 'open' && row.status !== 'closed') throw new Error('Invalid Gorgias status.');
  const createdAt = normalizedGorgiasDate(row.created_datetime);
  if (!createdAt || !Array.isArray(row.tags)) throw new Error('Invalid Gorgias ticket.');
  const tags = [...new Set(row.tags.map(tag => {
    const name = record(tag).name;
    if (typeof name !== 'string') throw new Error('Invalid Gorgias tag.');
    return scrubGorgiasText(name, customer.names, 80);
  }).filter(Boolean))];
  if (tags.length > 100) throw new Error('Invalid Gorgias tag count.');
  const channel = typeof row.channel === 'string' && /^[a-z][a-z0-9_-]{0,39}$/i.test(row.channel) ? row.channel.toLowerCase() : 'unknown';
  return {id: gorgiasTicketId(row.id), status: row.status, channel, tags,
    inHandover: membership.inHandover && row.status === 'open', viewId: membership.viewId,
    createdAt, updatedAt: normalizedGorgiasDate(row.updated_datetime),
    lastCustomerMessageAt: normalizedGorgiasDate(row.last_received_message_datetime),
    customer: customer.label, subject: scrubGorgiasText(row.subject, customer.names),
    aiIntent: parseGorgiasIntentFields(row.custom_fields, intentFieldId)};
}
