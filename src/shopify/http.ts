export class ShopifyError extends Error {
  constructor(readonly code: 'http' | 'unauthorized' | 'denied' | 'graphql' | 'invalid' | 'timeout', readonly status = 0) {
    super(`Shopify request failed (${code}).`);
  }
}
export interface TransportOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (entry: { source: 'shopify'; requestId: string | null; status: number }) => void;
}
export class Transport {
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  private readonly fetcher: typeof fetch;
  private availableAt = 0;
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private readonly options: TransportOptions = {}) {
    this.fetcher = options.fetch ?? fetch;
    this.sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
    this.now = options.now ?? Date.now;
  }
  request(url: string, init: RequestInit): Promise<any> {
    const next = this.pending.then(() => this.send(url, init));
    this.pending = next.catch(() => {});
    return next;
  }
  private async send(url: string, init: RequestInit): Promise<any> {
    for (let attempt = 0; attempt <= 3; attempt++) {
      await this.sleep(Math.max(0, this.availableAt - this.now()));
      try {
        const response = await this.fetcher(url, { ...init, signal: AbortSignal.timeout(10_000), redirect: 'error' });
        const requestId = response.headers.get('x-request-id') ?? response.headers.get('x-github-request-id');
        this.options.log?.({ source: 'shopify', requestId: requestId && /^[a-zA-Z0-9-]{1,100}$/.test(requestId) ? requestId : null, status: response.status });
        if (response.status === 401) throw new ShopifyError('unauthorized', 401);
        if (response.status === 403) throw new ShopifyError('denied', 403);
        if (response.status === 429) {
          const retry = response.headers.get('retry-after');
          const seconds = Number(retry);
          const delay = retry && Number.isFinite(seconds) ? seconds * 1000 : Math.max(0, Date.parse(retry ?? '') - this.now());
          this.availableAt = this.now() + (Number.isFinite(delay) ? Math.max(1000, delay) : 1000);
          throw new ShopifyError('http', 429);
        }
        if (!response.ok) throw new ShopifyError('http', response.status);
        const body = await response.json() as any;
        const cost = body.extensions?.cost;
        const throttle = cost?.throttleStatus;
        if (throttle && throttle.restoreRate > 0) {
          this.availableAt = this.now() + Math.max(0, (cost.requestedQueryCost - throttle.currentlyAvailable) / throttle.restoreRate * 1000);
        }
        if (body.errors?.length) {
          if (body.errors.some((e: any) => e.extensions?.code === 'ACCESS_DENIED')) throw new ShopifyError('denied');
          if (body.errors.every((e: any) => e.extensions?.code === 'THROTTLED')) throw new ShopifyError('http', 429);
          throw new ShopifyError('graphql');
        }
        return body;
      } catch (error) {
        const safe = error instanceof ShopifyError ? error : new ShopifyError('timeout');
        if (attempt === 3 || ['unauthorized', 'denied', 'graphql', 'invalid'].includes(safe.code) || (safe.status >= 400 && safe.status < 500 && safe.status !== 429)) throw safe;
        await this.sleep(250 * 2 ** attempt);
      }
    }
    throw new ShopifyError('http');
  }
}
