export const MAILCHIMP_POLL_MS = 3 * 60 * 60_000;
export const MAILCHIMP_FRESH_MS = 6 * 60 * 60_000;

export interface MailchimpAudience {
  id: string;
  contacts: number | null;
  subscribers: number;
  unsubscribed: number;
  cleaned: number;
}
export interface MailchimpCampaign { id: string; type: string; status: string; sentAt: string | null }
export interface MailchimpReport { id: string; emailsSent: number | null; orders: number | null; revenueUsd: number | null; currency: string | null }
export interface MailchimpOrder { id: string; campaignId: string; total: number; currency: string; date: string }
export interface MailchimpFacts {
  mode: 'sample' | 'live';
  status: 'sample' | 'pending' | 'live' | 'unavailable';
  fetchedAt: string | null;
  audience: MailchimpAudience | null;
  flowCoverage: 'unknown' | 'available' | 'unavailable';
  campaigns: MailchimpCampaign[];
  reports: MailchimpReport[];
  orders: MailchimpOrder[];
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Mailchimp object.');
  return value as Record<string, unknown>;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 160) throw new Error('Invalid Mailchimp id.');
  return value;
}
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid Mailchimp count.');
  return value;
}
const optionalCount = (value: unknown) => value === undefined || value === null ? null : count(value);
function amount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('Invalid Mailchimp total.');
  return value;
}
function date(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error('Invalid Mailchimp date.');
  return value;
}
const word = (value: unknown) => typeof value === 'string' ? value : '';

export function parseMailchimpAudience(value: unknown): MailchimpAudience {
  const row = object(value), stats = object(row.stats);
  // Subscriber count is not the billable audience. Missing total_contacts stays unknown.
  return { id: id(row.id), contacts: optionalCount(stats.total_contacts), subscribers: count(stats.member_count),
    unsubscribed: count(stats.unsubscribe_count), cleaned: count(stats.cleaned_count) };
}
export function parseMailchimpCampaign(value: unknown): MailchimpCampaign {
  const row = object(value);
  return { id: id(row.id), type: word(row.type), status: word(row.status), sentAt: row.send_time ? date(row.send_time) : null };
}
export function parseMailchimpReport(value: unknown): MailchimpReport {
  const row = object(value), commerce = object(row.ecommerce ?? {}), currency = word(commerce.currency_code) || null;
  return { id: id(row.id), emailsSent: optionalCount(row.emails_sent), orders: optionalCount(commerce.total_orders), currency,
    revenueUsd: currency === 'USD' && commerce.total_revenue !== undefined && commerce.total_revenue !== null ? amount(commerce.total_revenue) : null };
}
export function parseMailchimpOrder(value: unknown): MailchimpOrder {
  const row = object(value), currency = word(row.currency_code);
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Invalid Mailchimp currency.');
  return { id: id(row.id), campaignId: id(row.campaign_id), total: amount(row.order_total), currency, date: date(row.processed_at_foreign) };
}
