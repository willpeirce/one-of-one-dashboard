import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv, createECDH, createPublicKey, hkdfSync, randomBytes, verify } from 'node:crypto';
import { encryptPushPayload, MAX_PUSH_PAYLOAD_BYTES, validatePushKeyPair, vapidAuthorization, VAPID_LIFETIME_SECONDS } from '../src/push/crypto.js';
import { PushValidationError, validatePushEndpoint, validatePushKeys } from '../src/push/validation.js';

function subscriptionKeys() {
  const receiver = createECDH('prime256v1'); receiver.generateKeys();
  return { receiver, keys: { p256dh: receiver.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } };
}

test('push endpoints accept the prescribed HTTPS hosts and reject lookalikes, ports, credentials and URL tricks', () => {
  for (const host of ['fcm.googleapis.com', 'web.push.apple.com', 'updates.push.services.mozilla.com', 'invented.notify.windows.com']) {
    assert.equal(validatePushEndpoint(`https://${host}/invented/path?opaque=invented`).hostname, host);
    assert.equal(validatePushEndpoint(`https://${host}:443/invented`).port, '');
  }
  for (const input of [
    null, '', 'http://fcm.googleapis.com/invented', 'https://fcm.googleapis.com:8443/invented',
    'https://account:password@fcm.googleapis.com/invented', 'https://fcm.googleapis.com.attacker.invalid/invented',
    'https://fcm-googleapis.com/invented', 'https://web.push.apple.com.attacker.invalid/', 'https://nested.web.push.apple.com/',
    'https://notify.windows.com/', 'https://inventednotify.windows.com/', 'https://invented.notify.windows.com.attacker.invalid/',
    'https://127.0.0.1/invented', 'https://[::1]/invented', 'https://fcm.googleapis.com/invented#fragment',
    'https://fcm.googleapis.com/invented#', 'https://fcm.googleapis.com./invented',
    ' https://fcm.googleapis.com/invented', 'https://fcm.googleapis.com/line\nbreak',
    'https://fcm.googleapis.com\\@attacker.invalid/', `https://fcm.googleapis.com/${'a'.repeat(2_048)}`,
  ]) assert.throws(() => validatePushEndpoint(input), PushValidationError);
});

test('push keys require canonical base64url, exact byte sizes and a real uncompressed P-256 point', () => {
  const { keys } = subscriptionKeys();
  assert.deepEqual(validatePushKeys(keys), keys);
  for (const candidate of [
    null, [], { ...keys, extra: 'invented' }, { p256dh: keys.p256dh },
    { ...keys, auth: randomBytes(15).toString('base64url') }, { ...keys, auth: randomBytes(17).toString('base64url') },
    { ...keys, auth: `${keys.auth}=` }, { ...keys, auth: `${keys.auth}!` },
    { ...keys, p256dh: Buffer.alloc(65).toString('base64url') },
    { ...keys, p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64)]).toString('base64url') },
    { ...keys, p256dh: randomBytes(64).toString('base64url') },
  ]) assert.throws(() => validatePushKeys(candidate), PushValidationError);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const last = alphabet.indexOf(keys.auth.at(-1)!);
  const noncanonical = `${keys.auth.slice(0, -1)}${alphabet[last + 1]}`;
  assert.equal(Buffer.from(noncanonical, 'base64url').length, 16);
  assert.throws(() => validatePushKeys({ ...keys, auth: noncanonical }), PushValidationError);
});

test('RFC 8291 Appendix A reproduces the published encrypted bytes without a new crypto dependency', () => {
  // Public protocol test vectors from https://www.rfc-editor.org/rfc/rfc8291#appendix-A, never application credentials.
  const senderScalar = 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw';
  const receiverPoint = 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4';
  // The RFC's public authentication vector as explicit bytes, without a credential-shaped assignment.
  const authentication = Buffer.from([0x05, 0x30, 0x59, 0x32, 0xa1, 0xc7, 0xea, 0xbe, 0x13, 0xb6, 0xce, 0xc9, 0xfd, 0xa4, 0x88, 0x82]).toString('base64url');
  const salt = 'DGv6ra1nlYgDCS1FRnbzlw';
  const plaintext = Buffer.from('V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24', 'base64url');
  const encrypted = encryptPushPayload(plaintext, { p256dh: receiverPoint, auth: authentication },
    { privateKey: Buffer.from(senderScalar, 'base64url'), salt: Buffer.from(salt, 'base64url') });
  const expected = 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml'
    + 'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT'
    + 'pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN';
  assert.deepEqual(encrypted, Buffer.from(expected, 'base64url'));
  assert.equal(encrypted.readUInt32BE(16), 4_096); assert.equal(encrypted[20], 65);
});

test('web push uses fresh ephemeral keys and salts, decrypts with the receiver, and enforces the UTF-8 payload cap', () => {
  const { keys, receiver } = subscriptionKeys();
  const plain = Buffer.from('Invented notification 🟢');
  const first = encryptPushPayload(plain, keys), second = encryptPushPayload(plain, keys);
  assert.notDeepEqual(first.subarray(0, 16), second.subarray(0, 16));
  assert.notDeepEqual(first.subarray(21, 86), second.subarray(21, 86));
  const salt = first.subarray(0, 16), sender = first.subarray(21, 86);
  const ikm = Buffer.from(hkdfSync('sha256', receiver.computeSecret(sender), Buffer.from(keys.auth, 'base64url'),
    Buffer.concat([Buffer.from('WebPush: info\0'), receiver.getPublicKey(), sender]), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce); decipher.setAuthTag(first.subarray(-16));
  const decrypted = Buffer.concat([decipher.update(first.subarray(86, -16)), decipher.final()]);
  assert.deepEqual(decrypted, Buffer.concat([plain, Buffer.from([2])]));
  assert.doesNotThrow(() => encryptPushPayload(Buffer.alloc(MAX_PUSH_PAYLOAD_BYTES), keys));
  assert.throws(() => encryptPushPayload(Buffer.from('🟢'.repeat(751)), keys), /too long/);
  assert.throws(() => encryptPushPayload(Buffer.alloc(1), keys, { salt: Buffer.alloc(15) }), /salt/);
});

test('VAPID uses the existing raw pair, 64-byte ES256 signatures, endpoint origin and a twelve-hour expiry', () => {
  const signing = createECDH('prime256v1'); signing.generateKeys();
  const pair = { publicKey: signing.getPublicKey().toString('base64url'), privateKey: signing.getPrivateKey().toString('base64url') };
  assert.deepEqual(validatePushKeyPair(pair), pair);
  const now = new Date('2032-04-07T07:00:00Z'), origin = 'https://pulse.example.invalid';
  const header = vapidAuthorization(pair, new URL('https://fcm.googleapis.com/invented/opaque?value=hidden'), origin, now);
  const match = /^vapid t=([^,]+), k=([A-Za-z0-9_-]+)$/u.exec(header)!;
  assert.equal(match[2], pair.publicKey);
  const [head, claims, signature] = match[1]!.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(head!, 'base64url').toString()), { typ: 'JWT', alg: 'ES256' });
  assert.deepEqual(JSON.parse(Buffer.from(claims!, 'base64url').toString()),
    { aud: 'https://fcm.googleapis.com', exp: now.getTime() / 1_000 + VAPID_LIFETIME_SECONDS, sub: origin });
  const bytes = signing.getPublicKey(), key = createPublicKey({ format: 'jwk', key: {
    kty: 'EC', crv: 'P-256', x: bytes.subarray(1, 33).toString('base64url'), y: bytes.subarray(33).toString('base64url'),
  } });
  assert.equal(Buffer.from(signature!, 'base64url').length, 64);
  assert.equal(verify('sha256', Buffer.from(`${head}.${claims}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature!, 'base64url')), true);
  assert.ok(!header.includes(pair.privateKey));
  for (const bad of ['http://localhost:3000', 'https://pulse.example.invalid/path', 'https://account@pulse.example.invalid', 'mailto:invented@example.invalid'])
    assert.throws(() => vapidAuthorization(pair, new URL('https://fcm.googleapis.com/invented'), bad, now), /origin unavailable/);
  assert.throws(() => validatePushKeyPair({ ...pair, publicKey: subscriptionKeys().keys.p256dh }), /keys unavailable/);
  assert.throws(() => validatePushKeyPair({ ...pair, privateKey: 'invented-private-value' }), /keys unavailable/);
  const shortScalar = createECDH('prime256v1'); shortScalar.setPrivateKey(Buffer.from([1]));
  const shortPair = { publicKey: shortScalar.getPublicKey().toString('base64url'), privateKey: Buffer.from([1]).toString('base64url') };
  assert.doesNotThrow(() => vapidAuthorization(shortPair, new URL('https://web.push.apple.com/invented'), origin, now));
  assert.equal(shortPair.privateKey, 'AQ', 'a short stored scalar is padded in memory only');
});
