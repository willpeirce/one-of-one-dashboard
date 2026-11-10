import type { Database } from '../db.js';
import { addDays, ukToday } from '../hero-range.js';
import { HQClient, HQReadError, hqTargetInfo, type HQClientOptions, type HQTarget } from './client.js';
import { parseMonth } from './parse-month.js';
import { parseRegister } from './parse-register.js';
import { beginHQRead, failHQRead, hqRateLimited, readHQReports, readHQSync, saveHQMonth, saveHQRegister, touchHQRead, type HQSync } from './store.js';

export const HQ_HOURLY_MS = 60 * 60_000;
export const HQ_MORNING_MS = 10 * 60_000;
export interface HQWorkerOptions extends HQClientOptions { clock?: () => Date }
const ukClock = new Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});
export function hqMonthInterval(now: Date, foundYesterday: boolean): number {
  const time = ukClock.format(now);
  return !foundYesterday && time >= '07:30' && time < '09:30' ? HQ_MORNING_MS : HQ_HOURLY_MS;
}
const good = (job: HQSync | undefined): boolean => !!job?.parsedAvailable && job.readable && job.errorCode === null
  && !!job.lastSuccessAt && job.lastSuccessAt === job.lastAttemptAt;
function due(job: HQSync | undefined, now: Date, interval: number): boolean {
  if (job?.retryAfterAt && Date.parse(job.retryAfterAt) > now.getTime()) return false;
  return !job?.lastAttemptAt || now.getTime() - Date.parse(job.lastAttemptAt) >= interval;
}

/** No constructor/initialization read: the app calls start only after listen resolves. */
export class HQWorker {
  readonly mode: 'sample' | 'live';
  private readonly client?: HQClient;
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private closing = false;
  constructor(private readonly db: Database, env: NodeJS.ProcessEnv, private readonly options: HQWorkerOptions = {}) {
    this.mode = env.GITHUB_HQ_TOKEN?.trim() ? 'live' : 'sample';
    if (this.mode === 'live') this.client = new HQClient(env.GITHUB_HQ_TOKEN!, options);
  }
  start(): void {
    if (!this.client || this.timer || this.closing) return;
    void this.tick();
    this.timer = setInterval(() => { void this.tick(); }, 60_000); this.timer.unref();
  }
  tick(): Promise<void> {
    if (!this.client || this.closing) return Promise.resolve();
    if (!this.running) this.running = this.run().catch(async () => {
      console.error('GitHub HQ worker failed (storage).');
      const now = this.options.clock?.() ?? new Date();
      await this.db.query(`UPDATE pulse.source_health SET status='error',last_attempt_at=$1,
        consecutive_failures=consecutive_failures+1,updated_at=$1 WHERE source='github-hq' AND mode='live'`, [now]).catch(() => {});
    }).finally(() => { this.running = undefined; });
    return this.running;
  }
  async stop(): Promise<void> { this.closing = true; if (this.timer) clearInterval(this.timer); await this.running; }
  private async read(target: HQTarget, previous: HQSync | undefined, now: Date): Promise<void> {
    await beginHQRead(this.db, target, now);
    try {
      const result = await this.client!.read(target, {etag: previous?.etag});
      if (result.status === 'not-modified') await touchHQRead(this.db, target, result.etag, now);
      else if (target.kind === 'month') await saveHQMonth(this.db, target, parseMonth(result.text), result.etag, now);
      else {
        const parsed = parseRegister(result.text);
        await saveHQRegister(this.db, parsed, result.etag, now);
        if (!parsed.readable) throw new HQReadError('unreadable');
      }
    } catch (error) {
      const safe = error instanceof HQReadError ? error : new HQReadError('storage');
      await failHQRead(this.db, target, safe, now);
    }
  }
  private async run(): Promise<void> {
    const now = this.options.clock?.() ?? new Date(), day = addDays(ukToday(now), -1), month = day.slice(0, 7);
    if (await hqRateLimited(this.db, now)) {
      await this.db.query(`UPDATE pulse.source_health SET status='error',consecutive_failures=GREATEST(consecutive_failures,1),
        updated_at=$1 WHERE source='github-hq' AND mode='live'`, [now]);
      return;
    }
    const main: HQTarget = {kind: 'month', month, ref: 'main'}, branch: HQTarget = {kind: 'month', month, ref: 'claude/ads-daily'}, register: HQTarget = {kind: 'register'};
    const targets = [main, branch, register];
    let reads = await readHQSync(this.db, targets), reports = await readHQReports(this.db, day), attempted = false;
    const mainKey = hqTargetInfo(main).key, branchKey = hqTargetInfo(branch).key;
    if (due(reads.get(mainKey), now, hqMonthInterval(now, reports.length > 0))) {
      attempted = true; await this.read(main, reads.get(mainKey), now);
      reads = await readHQSync(this.db, targets); reports = await readHQReports(this.db, day);
      const mainRead = reads.get(mainKey);
      if (!this.closing && (good(mainRead) && !reports.some(report => report.ref === 'main') || mainRead?.errorCode === 'not_found')
        && ![...reads.values()].some(row => row.retryAfterAt && Date.parse(row.retryAfterAt) > now.getTime())) {
        await this.read(branch, reads.get(branchKey), now);
        reads = await readHQSync(this.db, targets);
      }
    }
    if (!this.closing && ![...reads.values()].some(row => row.retryAfterAt && Date.parse(row.retryAfterAt) > now.getTime())
      && due(reads.get('register'), now, HQ_HOURLY_MS)) {
      attempted = true; await this.read(register, reads.get('register'), now);
    }
    reads = await readHQSync(this.db, targets); reports = await readHQReports(this.db, day);
    const mainRead = reads.get(mainKey), branchRead = reads.get(branchKey), registerRead = reads.get('register');
    const mainHasReport = reports.some(report => report.ref === 'main');
    const monthOk = good(mainRead) && (mainHasReport || good(branchRead) || branchRead?.errorCode === 'not_found')
      || mainRead?.errorCode === 'not_found' && good(branchRead);
    const healthy = monthOk && good(registerRead);
    const monthSuccess = good(mainRead) ? mainRead!.lastSuccessAt : good(branchRead) ? branchRead!.lastSuccessAt : null;
    const successAt = healthy && monthSuccess && registerRead?.lastSuccessAt
      ? [monthSuccess, registerRead.lastSuccessAt].sort()[0]! : null;
    const lastAttempt = [...reads.values()].map(row => row.lastAttemptAt).filter((value): value is string => !!value).sort().at(-1) ?? now.toISOString();
    // Restore a persisted healthy/error state after syncSourceHealth resets implemented live sources on startup.
    await this.db.query(`UPDATE pulse.source_health SET status=$1,last_attempt_at=$2,
      last_success_at=COALESCE($3,last_success_at),consecutive_failures=CASE WHEN $1='healthy' THEN 0
        WHEN $4 THEN consecutive_failures+1 ELSE GREATEST(consecutive_failures,1) END,updated_at=$5
      WHERE source='github-hq' AND mode='live'`, [healthy ? 'healthy' : 'error', lastAttempt, successAt, attempted, now]);
  }
}
