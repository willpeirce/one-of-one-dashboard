import { setTimeout as delay } from 'node:timers/promises';
import { encryptPushPayload, MAX_PUSH_PAYLOAD_BYTES, vapidAuthorization, type RawPushKeyPair } from './crypto.js';
import { validatePushEndpoint, validatePushKeys, type PushSubscription } from './validation.js';

export interface PushPayload { title: string; body: string; path: string }
export interface PushTransportRequest {
  url: string; method: 'POST'; headers: Readonly<Record<string, string>>; body: Uint8Array;
  signal: AbortSignal; authorize: () => Promise<string>;
}
export interface PushTransportResponse { status: number; retryAfterMs?: number }
export type PushTransport = (request: PushTransportRequest) => Promise<PushTransportResponse>;
export type PushFailureCode = 'invalid_subscription' | 'invalid_payload' | 'configuration' | 'timeout' | 'network' | 'http';
export interface PushSendResult { outcome: 'sent' | 'gone' | 'failed'; attempts: number; status: number | null; code: PushFailureCode | null }
export interface PushSendOptions {
  origin: string; getKeys: () => Promise<RawPushKeyPair>; transport?: PushTransport;
  clock?: () => Date; sleep?: (ms: number) => Promise<void>; log?: (line: string) => void; timeoutMs?: number;
}
export const PUSH_RETRIES = 3;
export const PUSH_TIMEOUT_MS = 10_000;
export const MAX_PUSH_RETRY_DELAY_MS = 30_000;

class PushAttemptError extends Error {
  constructor(readonly code: 'configuration' | 'timeout') { super('Push delivery unavailable.'); }
}

function retryAfter(value: string | null, now: Date): number | undefined {
  if (!value) return undefined;
  const milliseconds = /^\d+$/u.test(value) ? Number(value) * 1_000 : Date.parse(value) - now.getTime();
  return Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : undefined;
}

// Only this private transport performs HTTP. The test transport never needs to materialize a signing token.
async function post(request: PushTransportRequest, clock: () => Date): Promise<PushTransportResponse> {
  const authorization = await request.authorize();
  request.signal.throwIfAborted();
  const response = await fetch(request.url, { method: 'POST', redirect: 'error', signal: request.signal,
    headers: { ...request.headers, Authorization: authorization }, body: new Uint8Array(request.body) });
  const result = { status: response.status, retryAfterMs: retryAfter(response.headers.get('retry-after'), clock()) };
  // No provider response body is needed, retained or logged.
  await response.body?.cancel().catch(() => {});
  return result;
}

function payloadBytes(payload: PushPayload): Uint8Array {
  if (!payload || typeof payload.title !== 'string' || !payload.title || typeof payload.body !== 'string'
    || typeof payload.path !== 'string' || !payload.path.startsWith('/') || payload.path.startsWith('//')
    || /[\u0000-\u0020\\]/u.test(payload.path)) throw new Error();
  const bytes = Buffer.from(JSON.stringify({ title: payload.title, body: payload.body, path: payload.path }));
  if (bytes.length > MAX_PUSH_PAYLOAD_BYTES) throw new Error();
  return bytes;
}

/** A bounded delivery never exposes raw errors and never changes source systems. */
export async function sendPush(subscription: PushSubscription, payload: PushPayload, options: PushSendOptions): Promise<PushSendResult> {
  let attempts = 0, status: number | null = null, provider = 'unknown';
  const failure = (code: PushFailureCode): PushSendResult => {
    try { (options.log ?? console.warn)(`Push delivery failed (code: ${code}; provider: ${provider}; status: ${status ?? 'unavailable'}).`); } catch { /* Logging cannot stop the worker. */ }
    return { outcome: 'failed', attempts, status, code };
  };
  let endpoint: URL, body: Buffer;
  try {
    endpoint = validatePushEndpoint(subscription?.endpoint);
    // The Windows subdomain is caller supplied and could contain private material.
    provider = endpoint.hostname === 'fcm.googleapis.com' ? 'google' : endpoint.hostname === 'web.push.apple.com' ? 'apple'
      : endpoint.hostname === 'updates.push.services.mozilla.com' ? 'mozilla' : 'windows';
    validatePushKeys(subscription?.keys);
  } catch { return failure('invalid_subscription'); }
  try { body = encryptPushPayload(payloadBytes(payload), subscription.keys); }
  catch { return failure('invalid_payload'); }
  const clock = options.clock ?? (() => new Date()), sleep = options.sleep ?? delay;
  const transport = options.transport ?? ((request: PushTransportRequest) => post(request, clock));
  const timeoutMs = Math.min(PUSH_TIMEOUT_MS, Math.max(1, options.timeoutMs ?? PUSH_TIMEOUT_MS));
  for (let index = 0; index <= PUSH_RETRIES; index++) {
    attempts++; status = null;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let code: PushFailureCode = 'network', providerDelay = 0;
    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new PushAttemptError('timeout')); }, timeoutMs);
      });
      const response = await Promise.race([timeout, Promise.resolve().then(() => transport({
        url: endpoint.href, method: 'POST', body, signal: controller.signal,
        headers: { TTL: '3600', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', Urgency: 'normal' },
        authorize: async () => {
          try { return vapidAuthorization(await options.getKeys(), endpoint, options.origin, clock()); }
          catch { throw new PushAttemptError('configuration'); }
        },
      }))]);
      if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599) throw new Error();
      status = response.status;
      if (status >= 200 && status < 300) return { outcome: 'sent', attempts, status, code: null };
      if (status === 404 || status === 410) return { outcome: 'gone', attempts, status, code: null };
      code = 'http';
      if (status !== 429 && status < 500) return failure(code);
      providerDelay = Math.max(0, response.retryAfterMs ?? 0);
    } catch (error) {
      code = error instanceof PushAttemptError ? error.code : 'network';
      if (code === 'configuration') return failure(code);
    } finally { if (timer) clearTimeout(timer); }
    if (index === PUSH_RETRIES) return failure(code);
    const wait = Math.max(1_000 * 2 ** index, providerDelay);
    if (!Number.isFinite(wait) || wait > MAX_PUSH_RETRY_DELAY_MS) return failure(code);
    try { await sleep(wait); } catch { return failure('network'); }
  }
  return failure('network');
}
