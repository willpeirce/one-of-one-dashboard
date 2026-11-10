import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import { Auth } from '../src/auth.js';
import { readRuntime } from '../src/runtime.js';
import { readPushKeyPair } from '../src/push/keys.js';
import { claimPushDay, readPushSubscriptions, recordPushResult, removePushSubscription, savePushSubscription } from '../src/push/store.js';
import type { PushSendResult } from '../src/push/sender.js';
import type { PushSubscription } from '../src/push/validation.js';
import { createTestDatabase } from './helpers/database.js';

const now = new Date('2032-04-06T07:00:00Z');
function subscription(id = 'invented-device'): PushSubscription {
  const pair = createECDH('prime256v1'); pair.generateKeys();
  return {endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, keys: {
    p256dh: pair.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url'),
  }};
}
const failure: PushSendResult = {outcome: 'failed', attempts: 4, status: 503, code: 'http'};
const success: PushSendResult = {outcome: 'sent', attempts: 1, status: 201, code: null};
const gone = (status: number): PushSendResult => ({outcome: 'gone', attempts: 1, status, code: 'http'});
async function database(t: TestContext) {
  const db = await createTestDatabase(); t.after(() => db.close()); return db;
}

test('push subscription cap stays at ten through concurrent writes and drops the oldest', async t => {
  const db = await database(t);
  await Promise.all(Array.from({length: 18}, (_, index) => savePushSubscription(db, 'invented-credential', subscription(`invented-${index}`), new Date(+now + index * 1000))));
  const rows = await readPushSubscriptions(db, 'invented-credential');
  assert.equal(rows.length, 10);
  assert.deepEqual(rows.map(row => new URL(row.endpoint).pathname.split('-').at(-1)), Array.from({length: 10}, (_, i) => String(i + 8)));
  await savePushSubscription(db, 'invented-other', subscription('invented-other'), now);
  assert.equal((await readPushSubscriptions(db, 'invented-other')).length, 1);
});

test('push refresh is idempotent; changed keys reset delivery history and transfer starts a new age', async t => {
  const db = await database(t), initial = subscription();
  await savePushSubscription(db, 'invented-first', initial, now);
  const before = (await readPushSubscriptions(db))[0]!;
  await recordPushResult(db, before, success, now);
  await recordPushResult(db, before, failure, now);
  await savePushSubscription(db, 'invented-first', initial, new Date(+now + 1000));
  const refreshed = (await readPushSubscriptions(db))[0]!;
  assert.equal(refreshed.createdAt, now.toISOString());
  assert.equal(refreshed.lastSuccessAt, now.toISOString()); assert.equal(refreshed.failures, 1);
  const changed = subscription();
  await savePushSubscription(db, 'invented-first', changed, new Date(+now + 2000));
  const replaced = (await readPushSubscriptions(db))[0]!;
  assert.equal(replaced.createdAt, now.toISOString()); assert.equal(replaced.lastSuccessAt, null); assert.equal(replaced.failures, 0);
  await savePushSubscription(db, 'invented-second', changed, new Date(+now + 3000));
  assert.equal((await readPushSubscriptions(db, 'invented-first')).length, 0);
  assert.equal((await readPushSubscriptions(db, 'invented-second'))[0]!.createdAt, new Date(+now + 3000).toISOString());
});

test('push delivery records one final failure, resets after success, and deletes both expired statuses', async t => {
  const db = await database(t);
  await savePushSubscription(db, 'invented-credential', subscription(), now);
  const row = (await readPushSubscriptions(db))[0]!;
  await recordPushResult(db, row, failure, now);
  assert.equal((await readPushSubscriptions(db))[0]!.failures, 1, 'Four attempts are one failed delivery');
  await recordPushResult(db, row, success, new Date(+now + 1000));
  const passed = (await readPushSubscriptions(db))[0]!;
  assert.equal(passed.failures, 0); assert.equal(passed.lastSuccessAt, new Date(+now + 1000).toISOString());
  for (const status of [404, 410]) {
    await savePushSubscription(db, 'invented-credential', subscription(), now);
    await recordPushResult(db, (await readPushSubscriptions(db))[0]!, gone(status), now);
    assert.equal((await readPushSubscriptions(db)).length, 0);
  }
});

test('late push results cannot change replacement keys, a new owner or a re-created subscription', async t => {
  const db = await database(t), original = subscription();
  for (const replacement of ['keys','owner','re-created'] as const) {
    await savePushSubscription(db, 'invented-first', original, now);
    const stale = (await readPushSubscriptions(db))[0]!;
    if (replacement === 're-created') await removePushSubscription(db, original.endpoint, 'invented-first');
    await savePushSubscription(db, replacement === 'owner' ? 'invented-second' : 'invented-first',
      replacement === 'keys' ? subscription() : original, new Date(+now + 1000));
    for (const outcome of [failure,success,gone(404),gone(410)]) await recordPushResult(db, stale, outcome, now);
    const rows = await readPushSubscriptions(db);
    assert.equal(rows.length, 1); assert.equal(rows[0]!.failures, 0); assert.equal(rows[0]!.lastSuccessAt, null);
    await removePushSubscription(db, original.endpoint);
  }
});

test('unsubscribe only changes the requested credential; persisted audit contains no subscription details', async t => {
  const db = await database(t), item = subscription();
  await savePushSubscription(db, 'invented-first', item, now);
  await removePushSubscription(db, item.endpoint, 'invented-second');
  assert.equal((await readPushSubscriptions(db)).length, 1);
  await removePushSubscription(db, item.endpoint, 'invented-first');
  assert.equal((await readPushSubscriptions(db)).length, 0);
  const audit = JSON.stringify((await db.query('SELECT event FROM pulse.audit_log')).rows);
  for (const secret of [item.endpoint,item.keys.auth,item.keys.p256dh]) assert.ok(!audit.includes(secret));
  assert.ok(audit.includes('Push notifications enabled')); assert.ok(audit.includes('Push notifications disabled'));
});

test('the durable push claim admits one concurrent caller per kind and UK day; both tables revoke PUBLIC', async t => {
  const db = await database(t);
  const claims = await Promise.all(Array.from({length: 12}, () => claimPushDay(db, 'morning-summary', '2032-04-06', now)));
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal(await claimPushDay(db, 'morning-summary', '2032-04-07', now), true);
  assert.equal(await claimPushDay(db, 'invented-other-kind', '2032-04-06', now), true);
  assert.equal((await db.query(`SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace,
    LATERAL aclexplode(c.relacl) a WHERE n.nspname='pulse' AND c.relname IN ('push_subscriptions','push_sent') AND a.grantee=0`)).rows.length, 0);
});

test('push key reader reuses the existing Auth pair without any writes and reports only safe errors', async t => {
  const db = await database(t);
  await Auth.create(db, readRuntime({DATABASE_URL: 'postgresql://localhost/pulse_push_test', APP_ORIGIN: 'https://pulse.example.test'}));
  const stored = Buffer.from((await db.query<{value: Uint8Array}>("SELECT value FROM pulse_private.app_secrets WHERE name='push_key_pair'")).rows[0]!.value);
  const first = await readPushKeyPair(db), again = await readPushKeyPair(db);
  assert.ok(first.publicKey === again.publicKey && first.privateKey === again.privateKey);
  assert.equal(Buffer.from(first.publicKey, 'base64url').length, 65);
  assert.ok(stored.equals(Buffer.from((await db.query<{value: Uint8Array}>("SELECT value FROM pulse_private.app_secrets WHERE name='push_key_pair'")).rows[0]!.value)));
  await db.query("UPDATE pulse_private.app_secrets SET value=$1 WHERE name='push_key_pair'", [Buffer.from('invented malformed secret input')]);
  await assert.rejects(readPushKeyPair(db), {message: 'Push key pair is unavailable.'});
  await db.query("DELETE FROM pulse_private.app_secrets WHERE name='push_key_pair'");
  await assert.rejects(readPushKeyPair(db), {message: 'Push key pair is unavailable.'});
  assert.equal((await db.query("SELECT 1 FROM pulse_private.app_secrets WHERE name='push_key_pair'")).rowCount, 0);
});


test('identical repairs do not audit; recreating, replacing keys and transferring do', async t => {
  const db = await database(t), item = subscription();
  const count = async () => Number((await db.query<{count: string}>("SELECT count(*)::text FROM pulse.audit_log WHERE event='Push notifications enabled'")).rows[0]!.count);
  await savePushSubscription(db, 'invented-first', item, now); assert.equal(await count(), 1);
  await recordPushResult(db, (await readPushSubscriptions(db))[0]!, success, now);
  await recordPushResult(db, (await readPushSubscriptions(db))[0]!, failure, now);
  const before = await readPushSubscriptions(db);
  await savePushSubscription(db, 'invented-first', item, new Date(+now + 1000));
  assert.equal(await count(), 1); assert.deepEqual(await readPushSubscriptions(db), before);
  await removePushSubscription(db, item.endpoint);
  await savePushSubscription(db, 'invented-first', item, new Date(+now + 2000)); assert.equal(await count(), 2);
  await savePushSubscription(db, 'invented-second', item, new Date(+now + 3000)); assert.equal(await count(), 3);
  assert.equal((await readPushSubscriptions(db))[0]!.credentialId, 'invented-second');
  await savePushSubscription(db, 'invented-second', subscription(), new Date(+now + 4000)); assert.equal(await count(), 4);
});
