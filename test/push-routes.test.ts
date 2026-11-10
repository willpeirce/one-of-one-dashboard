import assert from 'node:assert/strict';
import { createECDH, createHmac, randomBytes } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import { Auth } from '../src/auth.js';
import { readRuntime } from '../src/runtime.js';
import { readPushKeyPair } from '../src/push/keys.js';
import { registerPush } from '../src/push/routes.js';
import type { PushTestResult } from '../src/push/service.js';
import { readPushSubscriptions, savePushSubscription } from '../src/push/store.js';
import { createTestDatabase } from './helpers/database.js';

const now = new Date('2032-04-06T07:00:00Z');
function subscription() {
  const pair = createECDH('prime256v1'); pair.generateKeys();
  return {endpoint: 'https://fcm.googleapis.com/fcm/send/invented-device', keys: {
    p256dh: pair.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url'),
  }};
}
async function harness(t: TestContext) {
  const db = await createTestDatabase(), app = Fastify({logger: false}); await app.register(cookie);
  const config = readRuntime({DATABASE_URL: 'postgresql://localhost/pulse_push_test', APP_ORIGIN: 'https://pulse.example.test'});
  const auth = await Auth.create(db, config), credential = randomBytes(32).toString('base64url'), token = randomBytes(32).toString('base64url');
  const secret = (await db.query<{value: Uint8Array}>("SELECT value FROM pulse_private.app_secrets WHERE name='session_hmac'")).rows[0]!;
  await db.query('INSERT INTO pulse_private.credentials(id,public_key) VALUES($1,$2)', [credential,randomBytes(32)]);
  await db.query("INSERT INTO pulse_private.sessions(token_hash,credential_id,expires_at) VALUES($1,$2,now()+interval '30 days')",
    [createHmac('sha256', Buffer.from(secret.value)).update(token).digest('hex'),credential]);
  const calls: string[] = [];
  let result: PushTestResult = {status: 'sent',sent: 1,failed: 0,gone: 0};
  let failure = false;
  registerPush(app, db, auth, {clock: () => now, sendTest: async who => { calls.push(who); if (failure) throw new Error('invented sensitive transport error'); return result; }});
  t.after(async () => {await app.close(); await db.close();});
  return {db,app,auth,credential,calls,headers: {cookie: `__Host-pulse_session=${token}`, origin: config.origin, 'content-type': 'application/json'},
    setResult(value: PushTestResult) {result = value;}, fail() {failure = true;}};
}

test('push routes require a session, same origin, JSON and the small body limits', async t => {
  const h = await harness(t), item = subscription();
  assert.equal((await h.app.inject('/api/push/key')).statusCode, 401);
  for (const [action,payload] of [['subscribe',item],['unsubscribe',{endpoint: item.endpoint}],['test',{}]] as const) {
    const url = `/api/push/${action}`;
    assert.equal((await h.app.inject({method: 'POST',url,payload})).statusCode, 403);
    assert.equal((await h.app.inject({method: 'POST',url,headers: {...h.headers,origin: 'https://other.example.test'},payload})).statusCode, 403);
    assert.equal((await h.app.inject({method: 'POST',url,headers: {...h.headers,'content-type': 'text/plain'},payload: 'invented'})).statusCode, 415);
    assert.equal((await h.app.inject({method: 'POST',url,headers: {origin: h.headers.origin,'content-type': 'application/json'},payload})).statusCode, 401);
    assert.equal((await h.app.inject({method: 'POST',url,headers: h.headers,payload: {padding: 'x'.repeat(action === 'test' ? 600 : 4200)}})).statusCode, 413);
  }
  assert.equal(h.calls.length, 0); assert.equal((await readPushSubscriptions(h.db)).length, 0);
});

test('push routes reject extra or malformed fields, invalid endpoints and invalid keys without echoes', async t => {
  const h = await harness(t), item = subscription();
  for (const body of [{},[],null,{...item,extra: true},{...item,keys: {...item.keys,extra: true}},
    {...item,keys: {p256dh: item.keys.p256dh}}, {...item,keys: {...item.keys,auth: 'invented-invalid-key'}},
    {...item,endpoint: 'https://fcm.googleapis.com.evil.example/invented-secret-path'}, {...item,endpoint: 'http://fcm.googleapis.com/invented-secret-path'}]) {
    const response = await h.app.inject({method: 'POST',url: '/api/push/subscribe',headers: h.headers,payload: JSON.stringify(body)});
    assert.equal(response.statusCode, 400); assert.ok(!response.body.includes('invented-secret-path'));
    assert.ok(!response.body.includes(item.keys.p256dh)); assert.ok(!response.body.includes(item.keys.auth));
  }
  for (const body of [{},[],{endpoint: item.endpoint,extra: true},{endpoint: 7},{endpoint: 'https://unknown.example/invented'}])
    assert.equal((await h.app.inject({method: 'POST',url: '/api/push/unsubscribe',headers: h.headers,payload: body})).statusCode, 400);
  for (const body of [[],{endpoint: item.endpoint},{extra: true}])
    assert.equal((await h.app.inject({method: 'POST',url: '/api/push/test',headers: h.headers,payload: body})).statusCode, 400);
  assert.equal(h.calls.length, 0); assert.equal((await readPushSubscriptions(h.db)).length, 0);
});

test('public key route returns only the stored public key, never caches and hides damaged private data', async t => {
  const h = await harness(t), pair = await readPushKeyPair(h.db);
  const response = await h.app.inject({url: '/api/push/key',headers: h.headers});
  assert.equal(response.statusCode, 200); assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(Object.keys(response.json()), ['publicKey']);
  assert.ok(response.json<{publicKey: string}>().publicKey === pair.publicKey);
  assert.ok(!response.body.includes(pair.privateKey));
  await h.db.query("UPDATE pulse_private.app_secrets SET value=$1 WHERE name='push_key_pair'", [Buffer.from('invented malformed private key')]);
  const damaged = await h.app.inject({url: '/api/push/key',headers: h.headers});
  assert.equal(damaged.statusCode, 503); assert.ok(!damaged.body.includes('invented malformed'));
});

test('subscribe canonicalizes endpoint identity and unsubscribe is credential scoped', async t => {
  const h = await harness(t), item = subscription();
  const subscribe = await h.app.inject({method: 'POST',url: '/api/push/subscribe',headers: h.headers,
    payload: {...item,endpoint: item.endpoint.replace('fcm.googleapis.com', 'FCM.GOOGLEAPIS.COM:443')}});
  assert.equal(subscribe.statusCode, 200); assert.deepEqual(subscribe.json(), {ok: true});
  assert.equal(subscribe.headers['cache-control'], 'no-store');
  const rows = await readPushSubscriptions(h.db);
  assert.equal(rows.length, 1); assert.equal(rows[0]!.endpoint, item.endpoint); assert.equal(rows[0]!.credentialId, h.credential);
  await savePushSubscription(h.db, 'invented-other-credential', item, now);
  const off = await h.app.inject({method: 'POST',url: '/api/push/unsubscribe',headers: h.headers,payload: {endpoint: item.endpoint}});
  assert.deepEqual(off.json(), {ok: true}); assert.equal((await readPushSubscriptions(h.db)).length, 1);
  await h.app.inject({method: 'POST',url: '/api/push/subscribe',headers: h.headers,payload: item});
  await h.app.inject({method: 'POST',url: '/api/push/unsubscribe',headers: h.headers,payload: {endpoint: item.endpoint}});
  assert.equal((await readPushSubscriptions(h.db)).length, 0);
});

test('test route delegates only the current credential, maps cooldown and failure safely, and audits no secrets', async t => {
  const h = await harness(t), send = () => h.app.inject({method: 'POST',url: '/api/push/test',headers: h.headers,payload: {}});
  const passed = await send();
  assert.equal(passed.statusCode, 200); assert.deepEqual(passed.json(), {ok: true,sent: 1,failed: 0,gone: 0});
  assert.equal(passed.headers['cache-control'], 'no-store');
  h.setResult({status: 'rate-limited',retryAfterSeconds: 42});
  const limited = await send(); assert.equal(limited.statusCode, 429); assert.equal(limited.headers['retry-after'], '42');
  assert.equal(limited.json<{retryAfterSeconds: number}>().retryAfterSeconds, 42);
  h.setResult({status: 'unavailable'}); assert.equal((await send()).statusCode, 503);
  h.fail(); const failed = await send(); assert.equal(failed.statusCode, 503); assert.ok(!failed.body.includes('sensitive'));
  assert.ok(h.calls.every(value => value === h.credential)); assert.equal(h.calls.length, 4);
  const events = (await h.db.query<{event: string}>('SELECT event FROM pulse.audit_log')).rows;
  assert.equal(events.length, 4); assert.ok(events.every(row => row.event === 'Push test requested'));
});


test('sign-out atomically removes this browser endpoint and session, never another credential’s subscription', async t => {
  for (const transferred of [false, true]) {
    const h = await harness(t), item = subscription(); h.auth.registerRoutes(h.app);
    await savePushSubscription(h.db, transferred ? 'invented-other' : h.credential, item, now);
    const response = await h.app.inject({method: 'POST', url: '/auth/logout', headers: h.headers, payload: {pushEndpoint: item.endpoint}});
    assert.equal(response.statusCode, 200); assert.ok(!response.body.includes(item.endpoint));
    assert.equal((await readPushSubscriptions(h.db)).length, transferred ? 1 : 0);
    assert.equal((await h.db.query('SELECT 1 FROM pulse_private.sessions')).rowCount, 0);
    assert.equal((await h.app.inject({url: '/api/push/key', headers: h.headers})).statusCode, 401);
  }
});
