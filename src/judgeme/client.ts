import { appConfig } from '../config.js';
import { cleanReview, type Review } from './model.js';

const MAX_RETRY_AFTER_MS = 60_000;
export interface ReviewRead { rows: Review[]; unreadCount: number }
type ReadCode = 'http' | 'network' | 'invalid' | 'pagination';
export class JudgeMeReadError extends Error {
  constructor(readonly code: ReadCode, readonly status: number = 0) { super(`Judge.me read failed (${code}, ${status}).`); }
}
export interface JudgeMeClientOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  log?: (entry: { status: number; code: ReadCode }) => void;
}

/** Judge.me v1 GET only. No caller-controlled URL, write operation or raw response escapes. */
export class JudgeMeClient {
  #token: string;
  #fetch: typeof fetch;
  #sleep: (ms: number) => Promise<void>;
  constructor(token: string, private readonly options: JudgeMeClientOptions = {}) {
    this.#token = token;
    this.#fetch = options.fetch ?? fetch;
    this.#sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  }
  async reviews(): Promise<ReviewRead> {
    const rows = new Map<string, Review>();
    let unreadCount = 0;
    for (let page = 1; page <= 1000; page++) {
      const result = await this.#page(page);
      const before = rows.size;
      unreadCount += result.unreadCount;
      for (const row of result.rows) rows.set(row.id, row);
      // Skipped rows still occupy a page slot; never truncate the next page.
      if (result.rowCount < 100) return { rows: [...rows.values()], unreadCount };
      if (rows.size === before && result.unreadCount === 0) throw new JudgeMeReadError('pagination');
      await this.#sleep(1000); // Serial reads; avoid bursts and respect Retry-After below.
    }
    throw new JudgeMeReadError('pagination');
  }
  async #page(page: number): Promise<ReviewRead & { rowCount: number }> {
    for (let attempt = 0; attempt <= 3; attempt++) {
      let failure = new JudgeMeReadError('network'), retryAfter = 0;
      try {
        const url = new URL('https://api.judge.me/api/v1/reviews');
        url.search = new URLSearchParams({ api_token: this.#token, shop_domain: appConfig.shopify.storeDomain,
          page: String(page), per_page: '100' }).toString();
        const response = await this.#fetch(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10_000) });
        if (!response.ok) {
          failure = new JudgeMeReadError('http', response.status);
          const retry = response.headers.get('retry-after');
          if (retry) retryAfter = /^\d+$/.test(retry) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - Date.now());
        } else {
          try {
            const body = await response.json() as { reviews?: unknown; current_page?: unknown };
            if (!Array.isArray(body.reviews) || body.current_page !== page) throw new Error('Invalid page');
            const rows: Review[] = [];
            let unreadCount = 0;
            for (const input of body.reviews) {
              const row = cleanReview(input);
              if (row) rows.push(row);
              else unreadCount++;
            }
            return { rows, unreadCount, rowCount: body.reviews.length };
          } catch { failure = new JudgeMeReadError('invalid', response.status); }
        }
      } catch { /* Fetch errors can contain the full credential-bearing URL. Discard them. */ }
      this.options.log?.({ status: failure.status, code: failure.code });
      if (attempt === 3 || (failure.code === 'http' && failure.status < 500 && failure.status !== 429)) throw failure;
      await this.#sleep(Math.min(MAX_RETRY_AFTER_MS, Math.max(Number.isNaN(retryAfter) ? 0 : retryAfter, 1000 * 2 ** attempt)));
    }
    throw new JudgeMeReadError('network');
  }
}
