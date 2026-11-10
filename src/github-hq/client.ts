import { appConfig } from '../config.js';

export const HQ_BODY_LIMIT = 4 * 1024 * 1024;
export const HQ_TIMEOUT_MS = 10_000;
export type HQTarget = {kind: 'month'; month: string; ref: 'main' | 'claude/ads-daily'} | {kind: 'register'};
export type HQReadResult = {status: 'modified'; text: string; etag: string | null}
  | {status: 'not-modified'; etag: string | null};
export type HQErrorCode = 'target' | 'timeout' | 'network' | 'http' | 'denied' | 'not_found' | 'redirect'
  | 'rate_limit' | 'too_large' | 'invalid' | 'unreadable' | 'storage';
export class HQReadError extends Error {
  constructor(readonly code: HQErrorCode, readonly status = 0, readonly retryAfterMs = 0) { super(`HQ read failed (${code}).`); }
}
export interface HQRequestLog {status: number; requestId: string | null; attempt: number; code?: HQErrorCode}
export interface HQClientOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutSignal?: (ms: number) => AbortSignal;
  log?: (entry: HQRequestLog) => void;
}

/** The only paths this reader can construct, including for untyped runtime callers. */
export function hqTargetInfo(target: HQTarget): {key: string; path: string; ref: 'main' | 'claude/ads-daily'} {
  if (!target || typeof target !== 'object' || Array.isArray(target)) throw new HQReadError('target');
  const keys = Object.keys(target).sort().join(',');
  if (target.kind === 'register' && keys === 'kind') return {key: 'register', path: 'ops/tests/register.md', ref: 'main'};
  if (target.kind === 'month' && keys === 'kind,month,ref' && typeof target.month === 'string'
    && /^(?!0000)\d{4}-(?:0[1-9]|1[0-2])$/.test(target.month) && ['main', 'claude/ads-daily'].includes(target.ref)) {
    return {key: `month:${target.month}:${target.ref}`, path: `ops/ads-daily/${target.month}.md`, ref: target.ref};
  }
  throw new HQReadError('target');
}

function safeEtag(value: string | null | undefined): string | null {
  return value && value.length <= 1024 && !/[\x00-\x1f\x7f]/.test(value) ? value : null;
}
function aborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new HQReadError('timeout'));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new HQReadError('timeout'));
    signal.addEventListener('abort', abort, {once: true});
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
async function boundedText(response: Response, signal: AbortSignal): Promise<string> {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > HQ_BODY_LIMIT) {
    void response.body?.cancel().catch(() => {}); throw new HQReadError('too_large');
  }
  if (!response.body) return '';
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const result = await aborted(reader.read(), signal);
      if (result.done) break;
      size += result.value.byteLength;
      if (size > HQ_BODY_LIMIT) throw new HQReadError('too_large');
      chunks.push(result.value);
    }
    try { return new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks, size)); }
    catch { throw new HQReadError('invalid'); }
  } catch (error) {
    void reader.cancel().catch(() => {});
    if (error instanceof HQReadError) throw error;
    throw new HQReadError(signal.aborted ? 'timeout' : 'network');
  } finally { reader.releaseLock(); }
}
function rateWait(response: Response): number {
  const value = response.headers.get('retry-after'), numeric = Number(value);
  const retry = value ? Number.isFinite(numeric) ? numeric * 1000 : Date.parse(value) - Date.now() : 0;
  const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000 - Date.now();
  return Math.max(0, Number.isFinite(retry) ? retry : 0,
    response.headers.get('x-ratelimit-remaining') === '0' && Number.isFinite(reset) ? reset : 0);
}

export class HQClient {
  private readonly token: string;
  private readonly fetcher: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  constructor(token: string, private readonly options: HQClientOptions = {}) {
    this.token = token.trim();
    this.fetcher = options.fetch ?? fetch;
    this.sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  }
  async read(target: HQTarget, options: {etag?: string | null} = {}): Promise<HQReadResult> {
    const info = hqTargetInfo(target), {owner, repository} = appConfig.github;
    if (!this.token) throw new HQReadError('denied');
    const url = new URL(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/contents/${info.path}`);
    url.searchParams.set('ref', info.ref);
    for (let attempt = 1; attempt <= 4; attempt++) {
      const signal = this.options.timeoutSignal?.(HQ_TIMEOUT_MS) ?? AbortSignal.timeout(HQ_TIMEOUT_MS);
      let status = 0, requestId: string | null = null;
      try {
        const etag = safeEtag(options.etag);
        const response = await aborted(this.fetcher(url, {method: 'GET', redirect: 'error', signal,
          headers: {Accept: 'application/vnd.github.raw+json', Authorization: `Bearer ${this.token}`,
            'X-GitHub-Api-Version': '2022-11-28', ...(etag ? {'If-None-Match': etag} : {})}}), signal);
        status = response.status;
        const id = response.headers.get('x-github-request-id');
        requestId = id && /^[A-Za-z0-9:-]{1,100}$/.test(id) && !id.includes(this.token) ? id : null;
        const nextEtag = safeEtag(response.headers.get('etag'));
        if (status === 304) { this.log({status, requestId, attempt}); return {status: 'not-modified', etag: nextEtag ?? etag}; }
        if (!response.ok) {
          void response.body?.cancel().catch(() => {});
          const wait = rateWait(response);
          throw new HQReadError(status === 429 || status === 403 && (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after')) ? 'rate_limit'
            : status === 401 || status === 403 ? 'denied' : status === 404 ? 'not_found' : status >= 300 && status < 400 ? 'redirect' : 'http', status, wait);
        }
        const text = await boundedText(response, signal);
        this.log({status, requestId, attempt}); return {status: 'modified', text, etag: nextEtag};
      } catch (error) {
        const safe = error instanceof HQReadError ? error : new HQReadError(signal.aborted ? 'timeout' : 'network');
        this.log({status, requestId, attempt, code: safe.code});
        const retry = ['network', 'timeout', 'rate_limit'].includes(safe.code) || safe.code === 'http' && safe.status >= 500;
        // Long rate-limit waits belong to the background scheduler, never a request or shutdown.
        if (!retry || attempt === 4 || safe.retryAfterMs > 60_000) throw safe;
        await this.sleep(Math.max(250 * 2 ** (attempt - 1), safe.retryAfterMs));
      }
    }
    throw new HQReadError('http');
  }
  private log(entry: HQRequestLog): void {
    try {
      if (this.options.log) this.options.log(entry);
      else console.info(`GitHub HQ read ${entry.status} (${entry.requestId ?? 'no request id'}, attempt ${entry.attempt}${entry.code ? `, ${entry.code}` : ''}).`);
    } catch { /* Diagnostics must never make a successful read fail. */ }
  }
}
