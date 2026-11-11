import type { Database } from '../db.js';
import { ukToday } from '../hero-range.js';
import type { MorningResult } from '../morning/model-types.js';
import { readSettings } from '../settings.js';
import { readPushKeyPair } from './keys.js';
import { sendPush, type PushPayload, type PushSendOptions } from './sender.js';
import { claimPushDay, readPushSubscriptions, recordPushResult } from './store.js';

export const PUSH_SUMMARY_KIND = 'morning-summary';
export const PUSH_TICK_MS = 60_000;
export const PUSH_TEST_INTERVAL_MS = 60_000;
export type PushTestResult = {status: 'sent'; sent: number; failed: number; gone: number}
  | {status: 'rate-limited'; retryAfterSeconds: number} | {status: 'unavailable'};
export interface PushServiceOptions extends Omit<PushSendOptions, 'getKeys'> {
  loadMorning: (now: Date) => Promise<MorningResult>;
}
const ukClock = new Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});
export function summaryWindow(now: Date): boolean {
  const time = ukClock.format(now);
  return time >= '08:00' && time < '10:00';
}
function shortTitle(title: string): string {
  const characters = Array.from(title.replace(/\s+/g, ' ').trim());
  return characters.length > 60 ? `${characters.slice(0, 59).join('')}…` : characters.join('');
}
/** Share the exact offered deck membership and order. */
export function morningSummaryPayload(result: MorningResult): PushPayload {
  const count = result.snapshot.cards.length, prefix = result.snapshot.mode === 'sample' ? 'Sample · ' : '';
  return {kind: 'summary', title: `${prefix}${count ? `Needs you: ${count} ${count === 1 ? 'item' : 'items'}` : 'All clear this morning'}`,
    body: result.snapshot.cards.slice(0, 3).map((card, index) => `${index + 1}. ${shortTitle(card.title)}`).join('\n'), path: '/morning', day: result.snapshot.day};
}

/** One queue owns all deliveries; the separate minute timer starts only after app listen. */
export class PushService {
  private queue: Promise<void> = Promise.resolve();
  private summaryRunning?: Promise<void>;
  private timer?: ReturnType<typeof setInterval>;
  private closing = false;
  private readonly nextTestAt = new Map<string, number>();
  constructor(private readonly db: Database, private readonly options: PushServiceOptions) {}

  start(): void {
    if (this.timer || this.closing) return;
    void this.tick();
    this.timer = setInterval(() => { void this.tick(); }, PUSH_TICK_MS);
    this.timer.unref?.();
  }
  async stop(): Promise<void> {
    this.closing = true;
    if (this.timer) clearInterval(this.timer);
    await this.queue;
  }
  tick(): Promise<void> {
    if (this.closing) return Promise.resolve();
    if (!this.summaryRunning) this.summaryRunning = this.serial(async () => {
      try {
        if (this.closing) return;
        const now = this.now();
        if (!summaryWindow(now) || !(await readSettings(this.db, {seed: false})).values.morningSummaryEnabled) return;
        if (!await claimPushDay(this.db, PUSH_SUMMARY_KIND, ukToday(now), now)) return;
        // Never release the durable claim, including a failed deck read or an empty device list.
        const morning = await this.options.loadMorning(now);
        await this.deliver(morningSummaryPayload(morning));
      } catch { this.log('Morning push summary failed; any daily claim remains taken.'); }
    }).finally(() => { this.summaryRunning = undefined; });
    return this.summaryRunning;
  }
  sendTest(credentialId: string): Promise<PushTestResult> {
    if (this.closing) return Promise.resolve({status: 'unavailable'});
    return this.serial(async () => {
      try {
        if (this.closing) return {status: 'unavailable'};
        const at = this.now().getTime();
        for (const [id, expires] of this.nextTestAt) if (expires <= at) this.nextTestAt.delete(id);
        const expires = this.nextTestAt.get(credentialId);
        if (expires !== undefined) return {status: 'rate-limited', retryAfterSeconds: Math.ceil((expires - at) / 1000)};
        this.nextTestAt.set(credentialId, at + PUSH_TEST_INTERVAL_MS);
        const result = await this.deliver({kind: 'test', title: 'Pulse test notification', body: 'Notifications are ready on this device.', path: '/morning', day: ukToday(this.now())}, credentialId);
        return result.sent ? {status: 'sent', ...result} : {status: 'unavailable'};
      } catch { this.log('Test push failed.'); return {status: 'unavailable'}; }
    });
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.then(() => {}, () => {});
    return result;
  }
  private now(): Date { return this.options.clock?.() ?? new Date(); }
  private log(line: string): void {
    try { if (this.options.log) this.options.log(line); else console.error(line); }
    catch { /* A diagnostic must not reject a delivery or stop the minute timer. */ }
  }
  private async deliver(payload: PushPayload, credentialId?: string): Promise<{sent: number; failed: number; gone: number}> {
    const subscriptions = await readPushSubscriptions(this.db, credentialId);
    const counts = {sent: 0, failed: 0, gone: 0};
    let keys: ReturnType<typeof readPushKeyPair> | undefined;
    for (const subscription of subscriptions) {
      if (this.closing) break;
      // Sign-out or replacement may have revoked a device since this batch was read.
      if (!(await readPushSubscriptions(this.db, subscription.credentialId)).some(row => row.endpoint === subscription.endpoint
        && row.keys.auth === subscription.keys.auth && row.keys.p256dh === subscription.keys.p256dh && row.createdAt === subscription.createdAt)) continue;
      const result = await sendPush(subscription, payload, {...this.options, getKeys: () => keys ??= readPushKeyPair(this.db)});
      counts[result.outcome]++;
      try { await recordPushResult(this.db, subscription, result, this.now()); }
      catch { this.log('Push delivery result could not be saved.'); }
    }
    return counts;
  }
}
