import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import { sendPush, type PushPayload, type PushTransportRequest } from '../src/push/sender.js';
import type { RawPushKeyPair } from '../src/push/crypto.js';

function example() {
  const receiver = createECDH('prime256v1'); receiver.generateKeys();
  const signer = createECDH('prime256v1'); signer.generateKeys();
  return {
    subscription: { endpoint: 'https://fcm.googleapis.com/invented-private-endpoint', keys: {
      p256dh: receiver.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url'),
    } },
    pair: { publicKey: signer.getPublicKey().toString('base64url'), privateKey: signer.getPrivateKey().toString('base64url') },
    payload: { title: 'Invented morning', body: '1. Invented date', path: '/morning' },
  };
}

test('injected push transport receives a validated encrypted POST without making an HTTP-origin JWT', async () => {
  const { subscription, payload } = example(); let keyReads = 0, requests = 0;
  const result = await sendPush(subscription, payload, { origin: 'http://localhost:3000', clock: () => new Date('2032-04-07T07:00:00Z'),
    getKeys: async () => { keyReads++; throw new Error('No key read expected'); },
    transport: async request => {
      requests++; assert.equal(request.url, subscription.endpoint); assert.equal(request.method, 'POST');
      assert.equal(request.headers['Content-Encoding'], 'aes128gcm'); assert.equal(request.headers.TTL, '14400');
      assert.equal(request.headers.Urgency, 'normal'); assert.equal(request.signal.aborted, false);
      assert.ok(!Buffer.from(request.body).includes(Buffer.from(payload.title)));
      assert.equal(request.body[20], 65); return { status: 201 };
    },
  });
  assert.deepEqual(result, { outcome: 'sent', attempts: 1, status: 201, code: null });
  assert.equal(requests, 1); assert.equal(keyReads, 0);
});

test('sender retries retryable responses at most three times, respects short Retry-After and defers long waits', async () => {
  const { subscription, payload, pair } = example();
  for (const status of [429, 500, 502, 503]) {
    const sleeps: number[] = []; let calls = 0;
    const result = await sendPush(subscription, payload, { origin: 'https://pulse.example.invalid', getKeys: async () => pair,
      transport: async () => { calls++; return { status }; }, sleep: async ms => { sleeps.push(ms); }, log: () => {},
    });
    assert.equal(result.outcome, 'failed'); assert.equal(calls, 4); assert.equal(result.status, status);
    assert.deepEqual(sleeps, [1_000, 2_000, 4_000]);
  }
  const waits: number[] = []; let calls = 0;
  const recovered = await sendPush(subscription, payload, { origin: 'https://pulse.example.invalid', getKeys: async () => pair,
    transport: async () => ++calls === 1 ? { status: 429, retryAfterMs: 5_000 } : { status: 201 }, sleep: async ms => { waits.push(ms); },
  });
  assert.equal(recovered.outcome, 'sent'); assert.deepEqual(waits, [5_000]);
  calls = 0;
  const deferred = await sendPush(subscription, payload, { origin: 'https://pulse.example.invalid', getKeys: async () => pair,
    transport: async () => { calls++; return { status: 429, retryAfterMs: 120_000 }; }, sleep: async () => { assert.fail('must not retry before provider delay'); }, log: () => {},
  });
  assert.equal(deferred.outcome, 'failed'); assert.equal(deferred.status, 429); assert.equal(calls, 1);
});

test('404 and 410 tell the store to delete a subscription; other permanent failures do not retry', async () => {
  const { subscription, payload, pair } = example();
  for (const status of [400, 401, 403, 404, 410, 413, 302]) {
    let calls = 0;
    const result = await sendPush(subscription, payload, { origin: 'https://pulse.example.invalid', getKeys: async () => pair,
      transport: async () => { calls++; return { status }; }, sleep: async () => { assert.fail(); }, log: () => {},
    });
    assert.equal(calls, 1); assert.equal(result.outcome, status === 404 || status === 410 ? 'gone' : 'failed');
  }
});

test('sender bounds hanging transport and signing lookup, aborts attempts and redacts every raw failure', async () => {
  const { subscription, payload, pair } = example(); const logs: string[] = [];
  const pending: PushTransportRequest[] = [];
  const options = { origin: 'https://pulse.example.invalid', getKeys: async () => pair, timeoutMs: 5, sleep: async () => {}, log: (line: string) => { logs.push(line); } };
  const timeout = await sendPush(subscription, payload, { ...options,
    transport: async request => { pending.push(request); return new Promise<never>(() => {}); },
  });
  assert.equal(timeout.outcome, 'failed'); assert.equal(timeout.code, 'timeout'); assert.equal(pending.length, 4);
  assert.equal(pending.every(request => request.signal.aborted), true);
  const authTimeout = await sendPush(subscription, payload, { ...options,
    getKeys: () => new Promise<RawPushKeyPair>(() => {}), transport: async request => { await request.authorize(); return { status: 201 }; },
  });
  assert.equal(authTimeout.code, 'timeout'); assert.equal(authTimeout.attempts, 4);
  const network = await sendPush(subscription, payload, { ...options, transport: async () => {
    throw new Error(`${subscription.endpoint} ${subscription.keys.auth} ${pair.privateKey}`);
  } });
  assert.equal(network.code, 'network'); assert.equal(network.attempts, 4);
  const invalid = await sendPush({ ...subscription, endpoint: 'https://attacker.invalid/secret-path' }, payload, options);
  assert.equal(invalid.attempts, 0); assert.equal(invalid.code, 'invalid_subscription');
  for (const value of [subscription.endpoint, 'secret-path', subscription.keys.auth, pair.privateKey]) assert.ok(!logs.join('\n').includes(value));
  assert.ok(logs.every(line => /^Push delivery failed \(code: [a-z_]+; provider: [a-z]+; status: (unavailable|[0-9]+)\)\.$/u.test(line)));
});

test('Windows endpoint subdomains cannot reflect a subscription secret into failure logs', async () => {
  const { subscription, payload, pair } = example(), reflected = `${'a'.repeat(21)}g`, logs: string[] = [];
  const result = await sendPush({ endpoint: `https://${reflected}.notify.windows.com/invented-path`, keys: { ...subscription.keys, auth: reflected } },
    payload, { origin: 'https://pulse.example.invalid', getKeys: async () => pair, transport: async () => ({ status: 503 }),
      sleep: async () => {}, log: line => { logs.push(line); } });
  assert.equal(result.outcome, 'failed'); assert.equal(result.attempts, 4);
  assert.ok(logs.some(line => line.includes('provider: windows')));
  assert.ok(!logs.join('\n').includes(reflected));
  assert.ok(!logs.join('\n').includes('invented-path'));
});

test('default transport signs HTTPS origin requests and blocks redirects without logging provider content', async t => {
  const { subscription, payload, pair } = example(); const now = new Date('2032-04-07T07:00:00Z');
  let calls = 0; const sleeps: number[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    calls++; assert.equal(url, subscription.endpoint); assert.equal(init?.method, 'POST'); assert.equal(init?.redirect, 'error');
    assert.ok(init?.signal instanceof AbortSignal);
    const headers = new Headers(init?.headers);
    assert.match(headers.get('authorization')!, /^vapid t=/u);
    assert.equal(headers.get('content-encoding'), 'aes128gcm');
    return calls === 1 ? new Response('provider content must not be logged', { status: 429, headers: { 'Retry-After': '3' } }) : new Response(null, { status: 201 });
  });
  const result = await sendPush(subscription, payload, { origin: 'https://pulse.example.invalid', getKeys: async () => pair, clock: () => now,
    sleep: async ms => { sleeps.push(ms); }, log: () => { assert.fail('recovered send does not log provider content'); },
  });
  assert.equal(result.outcome, 'sent'); assert.equal(calls, 2); assert.deepEqual(sleeps, [3_000]);
  const rejected = await sendPush(subscription, payload, { origin: 'http://localhost:3000', getKeys: async () => pair, log: () => {} });
  assert.equal(rejected.code, 'configuration'); assert.equal(calls, 2, 'invalid signing origin never reaches HTTP');
});

test('sender revalidates subscription keys and rejects oversized UTF-8 payloads and unsafe paths before transport', async () => {
  const { subscription, payload, pair } = example(); let calls = 0;
  const options = { origin: 'https://pulse.example.invalid', getKeys: async () => pair, transport: async () => { calls++; return { status: 201 }; }, log: () => {} };
  const badKeys = await sendPush({ ...subscription, keys: { ...subscription.keys, p256dh: Buffer.alloc(65).toString('base64url') } }, payload, options);
  assert.equal(badKeys.code, 'invalid_subscription');
  for (const change of [{ body: '🟢'.repeat(750) }, { path: '//attacker.invalid' }, { path: '/\\attacker.invalid' }, { path: '/\t/attacker.invalid' }, { path: 'https://attacker.invalid' }]) {
    const result = await sendPush(subscription, { ...payload, ...change } as PushPayload, options);
    assert.equal(result.code, 'invalid_payload');
  }
  assert.equal(calls, 0);
});

test('summary TTL reaches noon UK in summer and winter instead of expiring after one hour', async () => {
  const {subscription, payload, pair} = example();
  for (const [at, ttl] of [['2032-04-20T07:00:00Z', '14400'], ['2032-12-20T08:00:00Z', '14400'],
    ['2032-04-20T08:59:00Z', '7260'], ['2032-12-20T12:00:00Z', '0']]) {
    const result = await sendPush(subscription, payload, {origin: 'https://pulse.example.invalid', getKeys: async () => pair,
      clock: () => new Date(at!), transport: async request => {assert.equal(request.headers.TTL, ttl); return {status: 201};}});
    assert.equal(result.outcome, 'sent');
  }
});
