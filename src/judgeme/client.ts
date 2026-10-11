import { appConfig } from '../config.js';
import { cleanReview, type Review } from './model.js';

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
  async reviews(): Promise<Review[]> {
    const rows = new Map<string, Review>();
    for (let page = 1; page <= 1000; page++) {
      const result = await this.#page(page);
      const before = rows.size;
      for (const row of result) rows.set(row.id, row);
      if (result.length < 100) return [...rows.values()];
      if (rows.size === before) throw new JudgeMeReadError('pagination');
      await this.#sleep(1000); // Serial reads; avoid bursts and respect Retry-After below.
    }
    throw new JudgeMeReadError('pagination');
  }
  async #page(page: number): Promise<Review[]> {
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
            return body.reviews.map(cleanReview);
          } catch { failure = new JudgeMeReadError('invalid', response.status); }
        }
      } catch { /* Fetch errors can contain the full credential-bearing URL. Discard them. */ }
      this.options.log?.({ status: failure.status, code: failure.code });
      if (attempt === 3 || (failure.code === 'http' && failure.status < 500 && failure.status !== 429)) throw failure;
      await this.#sleep(Math.max(Number.isFinite(retryAfter) ? retryAfter : 0, 1000 * 2 ** attempt));
    }
    throw new JudgeMeReadError('network');
  }
}
