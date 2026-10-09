import { AdError, type AdSource } from './model.js';
export interface AdTransportOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  beforeGoogleRead?: () => Promise<void>;
  log?: (entry: { source: AdSource; requestId: string | null; status: number }) => void;
}
export class AdTransport {
  private pending: Promise<unknown> = Promise.resolve();
  private readonly fetcher: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private next = 0;
  constructor(
    private readonly source: AdSource,
    private readonly options: AdTransportOptions = {},
  ) {
    this.fetcher = options.fetch ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }
  // Kept inside the spend adapters. They expose only their fixed read operations.
  request(url: string, init: RequestInit = {}): Promise<any> {
    const run = this.pending.then(() => this.send(url, init));
    this.pending = run.catch(() => {});
    return run;
  }
  private async send(url: string, init: RequestInit): Promise<any> {
    for (let attempt = 0; attempt <= 3; attempt++) {
      const now = this.options.now ?? Date.now;
      await this.sleep(Math.max(0, this.next - now()));
      try {
        if (this.source === 'google-ads' && url.startsWith('https://googleads.googleapis.com/'))
          await this.options.beforeGoogleRead?.();
        const response = await this.fetcher(url, {
          ...init,
          signal: AbortSignal.timeout(10_000),
          redirect: 'error',
        });
        this.next = now() + 250; // Serial, at most four requests/second per source.
        const id =
          response.headers.get('x-fb-trace-id') ??
          response.headers.get('request-id') ??
          response.headers.get('x-tt-logid');
        this.options.log?.({
          source: this.source,
          requestId: id && /^[\w-]{1,100}$/.test(id) ? id : null,
          status: response.status,
        });
        const remaining = Number(response.headers.get('x-ratelimit-remaining') ?? 1);
        if (remaining === 0) this.next = now() + 60_000;
        if (this.source === 'meta') {
          try {
            const usage = JSON.parse(
              response.headers.get('x-business-use-case-usage') ?? '{}',
            ) as Record<string, any[]>;
            if (
              Object.values(usage)
                .flat()
                .some(
                  (u) => Math.max(u.call_count ?? 0, u.total_cputime ?? 0, u.total_time ?? 0) >= 80,
                )
            )
              this.next = now() + 60_000;
          } catch {}
        }
        const body = (await response.json()) as any;
        if (
          response.status === 429 ||
          body?.code === 40100 ||
          [4, 17, 32, 613].includes(body?.error?.code)
        ) {
          const retry = Number(response.headers.get('retry-after') ?? 1);
          this.next = now() + Math.max(1000, Number.isFinite(retry) ? retry * 1000 : 1000);
          throw new AdError('rate_limit', 429);
        }
        if (!response.ok || body?.error || (typeof body?.code === 'number' && body.code !== 0)) {
          const developer = JSON.stringify(body?.error?.details ?? []).includes('DEVELOPER_TOKEN');
          throw new AdError(
            developer
              ? 'developer_token_required'
              : response.status === 401 || response.status === 403
                ? 'unauthorized'
                : 'http',
            response.status,
          );
        }
        return body;
      } catch (error) {
        const safe = error instanceof AdError ? error : new AdError('timeout');
        if (
          attempt === 3 ||
          safe.code === 'unauthorized' ||
          safe.code === 'developer_token_required' ||
          (safe.code === 'rate_limit' && safe.status === 0) ||
          (safe.status >= 400 && safe.status < 500 && safe.status !== 429)
        )
          throw safe;
        await this.sleep(250 * 2 ** attempt);
      }
    }
    throw new AdError('http');
  }
}
