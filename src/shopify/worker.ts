import { RoutineSessions, type DailySessionFallback } from './fallback.js';
import { appConfig } from '../config.js';
import type { Database } from '../db.js';
import { addDays, ukToday } from '../hero-range.js';
import type { SourceMode } from '../sources.js';
import { nextCursor, ShopifyClient, type ShopifyReader } from './client.js';
import { ShopifyError, Transport, type TransportOptions } from './http.js';
import { SampleShopify } from './sample.js';
import { ShopifyStore } from './store.js';
import { channelKey, reportRows } from './model.js';
import { paidOrder } from './metrics.js';
import { webhookTopics } from './webhooks.js';

type Job = 'backfill' | 'poll' | 'inventory' | 'sessions' | 'subscriptions' | 'reconcile' | 'session_history';
const intervals: Record<Job, number> = { backfill: 0, poll: 300_000, inventory: 300_000, sessions: 300_000, subscriptions: 3_600_000, reconcile: 86_400_000, session_history: 0 };
export function backfillWindow(now: Date, allOrders: boolean) {
  return { from: addDays(ukToday(now), -(allOrders ? 399 : 59)), olderFrom: addDays(ukToday(now), -399), olderTo: addDays(ukToday(now), -60) };
}
export function sessionQuery(from: string, to: string): string {
  return `FROM sessions SHOW sessions, sessions_with_cart_additions, sessions_that_reached_checkout, sessions_that_completed_checkout GROUP BY day, session_country, session_region, landing_page_path, session_device_type, referrer_source SINCE ${from} UNTIL ${to}`;
}
export function channelQuery(from: string, to: string): string { return `FROM sales SHOW orders GROUP BY day, sales_channel SINCE ${from} UNTIL ${to} ORDER BY day`; }
function salesQuery(from: string, to: string): string { return `FROM sales SHOW orders, net_sales GROUP BY day SINCE ${from} UNTIL ${to} ORDER BY day`; }
export function ukDayStart(day: string): Date {
  return new Date(nextNight(new Date(`${addDays(day, -1)}T12:00:00Z`)).getTime() - 60_000);
}
export function nextNight(now: Date): Date {
  // First minute of the next UK day: zone offset comes from Intl, including the clock change.
  const target = addDays(ukToday(now), 1);
  let value = Date.parse(`${target}T00:01:00Z`);
  if (ukToday(new Date(value - 3_600_000)) === target) value -= 3_600_000;
  return new Date(value);
}
export class ShopifyWorker {
  readonly store: ShopifyStore;
  readonly client: ShopifyReader;
  readonly mode: SourceMode;
  private running?: Promise<void>;
  private inboxRunning?: Promise<void>;
  private timer?: NodeJS.Timeout;
  private closing = false;
  private readonly fallback: DailySessionFallback;
  private readonly clock: () => Date;
  constructor(private readonly db: Database, private readonly env: NodeJS.ProcessEnv, private readonly origin: string,
    options: TransportOptions & { reader?: ShopifyReader; clock?: () => Date; fallback?: DailySessionFallback } = {}) {
    this.mode = env.SHOPIFY_CLIENT_ID?.trim() && env.SHOPIFY_CLIENT_SECRET?.trim() ? 'live' : 'sample';
    this.clock = options.clock ?? (() => this.mode === 'sample' ? new Date(appConfig.shopify.sampleNow) : new Date());
    this.client = options.reader ?? (this.mode === 'sample' ? new SampleShopify(true) : new ShopifyClient(new Transport({ ...options, log: options.log ?? (entry => console.info(JSON.stringify(entry))) }), env, origin));
    this.fallback = options.fallback ?? new RoutineSessions(new Transport({ ...options, log: options.log ?? (entry => console.info(JSON.stringify(entry))) }), env);
    this.store = new ShopifyStore(db, this.mode);
  }
  async initialize(): Promise<void> {
    for (const job of Object.keys(intervals)) await this.db.query(`INSERT INTO pulse.shopify_jobs (mode, name, next_run_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [this.mode, job, this.clock()]);
  }
  start(): void {
    this.trigger();
    this.triggerInbox();
    this.timer = setInterval(() => { this.trigger(); this.triggerInbox(); }, 1000); this.timer.unref();
  }
  trigger(): void { if (!this.closing) void this.tick().catch(() => {}); }
  async stop(): Promise<void> { this.closing = true; if (this.timer) clearInterval(this.timer); await Promise.all([this.running, this.inboxRunning]); }
  async tick(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.run();
    try { await this.running; } finally { this.running = undefined; }
  }
  private async notice(kind: string, id: string): Promise<void> { await this.store.notice(kind, id, this.clock()); }
  private async orderPage(query: string, after: string | null, address: boolean) {
    try { return await this.client.orders(query, after, address); }
    catch (error) {
      if (!address || !(error instanceof ShopifyError) || error.code !== 'denied') throw error;
      await this.notice('address_unavailable', 'address');
      await this.db.query(`UPDATE pulse.shopify_jobs SET state = state || '{"address":false}'::jsonb WHERE mode = $1 AND name = 'backfill'`, [this.mode]);
      return this.client.orders(query, after, false);
    }
  }
  private async run(): Promise<void> {
    const now = this.clock();
    const due = await this.db.query<{ name: Job; state: any; last_success_at: Date | null }>(`SELECT name, state, last_success_at FROM pulse.shopify_jobs WHERE mode = $1 AND next_run_at <= $2 ORDER BY name`, [this.mode, now]);
    let attempted = due.rows.length > 0, failed = false;
    for (const job of due.rows) {
      try {
        const state = await this.execute(job.name, job.state, job.last_success_at);
        const next = state.continuing ? new Date(now.getTime() + 1000) : ['backfill', 'session_history'].includes(job.name) ? new Date('9999-01-01T00:00:00Z') : job.name === 'reconcile' ? nextNight(now) : new Date(now.getTime() + intervals[job.name]);
        await this.db.query(`UPDATE pulse.shopify_jobs SET state = $3, next_run_at = $4, last_success_at = $5, failures = 0 WHERE mode = $1 AND name = $2`, [this.mode, job.name, JSON.stringify(state), next, now]);
      } catch (error) {
        failed = true;
        const delay = error instanceof ShopifyError && error.code === 'denied' ? 3_600_000 : 60_000;
        await this.db.query(`UPDATE pulse.shopify_jobs SET failures = failures + 1, next_run_at = $3 WHERE mode = $1 AND name = $2`, [this.mode, job.name, new Date(now.getTime() + delay)]);
      }
    }
    if (this.mode === 'live' && attempted) await this.health(failed);
  }
  triggerInbox(): void { if (!this.closing) void this.drainInbox().catch(() => {}); }
  async drainInbox(): Promise<void> {
    if (this.mode !== 'live') return;
    if (this.inboxRunning) return this.inboxRunning;
    this.inboxRunning = this.processInbox();
    try { await this.inboxRunning; } finally { this.inboxRunning = undefined; }
  }
  private async processInbox(): Promise<void> {
    const now = this.clock(); let failed = false;
    const inbox = await this.db.query<{ source_id: string; topic: string; payload: any }>(`SELECT source_id, topic, payload FROM pulse.shopify_webhook_inbox WHERE processed_at IS NULL AND next_attempt_at <= $1 ORDER BY fetched_at LIMIT 25`, [now]);
    const attempted = inbox.rows.length > 0;
    for (const event of inbox.rows) {
      try {
        if (event.topic === 'inventory_levels/update') await this.store.inventory(await this.client.inventory(), this.clock());
        else {
          const checkpoint = await this.db.query<{ state: any }>(`SELECT state FROM pulse.shopify_jobs WHERE mode = $1 AND name = 'backfill'`, [this.mode]);
          let raw;
          try { raw = await this.client.order(event.payload.orderId, checkpoint.rows[0]?.state.address !== false); }
          catch (error) {
            if (!(error instanceof ShopifyError) || error.code !== 'denied') throw error;
            await this.notice('address_unavailable', 'address');
            raw = await this.client.order(event.payload.orderId, false);
          }
          if (!raw) throw new ShopifyError('invalid');
          await this.store.orders([raw], this.clock());
        }
        await this.db.query('UPDATE pulse.shopify_webhook_inbox SET processed_at = $2, attempts = attempts + 1 WHERE source_id = $1', [event.source_id, this.clock()]);
      } catch {
        failed = true;
        await this.db.query(`UPDATE pulse.shopify_webhook_inbox SET attempts = attempts + 1, next_attempt_at = $2 WHERE source_id = $1`, [event.source_id, new Date(now.getTime() + 60_000)]);
      }
    }
    if (attempted) await this.health(failed);
  }
  private async health(failed: boolean): Promise<void> {
    const remainingFailures = await this.db.query(`SELECT name FROM pulse.shopify_jobs WHERE mode = 'live' AND failures > 0 UNION ALL SELECT source_id FROM pulse.shopify_webhook_inbox WHERE processed_at IS NULL AND attempts > 0`);
    failed ||= remainingFailures.rows.length > 0;
    await this.db.query(`UPDATE pulse.source_health SET status = $1, last_attempt_at = $2,
      last_success_at = CASE WHEN $1 = 'healthy' THEN $2 ELSE last_success_at END,
      consecutive_failures = CASE WHEN $1 = 'healthy' THEN 0 ELSE consecutive_failures + 1 END, updated_at = $2 WHERE source = 'shopify'`, [failed ? 'error' : 'healthy', this.clock()]);
  }

  private async reconcileChannels(from: string, to: string, now: Date): Promise<void> {
    const table = await this.client.report(channelQuery(from, to));
    const expected = new Map<string, number>();
    for (const row of reportRows(table)) {
      if (typeof row.day !== 'string' || row.day < from || row.day > to || typeof row.sales_channel !== 'string' || !Number.isInteger(Number(row.orders)) || Number(row.orders) < 0) throw new ShopifyError('invalid');
      const channel = channelKey(row.sales_channel);
      expected.set(channel, (expected.get(channel) ?? 0) + Number(row.orders));
    }
    const { records } = await this.store.facts();
    const counts = new Map<string, number>();
    for (const { kind, data } of records) if (kind === 'order' && paidOrder(data) && data.day >= from && data.day <= to) {
      const channel = channelKey(data.channel ?? 'Unknown');
      counts.set(channel, (counts.get(channel) ?? 0) + 1);
    }
    // Replace only after the complete report parses. A failed report retains the last good check.
    await this.db.transaction(async tx => {
      const store = new ShopifyStore(tx, this.mode);
      await tx.query("DELETE FROM pulse.shopify_notices WHERE mode = $1 AND kind = 'channel_short'", [this.mode]);
      const unknown = counts.get('unknown') ?? 0;
      const unmatched = [...expected].filter(([channel]) => channel === 'unknown' || !counts.has(channel));
      for (const [channel, reported] of expected) {
        if (unknown > 0 && unmatched.some(([name]) => name === channel)) continue;
        const stored = counts.get(channel) ?? 0;
        if (stored < reported) await store.notice('channel_short', `channel:${channel}`, now, { channel, stored, reported, from, to });
      }
      // Unknown source orders can account for report-only channels, without guessing which.
      const reported = unmatched.reduce((n, [, count]) => n + count, 0);
      if (unknown > 0 && unknown < reported) await store.notice('channel_short', 'channel:unknown', now,
        { channel: `Unknown / unmatched (${unmatched.map(([channel]) => channel).join(', ')})`, stored: unknown, reported, from, to });
    });
  }
  private async execute(name: Job, state: any, lastSuccess: Date | null): Promise<any> {
    const now = this.clock(), day = ukToday(now);
    const checkpoint = await this.db.query<{ state: any }>(`SELECT state FROM pulse.shopify_jobs WHERE mode = $1 AND name = 'backfill'`, [this.mode]);
    const address = checkpoint.rows[0]?.state.address !== false;
    if (name === 'backfill') {
      if (!state.from) {
        const scopes = await this.client.scopes();
        state = { ...backfillWindow(now, scopes.includes('read_all_orders')), allOrders: scopes.includes('read_all_orders'), address: true, after: null, until: now.toISOString() };
        // Persist the window before the first page, including failures later in this run.
        await this.db.query(`UPDATE pulse.shopify_jobs SET state = $2 WHERE mode = $1 AND name = 'backfill'`, [this.mode, JSON.stringify(state)]);
      }
      if (!state.ordersDone) {
        const result = await this.orderPage(`created_at:>=${ukDayStart(state.from).toISOString()} created_at:<=${state.until}`, state.after, state.address !== false);
        await this.store.orders(result.nodes, now);
        const after = nextCursor(result);
        if (after && after === state.after) throw new ShopifyError('invalid');
        const saved = await this.db.query<{ state: any }>(`SELECT state FROM pulse.shopify_jobs WHERE mode = $1 AND name = 'backfill'`, [this.mode]);
        state = { ...state, address: saved.rows[0]?.state.address !== false, after, ordersDone: !after };
        if (after) return { ...state, continuing: true };
        await this.db.query(`UPDATE pulse.shopify_jobs SET state = $2 WHERE mode = $1 AND name = 'backfill'`, [this.mode, JSON.stringify(state)]);
      }
      if (!state.allOrders && !state.historyDone) {
        try { await this.store.sales(await this.client.report(salesQuery(state.olderFrom, state.olderTo)), now); state.historyDone = true; }
        catch (error) {
          if (!(error instanceof ShopifyError) || error.code !== 'denied') throw error;
          await this.notice('reports_unavailable', 'history');
          await this.db.query(`UPDATE pulse.shopify_jobs SET state = $2 WHERE mode = $1 AND name = 'backfill'`, [this.mode, JSON.stringify({ ...state, historyUnavailable: true })]);
          throw error;
        }
      }
      return { ...state, continuing: false };
    }
    if (name === 'poll' || name === 'reconcile') {
      const from = name === 'poll' ? new Date(Math.min(now.getTime() - 600_000, (lastSuccess?.getTime() ?? now.getTime()) - 600_000)).toISOString() : ukDayStart(addDays(day, -7)).toISOString();
      const until = name === 'poll' ? now.toISOString() : new Date(ukDayStart(day).getTime() - 1).toISOString();
      const query = state.continuing ? state.query : `${name === 'poll' ? 'updated_at' : 'created_at'}:>=${from} ${name === 'poll' ? 'updated_at' : 'created_at'}:<=${until}`;
      const result = await this.orderPage(query, state.continuing ? state.after : null, address);
      await this.store.orders(result.nodes, now);
      const after = nextCursor(result);
      if (after && after === state.after) throw new ShopifyError('invalid');
      const reportFrom = state.continuing ? state.reportFrom : addDays(day, -7);
      const reportTo = state.continuing ? state.reportTo : addDays(day, -1);
      if (name === 'reconcile' && !after) await this.reconcileChannels(reportFrom, reportTo, now);
      return { query, after, reportFrom, reportTo, continuing: Boolean(after) };
    }
    if (name === 'session_history') {
      if (!checkpoint.rows[0]?.state.ordersDone) return { continuing: true };
      const first = checkpoint.rows[0].state.from;
      const date = state.day ?? addDays(day, -2);
      if (date < first) return { done: true };
      const from = this.mode === 'sample' ? first : date;
      await this.store.sessions(await this.client.report(sessionQuery(from, date)), now);
      return this.mode === 'sample' ? { done: true } : { day: addDays(date, -1), continuing: true };
    }
    if (name === 'inventory') { await this.store.inventory(await this.client.inventory(), now); return {}; }
    if (name === 'sessions') {
      // Re-read yesterday too: late report corrections and geo guard updates must replace previous totals.
      try { await this.store.sessions(await this.client.report(sessionQuery(addDays(day, -1), day)), now); await this.store.clearNotice('sessions'); return { cadence: 'five_minutes' }; }
      catch (error) {
        if (!(error instanceof ShopifyError) || error.code !== 'denied') throw error;
        await this.notice('reports_unavailable', 'sessions');
        if (this.mode === 'sample') throw error;
        const yesterday = addDays(day, -1);
        await this.store.sessions(await this.fallback.read(yesterday), now, 'routine_daily');
        return { cadence: 'daily', lastReportDay: yesterday };
      }
    }
    if (this.mode === 'sample') return { skipped: 'sample_mode' };
    const uri = new URL(appConfig.shopify.webhookPath, this.origin);
    if (uri.protocol !== 'https:' || uri.hostname.endsWith('.replit.dev') || ['localhost', '127.0.0.1', '[::1]'].includes(uri.hostname)) throw new ShopifyError('invalid');
    const subscriptions: any[] = []; let after: string | null = null;
    do { const result = await this.client.subscriptions(after); subscriptions.push(...result.nodes); const next = nextCursor(result); if (next && next === after) throw new ShopifyError('invalid'); after = next; } while (after);
    for (const topic of Object.values(webhookTopics)) {
      if (!subscriptions.some(s => s.topic === topic && s.uri === uri.href)) {
        await this.client.subscribe(topic, uri.href);
        if (state.checked) await this.notice('webhook_recreated', `subscription:${topic}`);
      } else await this.store.clearNotice(`subscription:${topic}`);
    }
    return { checked: Object.keys(webhookTopics).length };
  }
}
