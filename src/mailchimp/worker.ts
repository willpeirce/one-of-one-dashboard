import type { Database } from '../db.js';
import { appConfig } from '../config.js';
import { MailchimpClient, MailchimpReadError, type MailchimpClientOptions } from './client.js';
import { MAILCHIMP_POLL_MS } from './model.js';
import { mailchimpNextRun, recordMailchimpFailure, restoreMailchimpHealth, saveMailchimpAudience } from './store.js';

export interface MailchimpWorkerOptions extends MailchimpClientOptions { clock?: () => Date }

export class MailchimpWorker {
  readonly mode: 'sample' | 'live';
  #client: MailchimpClient | undefined;
  #run: Promise<void> | undefined;
  #timer: ReturnType<typeof setInterval> | undefined;
  #next = 0;
  #restoredHealth = false;
  constructor(private readonly db: Database, env: NodeJS.ProcessEnv, private readonly options: MailchimpWorkerOptions = {}) {
    this.mode = env.MAILCHIMP_API_KEY?.trim() ? 'live' : 'sample';
    if (this.mode === 'live') this.#client = new MailchimpClient(env.MAILCHIMP_API_KEY!, {...options,
      now: options.now ?? (options.clock ? () => options.clock!().getTime() : Date.now)});
  }
  // Only start after listen. Source failures are contained here and never reject a worker tick.
  start(): void {
    if (this.#timer || !this.#client) return;
    void this.tick();
    this.#timer = setInterval(() => { void this.tick(); }, 60_000);
    this.#timer.unref();
  }
  tick(): Promise<void> {
    if (this.#run) return this.#run;
    const now = this.options.clock?.() ?? new Date();
    if (!this.#client || now.getTime() < this.#next) return Promise.resolve();
    this.#run = (async () => {
      try {
        if (!this.#restoredHealth) {
          await restoreMailchimpHealth(this.db, now);
          this.#restoredHealth = true;
        }
        // Persisted deferrals survive restarts, including Retry-After longer than a poll period.
        this.#next = Math.max(this.#next, await mailchimpNextRun(this.db));
        if (now.getTime() < this.#next) return;
        this.#next = now.getTime() + MAILCHIMP_POLL_MS;
        const result = await this.#client!.audience();
        if (result.data.id !== appConfig.mailchimp.listId) throw new MailchimpReadError('invalid', 200);
        const finishedAt = this.options.clock?.() ?? new Date();
        this.#next = finishedAt.getTime() + MAILCHIMP_POLL_MS;
        await saveMailchimpAudience(this.db, result.data, finishedAt, new Date(this.#next));
      } catch (error) {
        const code = error instanceof MailchimpReadError ? error.code : 'storage';
        const status = error instanceof MailchimpReadError ? error.status : 0;
        this.#next = Math.max(this.#next, now.getTime() + MAILCHIMP_POLL_MS, error instanceof MailchimpReadError ? error.retryAt ?? 0 : 0);
        console.error(`Mailchimp audience read failed (status: ${status}, code: ${code}).`);
        await recordMailchimpFailure(this.db, now, new Date(this.#next), code)
          .catch(() => { console.error('Mailchimp health update failed (code: storage).'); });
      }
    })().finally(() => { this.#run = undefined; });
    return this.#run;
  }
  async stop(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
    await this.#run;
  }
}
