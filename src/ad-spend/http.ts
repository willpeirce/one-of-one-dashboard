import { AdError, type AdSource } from './model.js';
export type AdRequestLogEntry = {
  source: AdSource; requestId: string | null; status: number;
  providerCode?: number; providerSubcode?: number;
  timeoutMs?: never; attempt?: never; maxAttempts?: never;
} | {
  source: AdSource; requestId: null; status: 0;
  timeoutMs: number; attempt: number; maxAttempts: number;
  providerCode?: never; providerSubcode?: never;
};

export function adRequestLogLine(entry: AdRequestLogEntry): string {
  if (entry.timeoutMs !== undefined)
    return `Ad spend ${entry.source} request timed out after ${entry.timeoutMs / 1000} s (attempt ${entry.attempt} of ${entry.maxAttempts}).`;
  const provider = entry.providerCode === undefined ? ''
    : `, ${entry.source === 'google-ads' ? 'google' : entry.source} ${entry.providerCode}${entry.providerSubcode === undefined ? '' : `/${entry.providerSubcode}`}`;
  return `Ad spend ${entry.source} request ${entry.status} (${entry.requestId ?? 'no request id'})${provider}.`;
}

export interface AdTransportOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  beforeGoogleRead?: () => Promise<void>;
  timeoutSignal?: (timeoutMs: number) => AbortSignal;
  log?: (entry: AdRequestLogEntry) => void;
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
  request(url: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<any> {
    const run = this.pending.then(() => this.send(url, init, timeoutMs));
    this.pending = run.catch(() => {});
    return run;
  }
  private async send(url: string, init: RequestInit, timeoutMs: number): Promise<any> {
    for (let attempt = 0; attempt <= 3; attempt++) {
      const now = this.options.now ?? Date.now;
      await this.sleep(Math.max(0, this.next - now()));
      try {
        if (this.source === 'google-ads' && url.startsWith('https://googleads.googleapis.com/'))
          await this.options.beforeGoogleRead?.();
        const signal = this.options.timeoutSignal?.(timeoutMs) ?? AbortSignal.timeout(timeoutMs);
        const logTimeout = () => this.options.log?.({ source: this.source, requestId: null,
          status: 0, timeoutMs, attempt: attempt + 1, maxAttempts: 4 });
        let response: Response;
        try {
          response = await this.fetcher(url, { ...init, signal, redirect: 'error' });
        } catch {
          logTimeout();
          throw new AdError('timeout');
        }
        this.next = now() + 250; // Serial, at most four requests/second per source.
        const id =
          response.headers.get('x-fb-trace-id') ??
          response.headers.get('request-id') ??
          response.headers.get('x-tt-logid');
        const logResponse = (body?: any) => {
          const safe = new AdError('http', response.status,
            this.source === 'tiktok' ? body?.code === 0 ? undefined : body?.code : body?.error?.code,
            this.source === 'meta' ? body?.error?.error_subcode : undefined);
          this.options.log?.({ source: this.source,
            requestId: id && /^[\w-]{1,100}$/.test(id) ? id : null, status: response.status,
            ...(safe.providerCode === undefined ? {} : { providerCode: safe.providerCode }),
            ...(safe.providerSubcode === undefined ? {} : { providerSubcode: safe.providerSubcode }) });
        };
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
        let body: any;
        try {
          body = await response.json();
        } catch {
          logResponse();
          if (signal.aborted) {
            throw new AdError('timeout');
          }
          throw new AdError(response.ok ? 'invalid' : 'http', response.status);
        }
        logResponse(body);
        const providerCode = this.source === 'tiktok' ? body?.code : body?.error?.code,
          providerSubcode = this.source === 'meta' ? body?.error?.error_subcode : undefined;
        if (
          response.status === 429 ||
          body?.code === 40100 ||
          [4, 17, 32, 613, 80000, 80004].includes(body?.error?.code)
        ) {
          const retry = Number(response.headers.get('retry-after') ?? 1);
          this.next = now() + Math.max(1000, Number.isFinite(retry) ? retry * 1000 : 1000);
          throw new AdError('rate_limit', response.status, providerCode, providerSubcode);
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
            providerCode,
            providerSubcode,
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
          (safe.code !== 'rate_limit' && safe.status >= 400 && safe.status < 500 && safe.status !== 429)
        )
          throw safe;
        await this.sleep(250 * 2 ** attempt);
      }
    }
    throw new AdError('http');
  }
}
