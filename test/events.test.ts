import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { test } from 'node:test';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { Auth } from '../src/auth.js';
import { registerDashboardEvents } from '../src/events.js';
import { readRuntime } from '../src/runtime.js';
import { createTestDatabase } from './helpers/database.js';

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

test('SSE heartbeat pings, ignores generatedAt, and sends real background changes and reconnect snapshots', { timeout: 10_000 }, async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const app = Fastify({ logger: false });
  const abort = new AbortController();
  let snapshotCalls = 0, revision = 1, signedIn = true;
  const auth: Pick<Auth, 'session' | 'config'> = {
    config: readRuntime({ DATABASE_URL: 'postgresql://localhost/pulse_test' }),
    session: async () => signedIn ? 'synthetic-credential' : null,
  };
  const events = registerDashboardEvents(app, auth, async () => ({
    generatedAt: new Date(Date.UTC(2026, 9, 11, 12, 0, snapshotCalls++)).toISOString(),
    hero: { revision },
  }));
  t.after(async () => { abort.abort(); await app.close(); });
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  async function connect() {
    const response = await fetch(`${base}/api/events`, { signal: abort.signal });
    assert.equal(response.status, 200);
    const reader = response.body!.getReader(), decoder = new TextDecoder();
    let pending = '';
    return async () => {
      while (!pending.includes('\n\n')) {
        const chunk = await reader.read();
        assert.equal(chunk.done, false);
        pending += decoder.decode(chunk.value, { stream: true });
      }
      const end = pending.indexOf('\n\n'), event = pending.slice(0, end);
      pending = pending.slice(end + 2);
      return event;
    };
  }
  const next = await connect();
  assert.match(await next(), /event: dashboard\ndata: .*"revision":1/);
  await events.publish(); // Only generatedAt changed.
  t.mock.timers.tick(15_000);
  assert.equal(await next(), ': ping', 'no timestamp-only snapshot is queued before the ping');
  assert.equal(snapshotCalls, 3, 'a heartbeat checks for source changes without emitting timestamp-only snapshots');

  revision = 2;
  await events.publish();
  assert.match(await next(), /event: dashboard\ndata: .*"revision":2/);
  const reconnect = await connect();
  assert.match(await reconnect(), /event: dashboard\ndata: .*"revision":2/);
  await events.publish();
  t.mock.timers.tick(15_000);
  assert.equal(await next(), ': ping');
  assert.equal(await reconnect(), ': ping');

  revision = 3; // A source worker committed new facts without an explicit publish.
  t.mock.timers.tick(15_000);
  assert.match(await next(), /event: dashboard\ndata: .*"revision":3/);
  assert.equal(await next(), ': ping');
  assert.match(await reconnect(), /event: dashboard\ndata: .*"revision":3/);
  assert.equal(await reconnect(), ': ping');

  signedIn = false;
  t.mock.timers.tick(15_000);
  assert.equal(await next(), 'event: signed-out\ndata: {}', 'heartbeat still checks session revocation');
  assert.equal(await reconnect(), 'event: signed-out\ndata: {}');
});

test('a large changed heartbeat snapshot drains without its comment ping closing the stream', { timeout: 10_000 }, async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const app = Fastify({ logger: false }), abort = new AbortController();
  let revision = 1;
  const detail = 'sample '.repeat(10_000);
  const events = registerDashboardEvents(app, {
    config: readRuntime({ DATABASE_URL: 'postgresql://localhost/pulse_test' }),
    session: async () => 'synthetic-credential',
  }, async () => ({ revision, detail }));
  t.after(async () => { abort.abort(); await app.close(); });
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  const response = await fetch(`${base}/api/events`, { signal: abort.signal });
  const reader = response.body!.getReader(), decoder = new TextDecoder();
  let pending = '';
  async function nextSnapshot() {
    for (;;) {
      while (!pending.includes('\n\n')) {
        const chunk = await reader.read();
        assert.equal(chunk.done, false, 'a healthy stream must stay open while its snapshot drains');
        pending += decoder.decode(chunk.value, { stream: true });
      }
      const end = pending.indexOf('\n\n'), event = pending.slice(0, end);
      pending = pending.slice(end + 2);
      const data = event.split('\n').find(line => line.startsWith('data: '));
      if (data) return JSON.parse(data.slice(6));
    }
  }
  assert.deepEqual(await nextSnapshot(), { revision: 1, detail });
  revision = 2;
  t.mock.timers.tick(15_000);
  assert.deepEqual(await nextSnapshot(), { revision: 2, detail });
  revision = 3;
  await events.publish();
  assert.deepEqual(await nextSnapshot(), { revision: 3, detail }, 'the same connection accepts a later update');
});

test('SSE authenticates, updates without reload and closes when the session is revoked', async (t) => {
  const db = await createTestDatabase();
  const app = Fastify({ logger: false });
  await app.register(cookie);
  const auth = await Auth.create(db, readRuntime({ DATABASE_URL: 'postgresql://localhost/pulse_test' }));
  const token = randomBytes(32).toString('base64url');
  const credentialId = randomBytes(32).toString('base64url');
  const key = (await db.query<{ value: Uint8Array }>("SELECT value FROM pulse_private.app_secrets WHERE name = 'session_hmac'")).rows[0]!;
  const hash = createHmac('sha256', Buffer.from(key.value)).update(token).digest('hex');
  await db.query('INSERT INTO pulse_private.credentials(id, public_key) VALUES ($1, $2)', [credentialId, randomBytes(32)]);
  await db.query("INSERT INTO pulse_private.sessions(token_hash, credential_id, expires_at) VALUES ($1, $2, now() + interval '30 days')", [hash, credentialId]);
  let revision = 1;
  // A snapshot can exceed the socket high-water mark without closing a healthy stream.
  const events = registerDashboardEvents(app, auth, async () => ({ revision, detail: 'sample '.repeat(10_000) }));
  const abort = new AbortController();
  t.after(async () => { abort.abort(); await app.close(); await db.close(); });
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  const cookieHeader = `pulse_session=${token}`;
  assert.equal((await app.inject('/api/events')).statusCode, 401);
  assert.equal((await app.inject({ url: '/api/events', headers: { cookie: cookieHeader, origin: 'https://untrusted.invalid' } })).statusCode, 403);
  const response = await fetch(`${base}/api/events`, { headers: { cookie: cookieHeader }, signal: abort.signal });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /^text\/event-stream/);
  assert.equal(response.headers.get('x-accel-buffering'), 'no');
  assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  const reader = response.body!.getReader();
  let pending = '';
  const decoder = new TextDecoder();
  async function nextEvent(): Promise<string> {
    while (!pending.includes('\n\n')) {
      const chunk = await reader.read();
      assert.equal(chunk.done, false, 'stream closed before delivering the event');
      pending += decoder.decode(chunk.value, { stream: true });
    }
    const end = pending.indexOf('\n\n');
    const event = pending.slice(0, end);
    pending = pending.slice(end + 2);
    return event;
  }
  const first = await nextEvent();
  assert.match(first, /event: dashboard/);
  assert.match(first, /"revision":1/);
  assert.ok(!first.includes(token));
  revision = 2;
  await events.publish();
  assert.match(await nextEvent(), /"revision":2/);
  await db.query('DELETE FROM pulse_private.sessions');
  await events.publish();
  assert.equal(await nextEvent(), 'event: signed-out\ndata: {}');
  assert.equal((await reader.read()).done, true);
});

test('SSE counts pending snapshots toward the connection limit under concurrent opens', { timeout: 10_000 }, async (t) => {
  const app = Fastify({ logger: false });
  const abort = new AbortController();
  const allStarted = barrier();
  const snapshotsReady = barrier();
  const connections: Promise<Response>[] = [];
  let snapshotCalls = 0;
  const auth: Pick<Auth, 'session' | 'config'> = {
    config: readRuntime({ DATABASE_URL: 'postgresql://localhost/pulse_test' }),
    session: async () => 'synthetic-credential',
  };
  registerDashboardEvents(app, auth, async () => {
    snapshotCalls++;
    if (snapshotCalls === 32) allStarted.release();
    // An incorrectly admitted 33rd request responds immediately, so a regression
    // fails on its HTTP status instead of leaving the test waiting for a stream.
    if (snapshotCalls <= 32) await snapshotsReady.promise;
    return { sample: true };
  });
  t.after(async () => {
    snapshotsReady.release();
    abort.abort();
    await Promise.allSettled(connections);
    await app.close();
  });
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  for (let i = 0; i < 32; i++) {
    connections.push(fetch(`${base}/api/events`, { signal: abort.signal }));
  }
  await allStarted.promise;

  const rejectedWhilePending = await fetch(`${base}/api/events`, { signal: abort.signal });
  assert.equal(rejectedWhilePending.status, 503);
  assert.deepEqual(await rejectedWhilePending.json(), { error: 'Too many open dashboard tabs.' });
  assert.equal(snapshotCalls, 32, 'overflow requests must not load another snapshot');

  snapshotsReady.release();
  const established = await Promise.all(connections);
  assert.ok(established.every((response) => response.status === 200));
  const rejectedWhileStreaming = await fetch(`${base}/api/events`, { signal: abort.signal });
  assert.equal(rejectedWhileStreaming.status, 503);
  assert.equal(snapshotCalls, 32);
});

test('SSE emits no initial snapshot when the session is revoked while it loads', { timeout: 10_000 }, async (t) => {
  const app = Fastify({ logger: false });
  const abort = new AbortController();
  const snapshotStarted = barrier();
  const snapshotReady = barrier();
  let signedIn = true;
  const auth: Pick<Auth, 'session' | 'config'> = {
    config: readRuntime({ DATABASE_URL: 'postgresql://localhost/pulse_test' }),
    session: async () => signedIn ? 'synthetic-credential' : null,
  };
  const events = registerDashboardEvents(app, auth, async () => {
    snapshotStarted.release();
    await snapshotReady.promise;
    return { detail: 'Private snapshot must not be emitted' };
  });
  let pendingResponse: Promise<Response> | undefined;
  t.after(async () => {
    snapshotReady.release();
    abort.abort();
    if (pendingResponse) await Promise.allSettled([pendingResponse]);
    await app.close();
  });
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  pendingResponse = fetch(`${base}/api/events`, { signal: abort.signal });
  await snapshotStarted.promise;
  signedIn = false;
  // Logout can publish before the opening request has become a subscriber.
  await events.publish();
  snapshotReady.release();

  const response = await pendingResponse;
  assert.equal(response.status, 401);
  assert.doesNotMatch(response.headers.get('content-type') ?? '', /text\/event-stream/);
  assert.deepEqual(await response.json(), { error: 'Sign in to continue.' });
});
