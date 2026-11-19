import type {Database} from '../db.js';
import {readSettings} from '../settings.js';
import {GorgiasClient, GorgiasReadError, gorgiasCredentials, type GorgiasClientOptions, type GorgiasReader} from './client.js';
import {GORGIAS_POLL_MS, GORGIAS_TAG_POLL_MS, gorgiasPollMs, gorgiasWeekStart} from './model.js';
import {gorgiasScope, gorgiasSource} from './scope.js';
import {readGorgiasIntentBackfillIds, readKnownGorgiasTickets, recordGorgiasFailure, restoreGorgiasHealth, saveGorgiasPoll} from './store.js';

export interface GorgiasWorkerOptions extends GorgiasClientOptions {
  clock?: () => Date;
  onWrite?: () => void | Promise<void>;
  reader?: GorgiasReader;
}
function logFailure(message: string): void {
  try { console.error(message); } catch { /* Diagnostics cannot reject a background tick. */ }
}

/** Construction performs no reads; start belongs after app.listen. */
export class GorgiasWorker {
  readonly mode: 'sample' | 'live';
  #reader?: GorgiasReader;
  #domain: string;
  #scope: string | null = null;
  #next = 0;
  #run?: Promise<void>;
  #timer?: ReturnType<typeof setInterval>;
  #closing = false;
  constructor(private readonly db: Database, env: NodeJS.ProcessEnv, private readonly options: GorgiasWorkerOptions = {}) {
    const source = gorgiasSource(env); this.mode = source.mode; this.#domain = source.domain;
    const credentials = gorgiasCredentials(env);
    if (credentials) this.#reader = options.reader ?? new GorgiasClient(credentials, {...options,
      now: options.now ?? (options.clock ? () => options.clock!().getTime() : Date.now)});
  }
  start(): void {
    if (!this.#reader || this.#timer || this.#closing) return;
    void this.tick();
    this.#timer = setInterval(() => { void this.tick(); }, GORGIAS_POLL_MS); this.#timer.unref();
  }
  tick(): Promise<void> {
    if (!this.#reader || this.#closing) return Promise.resolve();
    if (!this.#run) this.#run = this.poll().catch(() => { logFailure('Gorgias worker failed (code: unexpected).'); })
      .finally(() => { this.#run = undefined; });
    return this.#run;
  }
  async stop(): Promise<void> {
    this.#closing = true;
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
    await this.#run;
  }
  private async poll(): Promise<void> {
    const now = this.options.clock?.() ?? new Date(); let scope: string | null = null, interval = GORGIAS_TAG_POLL_MS;
    try {
      const settings = (await readSettings(this.db)).values;
      interval = gorgiasPollMs(settings);
      scope = gorgiasScope(this.#domain, settings);
      if (scope !== this.#scope) {
        const previous = await restoreGorgiasHealth(this.db, scope, now, settings);
        // Preserve rate-limit deferrals and apply the current cadence to older saved schedules.
        this.#scope = scope; this.#next = previous
          ? Math.max(Date.parse(previous.nextRunAt), Date.parse(previous.lastAttemptAt) + interval) : 0;
      }
      if (now.getTime() < this.#next) return;
      this.#next = now.getTime() + interval;
      const [knownTickets, intentBackfillIds] = await Promise.all([
        readKnownGorgiasTickets(this.db, scope), readGorgiasIntentBackfillIds(this.db, scope, now),
      ]);
      const result = await this.#reader!.readHandover({viewId: settings.gorgiasHandoverViewId, tag: settings.gorgiasHandoverTag,
        knownTickets, intentBackfillIds, weekStart: gorgiasWeekStart(now), asOf: now.toISOString()});
      const finishedAt = this.options.clock?.() ?? new Date();
      // Lock the Settings row through commit: a concurrent save cannot certify the previous selection as current.
      const saved = await saveGorgiasPoll(this.db, scope, result, {weekStart: gorgiasWeekStart(now), finishedAt, nextRun: new Date(this.#next),
        isCurrent: tx => this.isCurrent(tx, scope!)});
      if (!saved) {
        this.#scope = null; this.#next = 0; return;
      }
      await this.notify();
    } catch (error) {
      const code = error instanceof GorgiasReadError ? error.code : 'storage', status = error instanceof GorgiasReadError ? error.status : 0;
      this.#next = Math.max(this.#next, now.getTime() + interval,
        error instanceof GorgiasReadError && error.retryAt !== null ? error.retryAt : 0);
      logFailure(`Gorgias poll failed (status: ${status}, code: ${code}).`);
      try {
        if (scope) {
          const current = await recordGorgiasFailure(this.db, scope, now, new Date(this.#next), code,
            {isCurrent: tx => this.isCurrent(tx, scope!)});
          if (!current) { this.#scope = null; this.#next = 0; }
        }
        else await this.db.query(`UPDATE pulse.source_health SET status='error',last_attempt_at=$1,
          consecutive_failures=consecutive_failures+1,updated_at=$1 WHERE source='gorgias' AND mode='live'`, [now]);
      } catch { logFailure('Gorgias health update failed (code: storage).'); }
      await this.notify();
    }
  }
  private async notify(): Promise<void> {
    try { await this.options.onWrite?.(); }
    catch { logFailure('Gorgias dashboard refresh failed (code: notification).'); }
  }
  private async isCurrent(tx: Database, scope: string): Promise<boolean> {
    await tx.query('SELECT singleton FROM pulse.settings WHERE singleton=true FOR SHARE');
    return gorgiasScope(this.#domain, (await readSettings(tx, {seed: false})).values) === scope;
  }
}
