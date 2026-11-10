import { ECDH } from 'node:crypto';

export interface PushKeys { p256dh: string; auth: string }
export interface PushSubscription { endpoint: string; keys: PushKeys }

export class PushValidationError extends Error {
  constructor(message = 'Use a supported notification subscription.') { super(message); }
}

const EXACT_PUSH_HOSTS = new Set(['fcm.googleapis.com', 'web.push.apple.com', 'updates.push.services.mozilla.com']);
export const MAX_PUSH_ENDPOINT_LENGTH = 2_048;

/** Browser-issued paths are opaque; only the service host and URL boundary are trusted. */
export function validatePushEndpoint(value: unknown): URL {
  if (typeof value !== 'string' || value.length > MAX_PUSH_ENDPOINT_LENGTH || value.trim() !== value || /[\u0000-\u0020\\#]/u.test(value))
    throw new PushValidationError();
  let url: URL;
  try { url = new URL(value); } catch { throw new PushValidationError(); }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash
    || url.href.length > MAX_PUSH_ENDPOINT_LENGTH
    || !(EXACT_PUSH_HOSTS.has(url.hostname) || url.hostname.endsWith('.notify.windows.com')))
    throw new PushValidationError();
  return url;
}

function decoded(value: unknown, bytes: number): Buffer {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(value) || value.length > Math.ceil(bytes * 4 / 3)) throw new PushValidationError();
  const result = Buffer.from(value, 'base64url');
  if (result.length !== bytes || result.toString('base64url') !== value) throw new PushValidationError();
  return result;
}

export function validatePushKeys(value: unknown): PushKeys {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'auth,p256dh') throw new PushValidationError();
  const keys = value as Record<string, unknown>;
  const publicKey = decoded(keys.p256dh, 65);
  decoded(keys.auth, 16);
  if (publicKey[0] !== 4) throw new PushValidationError();
  try { ECDH.convertKey(publicKey, 'prime256v1', undefined, undefined, 'uncompressed'); }
  catch { throw new PushValidationError(); }
  return { p256dh: keys.p256dh as string, auth: keys.auth as string };
}
