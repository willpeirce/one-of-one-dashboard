import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import type { Database } from '../src/db.js';
import { deliverAlerts, alertDeviceCurrent } from '../src/push/alert-store.js';
import { inAlertQuietHours, observeAlert, watchdogAlertPayload } from '../src/push/alerts.js';
import type { AlertEvaluation } from '../src/push/alert-types.js';
import type { PushPayload } from '../src/push/sender.js';
import { PushService } from '../src/push/service.js';
import { readPushSubscriptions, savePushSubscription, setPushAlerts } from '../src/push/store.js';
import { blankObservation, evaluateWatchdogs, type Check } from '../src/shopify/watchdogs.js';
import type { Facts } from '../src/shopify/metrics.js';
import { defaultSettings } from '../src/settings.js';
import { createTestDatabase } from './helpers/database.js';

const quietHours = {start: '22:00', end: '07:00'};
const baselineTime = '2032-12-07T10:00:00Z';
const check = (status: Check['status'], id = 'orders'): Check => ({id, name: 'Orders flowing', status,
  why: 'No paid order in 3 hours; 4 paid orders in the comparison.', link: '/sources'});
async function subscription(db: Database, id: string, alerts = true) {
  const receiver = createECDH('prime256v1'); receiver.generateKeys();
  const row = {endpoint: `https://fcm.googleapis.com/fcm/send/invented-alert-${id}`,
    keys: {p256dh: receiver.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url')}};
  await savePushSubscription(db, `invented-${id}`, row, new Date(baselineTime));
  if (alerts) await setPushAlerts(db, `invented-${id}`, row.endpoint, true, new Date(baselineTime));
  return row;
}
async function harness(t: TestContext, alerts = true) {
  const db = await createTestDatabase(); t.after(() => db.close());
  const sub = await subscription(db, 'first', alerts), sent: {endpoint: string; payload: PushPayload}[] = [];
  const send = async (row: {endpoint: string}, payload: PushPayload) => { sent.push({endpoint: row.endpoint, payload}); };
  const tick = (time: string, status: Check['status'], extra: Partial<AlertEvaluation> = {}) => deliverAlerts(db,
    {evaluationId: time, checks: [check(status)], monthlyUploadOpen: false, ...extra}, quietHours, new Date(time), send);
  const baseline = async () => { await tick(baselineTime, 'pass'); await tick('2032-12-07T10:01:00Z', 'pass'); };
  return {db, sub, sent, send, tick, baseline};
}

test('quiet hours use UK wall time, include the start, exclude the end, and equal means disabled', () => {
  for (const [start, end] of [['2032-12-07T22:00:00Z', '2032-12-08T07:00:00Z'],
    ['2032-06-07T21:00:00Z', '2032-06-08T06:00:00Z']]) {
    assert.equal(inAlertQuietHours(new Date(Date.parse(start!) - 1), quietHours), false);
    assert.equal(inAlertQuietHours(new Date(start!), quietHours), true);
    assert.equal(inAlertQuietHours(new Date(Date.parse(end!) - 1), quietHours), true);
    assert.equal(inAlertQuietHours(new Date(end!), quietHours), false);
  }
  for (const hour of ['00', '06', '12', '23']) assert.equal(inAlertQuietHours(new Date(`2032-12-07T${hour}:00:00Z`), {start: '07:00', end: '07:00'}), false);
  assert.equal(inAlertQuietHours(new Date('2032-12-07T11:00:00Z'), {start: '10:00', end: '12:00'}), true);
  assert.equal(inAlertQuietHours(new Date('2032-12-07T12:00:00Z'), {start: '10:00', end: '12:00'}), false);
});

test('a silent baseline and distinct evaluations prevent cached reads and unknown gaps from confirming a state', () => {
  let state = observeAlert(null, 'pass', 'invented-evaluation-1', false);
  state = observeAlert(state, 'pass', 'invented-evaluation-1', false);
  assert.equal(state.confirmedStatus, null);
  state = observeAlert(state, 'pass', 'invented-evaluation-2', false);
  assert.equal(state.confirmedStatus, 'pass'); assert.equal(state.revision, 0);
  state = observeAlert(state, 'tripped', 'invented-evaluation-3', false);
  state = observeAlert(state, 'unknown', 'invented-evaluation-4', false);
  state = observeAlert(state, 'tripped', 'invented-evaluation-5', false);
  assert.equal(state.confirmedStatus, 'pass'); assert.equal(state.revision, 0);
  state = observeAlert(state, 'tripped', 'invented-evaluation-6', false);
  assert.equal(state.confirmedStatus, 'tripped'); assert.equal(state.revision, 1);
});

test('fixed watchdog names and generated why lines contain no ticket data; obvious contact strings are scrubbed defensively', () => {
  const now = new Date(baselineTime);
  const facts: Facts = {mode: 'live', sample: false, counts: {}, pendingWebhooks: 0, failedWebhooks: [], notices: [], geoNotice: null,
    noticeDetails: [], records: [], jobs: ['backfill','poll','sessions','inventory','reconcile','subscriptions'].map(name => ({name,
      state: name === 'backfill' ? {from: '2032-11-01', allOrders: true, ordersDone: true} : {}, last_success_at: now, failures: 0}))};
  const generated = evaluateWatchdogs(facts, now, defaultSettings(), blankObservation(), [], []).find(row => row.id === 'orders')!;
  const payload = watchdogAlertPayload('orders', 'tripped', generated.why, now);
  assert.equal(payload.title, '✕ Orders flowing'); assert.equal(payload.body, generated.why);
  assert.deepEqual(Object.keys(payload).sort(), ['alertKey','body','day','kind','path','title']);
  const guarded = watchdogAlertPayload('ads_check', 'tripped', 'No check for 2032-12-06 by 09:00 UK. invented@example.test https://example.test/private +44 7700 900321 (555) 321-6789', now);
  assert.match(guarded.body, /2032-12-06 by 09:00 UK/);
  assert.doesNotMatch(guarded.body, /invented@|example\.test|7700|555|321-6789/);
});

test('one trip, one rate-limited recovery, no repeated or restarted delivery and no non-allowlisted payload', async t => {
  const h = await harness(t); await h.baseline();
  await h.tick('2032-12-07T10:02:00Z', 'tripped');
  await h.tick('2032-12-07T10:02:00Z', 'tripped');
  assert.equal(h.sent.length, 0);
  await h.tick('2032-12-07T10:03:00Z', 'tripped', {checks: [check('tripped'),
    {...check('tripped', 'channel-invented'), name: 'Invented private person', why: 'invented@example.test'}, check('tripped', 'us_cart')]});
  assert.equal(h.sent.length, 1);
  assert.deepEqual(h.sent[0]!.payload, {kind: 'alert', alertKey: 'orders', title: '✕ Orders flowing',
    body: check('tripped').why, path: '/alerts/check/orders', day: '2032-12-07'});
  assert.doesNotMatch(JSON.stringify(h.sent), /private person|invented@example|channel-invented|us_cart/);
  await h.tick('2032-12-07T10:04:00Z', 'tripped');
  await h.tick('2032-12-07T10:05:00Z', 'pass'); await h.tick('2032-12-07T10:06:00Z', 'pass');
  await h.tick('2032-12-07T10:32:59Z', 'pass'); assert.equal(h.sent.length, 1);
  await h.tick('2032-12-07T10:33:00Z', 'pass'); assert.equal(h.sent.length, 2);
  assert.equal(h.sent[1]!.payload.title, '✓ Orders flowing recovered');
  await h.tick('2032-12-07T11:33:00Z', 'pass');
  // A fresh caller after restart has no in-memory history: all duplicate protection is durable.
  await deliverAlerts(h.db, {evaluationId: '2032-12-07T11:34:00Z', checks: [check('pass')], monthlyUploadOpen: false},
    quietHours, new Date('2032-12-07T11:34:00Z'), h.send);
  assert.equal(h.sent.length, 2);
});

test('a flap before two evaluations sends nothing; unknown never releases a pending alert', async t => {
  const h = await harness(t); await h.baseline();
  await h.tick('2032-12-07T10:02:00Z', 'tripped'); await h.tick('2032-12-07T10:03:00Z', 'pass');
  await h.tick('2032-12-07T10:04:00Z', 'unknown'); await h.tick('2032-12-07T10:05:00Z', 'tripped');
  assert.equal(h.sent.length, 0);
  await h.tick('2032-12-07T10:06:00Z', 'tripped'); assert.equal(h.sent.length, 1);
  await h.tick('2032-12-07T10:07:00Z', 'pass'); await h.tick('2032-12-07T10:08:00Z', 'pass');
  await h.tick('2032-12-07T10:40:00Z', 'unknown'); assert.equal(h.sent.length, 1);
  await h.tick('2032-12-07T10:41:00Z', 'pass'); assert.equal(h.sent.length, 1);
  await h.tick('2032-12-07T10:42:00Z', 'pass'); assert.equal(h.sent.length, 2);
});

test('quiet trips release at seven only if still confirmed tripped; quiet recovery is dropped forever', async t => {
  const h = await harness(t); await h.baseline();
  await h.tick('2032-12-07T22:00:00Z', 'tripped'); await h.tick('2032-12-07T22:01:00Z', 'tripped');
  await h.tick('2032-12-08T06:59:00Z', 'tripped'); assert.equal(h.sent.length, 0);
  await h.tick('2032-12-08T07:00:00Z', 'tripped'); assert.equal(h.sent.length, 1);
  await h.tick('2032-12-08T22:00:00Z', 'pass'); await h.tick('2032-12-08T22:01:00Z', 'pass');
  await h.tick('2032-12-09T07:00:00Z', 'pass'); assert.equal(h.sent.length, 1);
  await h.tick('2032-12-09T07:01:00Z', 'tripped'); await h.tick('2032-12-09T07:02:00Z', 'tripped');
  assert.equal(h.sent.length, 2, 'A new trip after a dropped recovery is still a new event');
});

test('quiet trips that recover before seven disappear; a stale unknown cannot release a trip', async t => {
  const h = await harness(t); await h.baseline();
  await h.tick('2032-12-07T22:00:00Z', 'tripped'); await h.tick('2032-12-07T22:01:00Z', 'tripped');
  await h.tick('2032-12-08T06:58:00Z', 'pass'); await h.tick('2032-12-08T06:59:00Z', 'pass');
  await h.tick('2032-12-08T07:00:00Z', 'pass'); assert.equal(h.sent.length, 0);
  await h.tick('2032-12-08T22:00:00Z', 'tripped'); await h.tick('2032-12-08T22:01:00Z', 'tripped');
  await h.tick('2032-12-09T07:00:00Z', 'unknown'); assert.equal(h.sent.length, 0);
  await h.tick('2032-12-09T07:01:00Z', 'tripped'); assert.equal(h.sent.length, 0);
  await h.tick('2032-12-09T07:02:00Z', 'tripped'); assert.equal(h.sent.length, 1);
});

test('a slow batch respects the quiet boundary for later devices without consuming their held trip', async t => {
  const h = await harness(t); await subscription(h.db, 'second'); await h.baseline();
  await h.tick('2032-12-07T21:58:00Z', 'tripped');
  let now = new Date('2032-12-07T21:59:00Z');
  const input = {evaluationId: now.toISOString(), checks: [check('tripped')], monthlyUploadOpen: false};
  await deliverAlerts(h.db, input, quietHours, now, async (row, payload) => {
    await h.send(row, payload); now = new Date('2032-12-07T22:00:00Z');
  }, () => now);
  assert.equal(h.sent.length, 1);
  await h.tick('2032-12-08T07:00:00Z', 'tripped'); assert.equal(h.sent.length, 2);
  assert.notEqual(h.sent[0]!.endpoint, h.sent[1]!.endpoint);
});

test('a slow batch leaves later watchdog and monthly claims untaken when its input becomes stale', async t => {
  const h = await harness(t); await subscription(h.db, 'second'); await h.baseline();
  await h.tick('2032-12-07T10:02:00Z', 'tripped');
  let now = new Date('2032-12-07T10:03:00Z');
  const input = {evaluationId: now.toISOString(), checks: [check('tripped')], monthlyUploadOpen: true};
  await deliverAlerts(h.db, input, quietHours, now, async (row, payload) => {
    await h.send(row, payload); now = new Date('2032-12-07T10:05:01Z');
  }, () => now);
  assert.equal(h.sent.length, 1);
  assert.equal((await h.db.query('SELECT 1 FROM pulse.push_alert_devices WHERE last_sent_at IS NOT NULL')).rowCount, 1);
  assert.equal((await h.db.query('SELECT 1 FROM pulse.push_alert_months')).rowCount, 0);
  await h.tick('2032-12-07T10:06:00Z', 'tripped', {monthlyUploadOpen: false});
  assert.equal(h.sent.length, 2); assert.notEqual(h.sent[0]!.endpoint, h.sent[1]!.endpoint);
  assert.ok(h.sent.every(row => row.payload.alertKey === 'orders'));
});

test('a batch crossing the UK month cannot claim the new month from the previous month need', async t => {
  const h = await harness(t);
  const now = new Date('2032-12-31T23:59:30Z');
  await deliverAlerts(h.db, {evaluationId: now.toISOString(), checks: [], monthlyUploadOpen: true},
    {start: '07:00', end: '07:00'}, now, h.send, () => new Date('2033-01-01T00:00:05Z'));
  assert.equal(h.sent.length, 0); assert.equal((await h.db.query('SELECT 1 FROM pulse.push_alert_months')).rowCount, 0);
});

test('a recovery evaluated inside quiet hours is dropped even when its delivery tick starts after seven', async t => {
  const h = await harness(t); await h.baseline();
  await h.tick('2032-12-07T10:02:00Z', 'tripped'); await h.tick('2032-12-07T10:03:00Z', 'tripped');
  await h.tick('2032-12-08T06:58:00Z', 'pass');
  await deliverAlerts(h.db, {evaluationId: '2032-12-08T06:59:00Z', checks: [check('pass')], monthlyUploadOpen: false},
    quietHours, new Date('2032-12-08T07:00:00Z'), h.send);
  await h.tick('2032-12-08T07:01:00Z', 'pass'); assert.equal(h.sent.length, 1);
});

test('Alerts is opt-in per device; monthly reminders catch up once per open month and survive restart', async t => {
  const h = await harness(t, false), enabled = await subscription(h.db, 'second');
  await h.baseline();
  await h.tick('2032-12-07T10:02:00Z', 'tripped'); await h.tick('2032-12-07T10:03:00Z', 'tripped', {monthlyUploadOpen: true});
  assert.deepEqual(h.sent.map(row => [row.endpoint, row.payload.alertKey]), [[enabled.endpoint, 'orders'], [enabled.endpoint, 'jj-monthly']]);
  await h.tick('2032-12-07T10:04:00Z', 'tripped', {monthlyUploadOpen: true});
  await h.tick('2032-12-08T10:04:00Z', 'tripped', {monthlyUploadOpen: true}); assert.equal(h.sent.length, 2);
  await h.tick('2033-01-04T10:04:00Z', 'tripped', {monthlyUploadOpen: false}); assert.equal(h.sent.length, 2);
  await h.tick('2033-01-04T10:05:00Z', 'tripped', {monthlyUploadOpen: true}); assert.equal(h.sent.length, 3);
  assert.equal(h.sent.at(-1)!.payload.path, '/fulfilment');
  assert.equal((await h.db.query('SELECT 1 FROM pulse.push_alert_months')).rowCount, 2);
});

test('custom quiet hours delay the monthly reminder until quiet ends and do not claim early', async t => {
  const h = await harness(t);
  const input = {evaluationId: baselineTime, checks: [], monthlyUploadOpen: true};
  const hours = {start: '08:00', end: '11:00'};
  await deliverAlerts(h.db, input, hours, new Date(baselineTime), h.send);
  assert.equal(h.sent.length, 0); assert.equal((await h.db.query('SELECT 1 FROM pulse.push_alert_months')).rowCount, 0);
  await deliverAlerts(h.db, input, hours, new Date('2032-12-07T11:00:00Z'), h.send);
  assert.equal(h.sent.length, 1); assert.equal(h.sent[0]!.payload.alertKey, 'jj-monthly');
});

test('a newly enabled device starts at the current state and a throttled flap returning to its acknowledged state is consumed', async t => {
  const h = await harness(t); await h.baseline();
  await h.tick('2032-12-07T10:02:00Z', 'tripped'); await h.tick('2032-12-07T10:03:00Z', 'tripped');
  const second = await subscription(h.db, 'late', false);
  await setPushAlerts(h.db, 'invented-late', second.endpoint, true, new Date('2032-12-07T10:04:00Z'));
  await h.tick('2032-12-07T10:04:00Z', 'tripped'); assert.equal(h.sent.length, 1);
  await h.tick('2032-12-07T10:05:00Z', 'pass'); await h.tick('2032-12-07T10:06:00Z', 'pass');
  await h.tick('2032-12-07T10:07:00Z', 'tripped'); await h.tick('2032-12-07T10:08:00Z', 'tripped');
  await h.tick('2032-12-07T11:00:00Z', 'tripped');
  assert.deepEqual(h.sent.filter(row => row.endpoint === h.sub.endpoint).map(row => row.payload.title), ['✕ Orders flowing']);
});

test('initial tripped state stays silent, concurrent callers claim once, and failure does not release a claim', async t => {
  const h = await harness(t);
  await h.tick('2032-12-07T10:00:00Z', 'tripped'); await h.tick('2032-12-07T10:01:00Z', 'tripped');
  assert.equal(h.sent.length, 0);
  await h.tick('2032-12-07T10:02:00Z', 'pass');
  const input = {evaluationId: '2032-12-07T10:03:00Z', checks: [check('pass')], monthlyUploadOpen: false};
  await Promise.all([deliverAlerts(h.db, input, quietHours, new Date(input.evaluationId), h.send),
    deliverAlerts(h.db, input, quietHours, new Date(input.evaluationId), h.send)]);
  assert.equal(h.sent.length, 1);
  await h.tick('2032-12-07T11:02:00Z', 'tripped');
  let attempts = 0;
  await assert.rejects(deliverAlerts(h.db, {...input, evaluationId: '2032-12-07T11:03:00Z', checks: [check('tripped')]}, quietHours,
    new Date('2032-12-07T11:03:00Z'), async () => { attempts++; throw new Error('Invented transport failure'); }));
  await h.tick('2032-12-07T11:04:00Z', 'tripped'); assert.equal(h.sent.length, 1); assert.equal(attempts, 1);
});

test('late delivery guards reject an opted-out, replaced or removed registration', async t => {
  const h = await harness(t), saved = (await readPushSubscriptions(h.db))[0]!;
  assert.equal(await alertDeviceCurrent(h.db, saved), true);
  await setPushAlerts(h.db, saved.credentialId, saved.endpoint, false, new Date(baselineTime));
  assert.equal(await alertDeviceCurrent(h.db, saved), false);
  await setPushAlerts(h.db, saved.credentialId, saved.endpoint, true, new Date(baselineTime));
  await h.db.query('UPDATE pulse.push_subscriptions SET auth=$2 WHERE endpoint=$1', [saved.endpoint, randomBytes(16).toString('base64url')]);
  assert.equal(await alertDeviceCurrent(h.db, saved), false);
  await h.db.query('DELETE FROM pulse.push_subscriptions WHERE endpoint=$1', [saved.endpoint]);
  assert.equal(await alertDeviceCurrent(h.db, saved), false);
});

test('out-of-order evaluations never confirm a transition or deliver a newer transition from older input', async t => {
  const h = await harness(t); await h.baseline();
  await h.tick('2032-12-07T10:05:00Z', 'tripped');
  await h.tick('2032-12-07T10:04:00Z', 'tripped'); assert.equal(h.sent.length, 0);
  let stored = (await h.db.query<{evaluation_id: string; candidate_count: number; confirmed_status: string}>(
    "SELECT evaluation_id,candidate_count,confirmed_status FROM pulse.push_alert_checks WHERE check_id='orders'")).rows[0]!;
  assert.deepEqual(stored, {evaluation_id: '2032-12-07T10:05:00Z', candidate_count: 1, confirmed_status: 'pass'});
  await h.tick('2032-12-07T10:06:00Z', 'tripped'); assert.equal(h.sent.length, 1);
  await h.tick('2032-12-07T10:04:00Z', 'pass'); await h.tick('2032-12-07T10:05:00Z', 'pass');
  stored = (await h.db.query<{evaluation_id: string; candidate_count: number; confirmed_status: string}>(
    "SELECT evaluation_id,candidate_count,confirmed_status FROM pulse.push_alert_checks WHERE check_id='orders'")).rows[0]!;
  assert.equal(stored.confirmed_status, 'tripped'); assert.equal(stored.evaluation_id, '2032-12-07T10:06:00Z');
  await h.tick('2032-12-07T11:00:00Z', 'unknown', {evaluationId: 'stale:2032-12-07T10:06:00Z'});
  await h.tick('2032-12-07T11:01:00Z', 'tripped', {evaluationId: '2032-12-07T10:06:00Z'});
  const raw = (await h.db.query<{raw_status: string}>("SELECT raw_status FROM pulse.push_alert_checks WHERE check_id='orders'")).rows[0]!;
  assert.equal(raw.raw_status, 'unknown', 'An older fresh read cannot override the stale marker');
  assert.equal(h.sent.length, 1);
});

test('the existing service queue sends alerts with summaries off, coalesces waiting ticks and logs failures safely', async t => {
  const h = await harness(t);
  let now = new Date(baselineTime), status: Check['status'] = 'pass', loads = 0, attempts = 0, fail = false;
  const logs: string[] = [];
  const service = new PushService(h.db, {origin: 'https://pulse.example.test', clock: () => now, sleep: async () => {}, log: line => logs.push(line),
    loadMorning: async () => { throw new Error('Disabled summaries must not load'); },
    loadAlerts: async () => { loads++; if (fail) throw new Error('invented-private-detail@example.test');
      return {evaluationId: now.toISOString(), checks: [check(status)], monthlyUploadOpen: false}; },
    transport: async request => { attempts++; assert.equal(request.headers.TTL, '21600'); return {status: 201}; }});
  await service.tick(); now = new Date('2032-12-07T10:01:00Z'); await service.tick();
  status = 'tripped'; now = new Date('2032-12-07T10:02:00Z'); await service.tick();
  now = new Date('2032-12-07T10:03:00Z'); const pending = service.tick(); assert.equal(service.tick(), pending); await pending;
  assert.equal(loads, 4); assert.equal(attempts, 1);
  fail = true; now = new Date('2032-12-07T10:04:00Z'); await assert.doesNotReject(service.tick());
  assert.deepEqual(logs, ['Watchdog push alerts failed; claimed deliveries remain taken.']);
  await service.stop(); await service.tick(); assert.equal(loads, 5);
});
