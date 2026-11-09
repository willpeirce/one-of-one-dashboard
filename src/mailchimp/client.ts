import { appConfig } from '../config.js';
import { parseMailchimpAudience, parseMailchimpCampaign, parseMailchimpOrder, parseMailchimpReport,
  type MailchimpAudience, type MailchimpCampaign, type MailchimpOrder, type MailchimpReport } from './model.js';

export const MAILCHIMP_API_VERSION = appConfig.mailchimp.apiVersion;
export const MAILCHIMP_ORDER_FIELDS = 'orders.id,orders.campaign_id,orders.order_total,orders.currency_code,orders.processed_at_foreign,total_items';
const CAMPAIGN_FIELDS = 'id,type,status,send_time';
const REPORT_FIELDS = 'id,emails_sent,ecommerce.total_orders,ecommerce.total_revenue,ecommerce.currency_code';
const AUDIENCE_FIELDS = 'id,stats.total_contacts,stats.member_count,stats.unsubscribe_count,stats.cleaned_count';
const READ_BUDGET_MS = 60_000, TIMEOUT_MS = 10_000, REQUEST_GAP_MS = 250, PAGE_SIZE = 100, MAX_PAGES = 100;
type Endpoint = 'campaigns' | 'campaign' | 'report' | 'orders' | 'audience';
export interface MailchimpRead<T> { data: T; fieldNames: string[]; requestId: string | null }
export interface MailchimpReader {
  campaigns(): Promise<MailchimpRead<MailchimpCampaign[]>>;
  campaign(id: string): Promise<MailchimpRead<MailchimpCampaign>>;
  report(id: string): Promise<MailchimpRead<MailchimpReport>>;
  orders(campaignId: string): Promise<MailchimpRead<MailchimpOrder[]>>;
  audience(): Promise<MailchimpRead<MailchimpAudience>>;
}
export type MailchimpReadCode = 'http' | 'network' | 'invalid' | 'pagination' | 'rate_limit';
export class MailchimpReadError extends Error {
  constructor(readonly code: MailchimpReadCode, readonly status = 0, readonly retryAt: number | null = null) {
    super(`Mailchimp read failed (${code}, ${status}).`);
  }
}
export interface MailchimpRequestLog { source: 'mailchimp'; endpoint: Endpoint; status: number; requestId: string | null; attempt: number }
export interface MailchimpClientOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (entry: MailchimpRequestLog) => void;
}

function segment(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(value)) throw new MailchimpReadError('invalid');
  return encodeURIComponent(value);
}
function present(value: unknown, path: readonly string[]): boolean {
  if (!path.length) return value !== undefined;
  if (Array.isArray(value)) return value.some(row => present(row, path));
  return !!value && typeof value === 'object' && present((value as Record<string, unknown>)[path[0]!], path.slice(1));
}

/** Fixed GET reads only: no caller-controlled URL, HTTP method, response body or credential escapes. */
export class MailchimpClient implements MailchimpReader {
  readonly flows = appConfig.mailchimp.flows;
  #token: string;
  #fetch: typeof fetch;
  #sleep: (ms: number) => Promise<void>;
  #now: () => number;
  #pending: Promise<unknown> = Promise.resolve();
  #nextAllowed = 0;
  constructor(token: string, private readonly options: MailchimpClientOptions = {}) {
    this.#token = token;
    this.#fetch = options.fetch ?? fetch;
    this.#sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
    this.#now = options.now ?? Date.now;
  }
  campaigns(): Promise<MailchimpRead<MailchimpCampaign[]>> {
    return this.#enqueue(() => this.#pages('campaigns', 'campaigns', 'campaigns', `${CAMPAIGN_FIELDS.split(',').map(field => `campaigns.${field}`).join(',')},total_items`, {}, parseMailchimpCampaign));
  }
  campaign(id: string): Promise<MailchimpRead<MailchimpCampaign>> {
    return this.#enqueue(() => this.#one('campaign', `campaigns/${segment(id)}`, CAMPAIGN_FIELDS, {}, parseMailchimpCampaign));
  }
  report(id: string): Promise<MailchimpRead<MailchimpReport>> {
    return this.#enqueue(() => this.#one('report', `reports/${segment(id)}`, REPORT_FIELDS, {}, parseMailchimpReport));
  }
  orders(campaignId: string): Promise<MailchimpRead<MailchimpOrder[]>> {
    return this.#enqueue(() => {
      segment(campaignId);
      return this.#pages('orders', 'ecommerce/orders', 'orders', MAILCHIMP_ORDER_FIELDS, {campaign_id: campaignId}, parseMailchimpOrder);
    });
  }
  audience(): Promise<MailchimpRead<MailchimpAudience>> {
    return this.#enqueue(() => this.#one('audience', `lists/${segment(appConfig.mailchimp.listId)}`, AUDIENCE_FIELDS, {include_total_contacts: 'true'}, parseMailchimpAudience));
  }
  #enqueue<T>(read: () => Promise<T>): Promise<T> {
    const next = this.#pending.then(read);
    this.#pending = next.catch(() => {});
    return next;
  }
  async #one<T>(endpoint: Endpoint, path: string, fields: string, parameters: Record<string, string>, parse: (input: unknown) => T): Promise<MailchimpRead<T>> {
    const read = await this.#send(endpoint, path, fields, parameters, this.#now() + READ_BUDGET_MS);
    try { return {...read, data: parse(read.data)}; }
    catch { throw new MailchimpReadError('invalid', 200); }
  }
  async #pages<T extends {id: string}>(endpoint: Endpoint, path: string, key: string, fields: string, parameters: Record<string, string>, parse: (input: unknown) => T): Promise<MailchimpRead<T[]>> {
    const rows = new Map<string, T>(), names = new Set<string>(), deadline = this.#now() + READ_BUDGET_MS;
    let offset = 0, requestId: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const read = await this.#send(endpoint, path, fields, {...parameters, count: String(PAGE_SIZE), offset: String(offset)}, deadline);
      const body = read.data as Record<string, unknown> | null;
      const batch = body?.[key], total = body?.total_items;
      if (!Array.isArray(batch) || !Number.isSafeInteger(total) || Number(total) < 0) throw new MailchimpReadError('invalid', 200);
      const before = rows.size;
      try { for (const raw of batch) { const row = parse(raw); rows.set(row.id, row); } }
      catch { throw new MailchimpReadError('invalid', 200); }
      for (const name of read.fieldNames) names.add(name);
      requestId = read.requestId;
      offset += batch.length;
      if (offset >= Number(total)) return {data: [...rows.values()], fieldNames: [...names].sort(), requestId};
      if (!batch.length || before === rows.size) throw new MailchimpReadError('pagination', 200);
    }
    throw new MailchimpReadError('pagination');
  }
  async #send(endpoint: Endpoint, path: string, fields: string, parameters: Record<string, string>, deadline: number): Promise<MailchimpRead<unknown>> {
    for (let attempt = 0; attempt <= 3; attempt++) {
      const wait = Math.max(0, this.#nextAllowed - this.#now());
      if (this.#now() + wait + TIMEOUT_MS > deadline) throw new MailchimpReadError('rate_limit', 429, Math.max(this.#nextAllowed, this.#now() + 1000));
      if (wait) await this.#sleep(wait);
      let status = 0, requestId: string | null = null, failure = new MailchimpReadError('network');
      try {
        const url = new URL(`https://${appConfig.mailchimp.server}.api.mailchimp.com/${MAILCHIMP_API_VERSION}/${path}`);
        url.search = new URLSearchParams({...parameters, fields}).toString();
        const response = await this.#fetch(url, {method: 'GET', redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS),
          headers: {Authorization: `Basic ${Buffer.from(`pulse:${this.#token}`).toString('base64')}`, Accept: 'application/json'}});
        status = response.status;
        const headerId = response.headers.get('x-request-id');
        requestId = headerId && /^[A-Za-z0-9_-]{1,160}$/.test(headerId) && !headerId.includes(this.#token) ? headerId : null;
        if (response.ok) {
          try {
            const body: unknown = await response.json();
            this.#nextAllowed = Math.max(this.#nextAllowed, this.#now() + REQUEST_GAP_MS);
            this.#log(endpoint, status, requestId, attempt);
            return {data: body, requestId, fieldNames: fields.split(',').filter(field => present(body, field.split('.'))).sort()};
          } catch { failure = new MailchimpReadError('invalid', status); }
        } else {
          failure = new MailchimpReadError('http', status);
          const header = response.headers.get('retry-after');
          const retryAt = header && /^\d+$/.test(header) ? this.#now() + Number(header) * 1000 : header ? Date.parse(header) : NaN;
          if (Number.isFinite(retryAt)) this.#nextAllowed = Math.max(this.#nextAllowed, Math.min(retryAt, 8.64e15));
        }
      } catch { /* Discard upstream errors, which can include credentials or response data. */ }
      this.#log(endpoint, status, requestId, attempt);
      this.#nextAllowed = Math.max(this.#nextAllowed, this.#now() + 1000 * 2 ** attempt);
      if (attempt === 3 || (status >= 400 && status < 500 && status !== 429)) {
        if (status === 429) throw new MailchimpReadError('rate_limit', status, this.#nextAllowed);
        throw failure;
      }
    }
    throw new MailchimpReadError('network');
  }
  #log(endpoint: Endpoint, status: number, requestId: string | null, attempt: number): void {
    const entry: MailchimpRequestLog = {source: 'mailchimp', endpoint, status, requestId, attempt: attempt + 1};
    if (this.options.log) this.options.log(entry);
    else console.info(`Mailchimp ${endpoint} read ${status} (${requestId ?? 'no request id'}).`);
  }
}
