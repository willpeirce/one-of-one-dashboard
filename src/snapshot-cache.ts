export interface SnapshotCacheOptions {
  now?: () => number;
  ttlMs?: number;
  onBuilt?: () => void | Promise<void>;
  log?: (line: string) => void;
}

/** Last-good observations only. Request-owned state must be projected after this cache. */
export class SnapshotCache<T> {
  private value?: T;
  private hasValue = false;
  private builtAt = -Infinity;
  private retryAt = -Infinity;
  private requested = 0;
  private completed = -1;
  private running?: Promise<void>;
  private timer?: ReturnType<typeof setInterval>;
  private closing = false;
  private lastError: unknown = new Error('Snapshot is unavailable.');
  private readonly now: () => number;
  private readonly ttlMs: number;
  constructor(private readonly build: () => Promise<T>,private readonly options: SnapshotCacheOptions = {}) {
    this.now = options.now ?? (() => performance.now());
    this.ttlMs = options.ttlMs ?? 60_000;
  }
  async read(): Promise<T> {
    if (!this.hasValue) {
      await this.run();
      if (!this.hasValue) throw this.lastError;
    } else if (!this.running && this.now() >= this.retryAt
      && (this.completed < this.requested || this.now() - this.builtAt >= this.ttlMs)) {
      if (this.completed === this.requested) this.requested++;
      void this.run();
    }
    return this.value!;
  }
  invalidate(): Promise<void> {
    if (this.closing) return Promise.resolve();
    this.requested++;
    return this.run();
  }
  start(): void {
    if (this.timer || this.closing) return;
    void this.run();
    this.timer = setInterval(() => {
      if (!this.running && this.now() >= this.retryAt && this.now() - this.builtAt >= this.ttlMs) {
        this.requested++; void this.run();
      }
    },Math.min(this.ttlMs,5_000));
    this.timer.unref?.();
  }
  async stop(): Promise<void> {
    this.closing = true;
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }
  private run(): Promise<void> {
    if (this.running) return this.running;
    if (this.closing) return Promise.resolve();
    this.running = Promise.resolve().then(async () => {
      do {
        const generation = this.requested;
        try {
          const value = await this.build();
          this.value = value; this.hasValue = true; this.builtAt = this.now(); this.retryAt = -Infinity;
          this.completed = generation;
          try { await this.options.onBuilt?.(); } catch { this.log('Snapshot notification failed.'); }
        } catch (error) {
          this.lastError = error; this.retryAt = this.now() + this.ttlMs;
          this.log('Snapshot rebuild failed; keeping the last good observations.');
          break;
        }
      } while (!this.closing && this.completed < this.requested);
    }).finally(() => { this.running = undefined; });
    return this.running;
  }
  private log(line: string): void {
    try { if (this.options.log) this.options.log(line); else console.error(line); } catch { /* Diagnostics cannot stop background work. */ }
  }
}
