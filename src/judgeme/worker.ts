import type { Database } from '../db.js';
import { JudgeMeClient, JudgeMeReadError, type JudgeMeClientOptions } from './client.js';
import { saveReviews } from './store.js';

export const REVIEW_POLL_MS = 5 * 60_000;
export interface ReviewsWorkerOptions extends JudgeMeClientOptions { clock?: () => Date }
export class ReviewsWorker {
  readonly mode: 'sample' | 'live';
  #client: JudgeMeClient | undefined;
  #run: Promise<void> | undefined;
  #timer: ReturnType<typeof setInterval> | undefined;
  #next = 0;
  constructor(private readonly db: Database, env: NodeJS.ProcessEnv, private readonly options: ReviewsWorkerOptions = {}) {
    this.mode = env.JUDGEME_API_TOKEN?.trim() ? 'live' : 'sample';
    if (this.mode === 'live') this.#client = new JudgeMeClient(env.JUDGEME_API_TOKEN!, options);
  }
  // Called only after listen. A read cannot block startup or overlap the previous poll.
  start(): void {
    if (this.#timer || !this.#client) return;
    void this.tick();
    this.#timer = setInterval(() => { void this.tick(); }, REVIEW_POLL_MS);
    this.#timer.unref();
  }
  tick(): Promise<void> {
    if (this.#run) return this.#run;
    const now = this.options.clock?.() ?? new Date();
    if (!this.#client || now.getTime() < this.#next) return Promise.resolve();
    this.#next = now.getTime() + REVIEW_POLL_MS;
    this.#run = (async () => {
      try {
        const result = await this.#client!.reviews();
        await saveReviews(this.db, result.rows, now, result.unreadCount);
        if (result.unreadCount > 0) console.warn(`Judge.me: ${result.unreadCount} reviews could not be read.`);
      }
      catch (error) {
        const status = error instanceof JudgeMeReadError ? error.status : 0;
        const code = error instanceof JudgeMeReadError ? error.code : 'storage';
        // Never log an Error object: upstream errors may contain the token-bearing URL.
        console.error(`Judge.me poll failed (status: ${status}, code: ${code}).`);
        await this.db.query(`UPDATE pulse.source_health SET status = 'error', last_attempt_at = $1,
          consecutive_failures = consecutive_failures + 1, updated_at = $1 WHERE source = 'judgeme' AND mode = 'live'`, [now])
          .catch(() => { console.error('Judge.me health update failed (status: 0, code: storage).'); });
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
