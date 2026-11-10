import { createCipheriv, createECDH, createPrivateKey, hkdfSync, randomBytes, sign } from 'node:crypto';
import { validatePushKeys, type PushKeys } from './validation.js';

export interface RawPushKeyPair { publicKey: string; privateKey: string }
export const MAX_PUSH_PAYLOAD_BYTES = 3_000;
export const VAPID_LIFETIME_SECONDS = 12 * 60 * 60;

function storedBytes(value: unknown, minimum: number, maximum: number): Buffer {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(value) || value.length > Math.ceil(maximum * 4 / 3)) throw new Error('Push keys unavailable.');
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.length < minimum || bytes.length > maximum || bytes.toString('base64url') !== value) throw new Error('Push keys unavailable.');
  return bytes;
}

/** Validate the existing atomic row; never generate or persist a replacement signing key. */
export function validatePushKeyPair(value: unknown): RawPushKeyPair {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join(',') !== 'privateKey,publicKey') throw new Error();
    const pair = value as Record<string, unknown>;
    const publicKey = storedBytes(pair.publicKey, 65, 65), privateKey = storedBytes(pair.privateKey, 1, 32);
    const check = createECDH('prime256v1'); check.setPrivateKey(privateKey);
    if (publicKey[0] !== 4 || !check.getPublicKey().equals(publicKey)) throw new Error();
    return { publicKey: pair.publicKey as string, privateKey: pair.privateKey as string };
  } catch { throw new Error('Push keys unavailable.'); }
}

export function vapidAuthorization(raw: RawPushKeyPair, endpoint: URL, appOrigin: string, now: Date): string {
  let origin: URL;
  try { origin = new URL(appOrigin); } catch { throw new Error('Push origin unavailable.'); }
  if (origin.protocol !== 'https:' || origin.origin !== appOrigin || !Number.isFinite(now.getTime())) throw new Error('Push origin unavailable.');
  const pair = validatePushKeyPair(raw), publicKey = Buffer.from(pair.publicKey, 'base64url');
  const privateKey = Buffer.from(pair.privateKey, 'base64url'), scalar = Buffer.alloc(32);
  privateKey.copy(scalar, 32 - privateKey.length);
  const key = createPrivateKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256',
    x: publicKey.subarray(1, 33).toString('base64url'), y: publicKey.subarray(33).toString('base64url'), d: scalar.toString('base64url') } });
  const header = Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({ aud: endpoint.origin, exp: Math.floor(now.getTime() / 1_000) + VAPID_LIFETIME_SECONDS, sub: appOrigin })).toString('base64url');
  const unsigned = `${header}.${claims}`;
  const signature = sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `vapid t=${unsigned}.${signature}, k=${pair.publicKey}`;
}

/** RFC 8291/8188: one aes128gcm record; injectable randomness is only for published test vectors. */
export function encryptPushPayload(payload: Uint8Array, keys: PushKeys, random: { privateKey?: Uint8Array; salt?: Uint8Array } = {}): Buffer {
  if (payload.byteLength > MAX_PUSH_PAYLOAD_BYTES) throw new Error('Push message is too long.');
  validatePushKeys(keys);
  const ephemeral = createECDH('prime256v1');
  if (random.privateKey) ephemeral.setPrivateKey(random.privateKey); else ephemeral.generateKeys();
  const sender = ephemeral.getPublicKey(), receiver = Buffer.from(keys.p256dh, 'base64url');
  const salt = random.salt ? Buffer.from(random.salt) : randomBytes(16);
  if (salt.length !== 16) throw new Error('Invalid push salt.');
  const shared = ephemeral.computeSecret(receiver);
  const ikm = Buffer.from(hkdfSync('sha256', shared, Buffer.from(keys.auth, 'base64url'),
    Buffer.concat([Buffer.from('WebPush: info\0'), receiver, sender]), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21); salt.copy(header); header.writeUInt32BE(4_096, 16); header[20] = sender.length;
  return Buffer.concat([header, sender, ciphertext]);
}
