import {normalizeGorgiasDomain, type GorgiasTicket, type GorgiasPollInput, type GorgiasPollResult} from './model.js';
import {gorgiasTicketId, normalizedGorgiasDate, parseGorgiasIntentFields, parseGorgiasTicket, scrubGorgiasText} from './privacy.js';

const READ_BUDGET_MS = 60_000, TIMEOUT_MS = 10_000, REQUEST_GAP_MS = 550, PAGE_SIZE = 100, MAX_PAGES = 100;
const INTENT_FIELD_CACHE_MS = 24 * 60 * 60_000, INTENT_BACKFILL_LIMIT = 20;
export interface GorgiasCredentials {domain: string; email: string; key: string}
export function gorgiasCredentials(env: NodeJS.ProcessEnv): GorgiasCredentials | null {
  const domain = env.GORGIAS_DOMAIN?.trim().toLowerCase(), email = env.GORGIAS_EMAIL?.trim(), key = env.GORGIAS_API_KEY?.trim();
  return domain && email && key ? {domain, email, key} : null;
}
export type GorgiasReadCode = 'http' | 'network' | 'invalid' | 'pagination' | 'rate_limit' | 'budget';
export class GorgiasReadError extends Error {
  constructor(readonly code: GorgiasReadCode, readonly status = 0, readonly retryAt: number | null = null) {
    super(`Gorgias read failed (${code}, ${status}).`);
  }
}
export interface GorgiasRequestLog {source: 'gorgias'; endpoint: 'tickets' | 'ticket' | 'views' | 'custom-fields'; status: number; requestId: string | null; attempt: number}
export interface GorgiasClientOptions {
  fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; now?: () => number;
  log?: (entry: GorgiasRequestLog) => void;
}
export interface GorgiasProbePage {
  count: number; fieldNames: string[];
  pagination: {meta: 'object' | 'missing'; nextCursor: 'string' | 'null' | 'missing'; previousCursor: 'string' | 'null' | 'missing'};
  views?: {id: string; name: string}[];
}
export interface GorgiasReader {readHandover(input: GorgiasPollInput): Promise<GorgiasPollResult>}
export interface GorgiasProbeReader {probeTickets(): Promise<GorgiasProbePage>; probeViews(): Promise<GorgiasProbePage>}
interface TicketRead {ticket: GorgiasTicket; closedAt: string | null; intentFields: unknown}
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
function cursor(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\u007f]/.test(value)) throw new GorgiasReadError('pagination');
  return value;
}
function page(value: unknown, strict = true): {rows: unknown[]; next: string | null} {
  const body = object(value);
  if (!Array.isArray(body.data) || body.data.length > PAGE_SIZE || (strict && body.meta === undefined) || (body.meta !== undefined && (body.meta === null || typeof body.meta !== 'object' || Array.isArray(body.meta))))
    throw new GorgiasReadError('invalid', 200);
  return {rows: body.data, next: cursor(object(body.meta).next_cursor)};
}
function ticket(raw: unknown, member: boolean, viewId: string | null): TicketRead {
  try {
    const safe = parseGorgiasTicket(raw, {inHandover: member, viewId});
    const closedAt = safe.status === 'closed' ? normalizedGorgiasDate(object(raw).closed_datetime) : null;
    if (safe.status === 'closed' && !closedAt) throw new Error('Closure time missing.');
    return {ticket: safe, closedAt, intentFields: object(raw).custom_fields};
  } catch { throw new GorgiasReadError('invalid', 200); }
}

/** Only fixed GET endpoints exist. Credentials, raw responses and closure timestamps never escape a read. */
export class GorgiasClient implements GorgiasReader, GorgiasProbeReader {
  #credentials: GorgiasCredentials;
  #fetch: typeof fetch;
  #sleep: (ms: number) => Promise<void>;
  #now: () => number;
  #pending: Promise<unknown> = Promise.resolve();
  #nextAllowed = 0;
  #intentField: {id: string | null; expiresAt: number} | null = null;
  constructor(credentials: GorgiasCredentials, private readonly options: GorgiasClientOptions = {}) {
    this.#credentials = {domain: credentials.domain.trim().toLowerCase(), email: credentials.email.trim(), key: credentials.key.trim()};
    this.#fetch = options.fetch ?? fetch;
    this.#sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
    this.#now = options.now ?? Date.now;
  }
  readHandover(input: GorgiasPollInput): Promise<GorgiasPollResult> {
    return this.#enqueue(async () => {
      const deadline = this.#now() + READ_BUDGET_MS, weekStart = Date.parse(input.weekStart), asOf = Date.parse(input.asOf);
      if (!Number.isFinite(weekStart) || !Number.isFinite(asOf) || weekStart > asOf || !input.tag.trim()) throw new GorgiasReadError('invalid');
      let viewId: string | null;
      try { viewId = input.viewId ? gorgiasTicketId(input.viewId) : null; }
      catch { throw new GorgiasReadError('invalid'); }
      const known = new Map(input.knownTickets.map(row => [row.id, row])), selected = new Set<string>(), collected = new Map<string, TicketRead>();
      const missing = new Set<string>();
      const put = (read: TicketRead) => {
        const previous = collected.get(read.ticket.id);
        if (!previous || (read.ticket.updatedAt ?? read.ticket.createdAt) >= (previous.ticket.updatedAt ?? previous.ticket.createdAt)) collected.set(read.ticket.id, read);
      };
      // No undocumented status/tag parameter: a complete tag-mode listing is filtered locally.
      await this.#tickets(viewId ? {view_id: viewId} : {}, deadline, raw => {
        let safe: GorgiasTicket;
        try { safe = parseGorgiasTicket(raw, {inHandover: false, viewId}); } catch { throw new GorgiasReadError('invalid', 200); }
        const matches = viewId !== null || safe.tags.includes(input.tag.trim());
        if (matches) selected.add(safe.id);
        if (matches || known.has(safe.id)) put(ticket(raw, matches, viewId));
        return false;
      });
      if (viewId && (known.size || selected.size)) {
        // Only the recent account tail is needed to confirm this week's closures of former members.
        await this.#tickets({}, deadline, raw => {
          let updated: string | null, id: string;
          try { updated = normalizedGorgiasDate(object(raw).updated_datetime); id = gorgiasTicketId(object(raw).id); }
          catch { throw new GorgiasReadError('invalid', 200); }
          if (updated && Date.parse(updated) < weekStart) return true;
          if (known.has(id) || selected.has(id)) put(ticket(raw, selected.has(id), viewId));
          return false;
        });
      }
      // Absence from a complete view proves departure, never closure. Confirm only formerly open members.
      if (viewId) for (const old of known.values()) {
        if (old.status !== 'open' || !old.inHandover || collected.has(old.id)) continue;
        let id: string;
        try { id = gorgiasTicketId(old.id); } catch { throw new GorgiasReadError('invalid'); }
        try {
          const raw = await this.#send('ticket', `tickets/${id}`, {}, deadline);
          const read = ticket(raw, false, viewId);
          if (read.ticket.id !== id) throw new GorgiasReadError('invalid', 200);
          put(read);
        } catch (error) {
          // A confirmed missing/deleted ticket leaves the handover set, without inventing a closure.
          if (!(error instanceof GorgiasReadError && error.code === 'http' && error.status === 404)) throw error;
          missing.add(id);
        }
      }
      const rows = [...collected.values()];
      const result: GorgiasPollResult = {tickets: rows.map(row => row.ticket), closedThisWeek: rows.filter(row => row.ticket.status === 'closed'
        && row.closedAt !== null && Date.parse(row.closedAt) >= weekStart && Date.parse(row.closedAt) <= asOf).length};
      // Optional intent work is last: a missing field, rate limit or exhausted budget cannot undo a good handover read.
      let fieldId: string | null;
      try { fieldId = await this.#readIntentField(deadline); } catch { return result; }
      if (fieldId === null) return result;
      result.intentFieldAvailable = true;
      for (const row of rows) row.ticket.aiIntent = parseGorgiasIntentFields(row.intentFields, fieldId);
      const backfill: NonNullable<GorgiasPollResult['intentBackfill']> = [];
      const checked = new Set(collected.keys());
      for (const candidate of input.intentBackfillIds ?? []) {
        if (backfill.length === INTENT_BACKFILL_LIMIT) break;
        let id: string;
        try { id = gorgiasTicketId(candidate); } catch { continue; }
        if (checked.has(id)) continue;
        checked.add(id);
        // Reuse this poll's confirmed 404 only for an eligible stored candidate; no duplicate detail read.
        if (missing.has(id)) {backfill.push({id, aiIntent: null}); continue;}
        try {
          const raw = object(await this.#send('ticket', `tickets/${id}`, {}, deadline));
          if (gorgiasTicketId(raw.id) !== id) break;
          backfill.push({id, aiIntent: parseGorgiasIntentFields(raw.custom_fields, fieldId)});
        } catch (error) {
          if (error instanceof GorgiasReadError && error.code === 'http' && error.status === 404) backfill.push({id, aiIntent: null});
          else break;
        }
      }
      result.intentBackfill = backfill;
      return result;
    });
  }
  probeTickets(): Promise<GorgiasProbePage> {
    return this.#enqueue(async () => this.#probe(await this.#send('tickets', 'tickets', {limit: '30', trashed: 'false'}, this.#now() + READ_BUDGET_MS, true), false));
  }
  probeViews(): Promise<GorgiasProbePage> {
    return this.#enqueue(async () => this.#probe(await this.#send('views', 'views', {limit: '30'}, this.#now() + READ_BUDGET_MS, true), true));
  }
  #enqueue<T>(read: () => Promise<T>): Promise<T> {
    const next = this.#pending.then(read); this.#pending = next.catch(() => {}); return next;
  }
  async #readIntentField(deadline: number): Promise<string | null> {
    if (this.#intentField && this.#now() < this.#intentField.expiresAt) return this.#intentField.id;
    this.#intentField = null;
    let next: string | null = null;
    const seen = new Set<string>();
    for (let index = 0; index < MAX_PAGES; index++) {
      const result = page(await this.#send('custom-fields', 'custom-fields', {object_type: 'Ticket', limit: String(PAGE_SIZE),
        ...(next ? {cursor: next} : {})}, deadline));
      for (const raw of result.rows) {
        const row = object(raw);
        if (row.managed_type !== 'ai_intent' || row.deactivated_datetime != null || row.object_type !== 'Ticket') continue;
        const id = gorgiasTicketId(row.id);
        this.#intentField = {id, expiresAt: this.#now() + INTENT_FIELD_CACHE_MS};
        return id;
      }
      if (!result.next) {
        this.#intentField = {id: null, expiresAt: this.#now() + INTENT_FIELD_CACHE_MS};
        return null;
      }
      if (!result.rows.length || seen.has(result.next)) throw new GorgiasReadError('pagination', 200);
      seen.add(result.next); next = result.next;
    }
    throw new GorgiasReadError('pagination');
  }
  async #tickets(parameters: Record<string, string>, deadline: number, visit: (raw: unknown) => boolean): Promise<void> {
    let next: string | null = null;
    const seen = new Set<string>();
    for (let index = 0; index < MAX_PAGES; index++) {
      const result = page(await this.#send('tickets', 'tickets', {...parameters, limit: String(PAGE_SIZE), trashed: 'false',
        order_by: 'updated_datetime:desc', ...(next ? {cursor: next} : {})}, deadline));
      for (const raw of result.rows) if (visit(raw)) return;
      if (!result.next) return;
      if (!result.rows.length || seen.has(result.next)) throw new GorgiasReadError('pagination', 200);
      seen.add(result.next); next = result.next;
    }
    throw new GorgiasReadError('pagination');
  }
  async #send(endpoint: GorgiasRequestLog['endpoint'], path: string, parameters: Record<string, string>, deadline: number, probe = false): Promise<unknown> {
    const {domain, email, key} = this.#credentials;
    if (!normalizeGorgiasDomain(domain) || !email || email.includes(':') || !key) throw new GorgiasReadError('invalid');
    const basic = Buffer.from(`${email}:${key}`).toString('base64');
    const retries = probe ? 0 : 3;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const wait = Math.max(0, this.#nextAllowed - this.#now());
      if (this.#now() + wait + TIMEOUT_MS > deadline) throw new GorgiasReadError(wait ? 'rate_limit' : 'budget', wait ? 429 : 0, wait ? this.#nextAllowed : null);
      if (wait) await this.#sleep(wait);
      let status = 0, requestId: string | null = null, failure = new GorgiasReadError('network');
      try {
        const url = new URL(`https://${domain}.gorgias.com/api/${path}`); url.search = new URLSearchParams(parameters).toString();
        const response = await this.#fetch(url, {method: 'GET', redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS),
          headers: {Authorization: `Basic ${basic}`, Accept: 'application/json'}});
        status = response.status;
        const header = response.headers.get('x-request-id');
        requestId = header && /^[A-Za-z0-9_-]{1,160}$/.test(header)
          && ![key, email, basic, encodeURIComponent(key), encodeURIComponent(email)].some(secret => header.includes(secret)) ? header : null;
        this.#nextAllowed = Math.max(this.#nextAllowed, this.#now() + REQUEST_GAP_MS);
        const retry = response.headers.get('retry-after');
        const retryAt = retry && /^\d+(?:\.\d+)?$/.test(retry) ? this.#now() + Number(retry) * 1000 : retry ? Date.parse(retry) : NaN;
        if (Number.isFinite(retryAt)) this.#nextAllowed = Math.max(this.#nextAllowed, Math.min(retryAt, 8.64e15));
        if (response.ok) {
          try { const body: unknown = await response.json(); if (!probe) this.#log(endpoint, status, requestId, attempt); return body; }
          catch { failure = new GorgiasReadError('invalid', status); }
        } else failure = new GorgiasReadError('http', status);
      } catch { /* Upstream messages may contain credentials or ticket values: discard them entirely. */ }
      if (!probe) this.#log(endpoint, status, requestId, attempt);
      this.#nextAllowed = Math.max(this.#nextAllowed, this.#now() + 1000 * 2 ** attempt);
      if (attempt === retries || (status >= 400 && status < 500 && status !== 429)) {
        if (status === 429) throw new GorgiasReadError('rate_limit', status, this.#nextAllowed);
        throw failure;
      }
    }
    throw new GorgiasReadError('network');
  }
  #log(endpoint: GorgiasRequestLog['endpoint'], status: number, requestId: string | null, attempt: number): void {
    const entry: GorgiasRequestLog = {source: 'gorgias', endpoint, status, requestId, attempt: attempt + 1};
    try { if (this.options.log) this.options.log(entry); else console.info(`Gorgias ${endpoint} read ${status} (${requestId ?? 'no request id'}).`); }
    catch { /* Diagnostic sinks cannot fail a background read. */ }
  }
  #probe(body: unknown, views: boolean): GorgiasProbePage {
    const parsed = page(body, false), envelope = object(body), meta = object(envelope.meta), names = new Set<string>();
    const secrets = [this.#credentials.key, this.#credentials.email,
      Buffer.from(`${this.#credentials.email}:${this.#credentials.key}`).toString('base64')];
    const schemaKey = (field: string) => /^[a-z_][a-z0-9_]{0,79}$/.test(field) && !secrets.some(secret => field.includes(secret));
    for (const raw of parsed.rows) {
      const row = object(raw);
      // Only schema keys, never values; do not recurse into dynamic integration/custom-field maps.
      for (const field of Object.keys(row).filter(schemaKey)) names.add(field);
      if (!views) {
        for (const field of Object.keys(object(row.customer)).filter(schemaKey)) names.add(`customer.${field}`);
        for (const tag of Array.isArray(row.tags) ? row.tags : []) for (const field of ['id', 'name']) if (Object.hasOwn(object(tag), field)) names.add(`tags[].${field}`);
      }
    }
    const type = (value: unknown): 'string' | 'null' | 'missing' => value === null ? 'null' : typeof value === 'string' ? 'string' : 'missing';
    const result: GorgiasProbePage = {count: parsed.rows.length, fieldNames: [...names].sort(), pagination: {
      meta: envelope.meta === undefined ? 'missing' : 'object', nextCursor: type(meta.next_cursor), previousCursor: type(meta.prev_cursor)}};
    if (views) result.views = parsed.rows.map(raw => {
      const row = object(raw); let id: string;
      try { id = gorgiasTicketId(row.id); } catch { throw new GorgiasReadError('invalid', 200); }
      let name = typeof row.name === 'string' ? row.name : '';
      for (const secret of secrets)
        name = name.replaceAll(secret, '…');
      return {id, name: scrubGorgiasText(name)};
    });
    return result;
  }
}
