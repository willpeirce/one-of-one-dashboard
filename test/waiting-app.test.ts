import assert from 'node:assert/strict';
import {createHmac, randomBytes} from 'node:crypto';
import test from 'node:test';
import {createApp} from '../src/app.js';
import {readRuntime} from '../src/runtime.js';
import type {WaitingView} from '../src/waiting-on/model.js';
import type {DashboardSnapshot} from '../src/dashboard-types.js';
import {waitingReadDetails} from '../src/views.js';
import {changedSourceScopes, fenceDashboardScopes} from '../src/morning/control-overlay.js';
import {defaultSettings} from '../src/settings.js';
import {createTestDatabase} from './helpers/database.js';

test('the signed-in Handover page keeps local waiting rows without HQ keys and publishes their existing Watch need', async t => {
  const db = await createTestDatabase(), now = new Date('2037-10-26T09:00:00Z');
  const config = readRuntime({DATABASE_URL: 'postgresql://localhost/invented_waiting', APP_ORIGIN: 'https://pulse.example.test'});
  const app = await createApp(db, config, {}, {}, {}, {}, {}, {clock: () => now});
  t.after(async () => {await app.close(); await db.close();});
  assert.equal((await app.inject('/api/waiting-on')).statusCode, 401);
  const key = (await db.query<{value: Uint8Array}>("SELECT value FROM pulse_private.app_secrets WHERE name='session_hmac'")).rows[0]!;
  const token = randomBytes(32).toString('base64url'), credential = randomBytes(32).toString('base64url');
  await db.query('INSERT INTO pulse_private.credentials(id,public_key) VALUES($1,$2)', [credential, randomBytes(32)]);
  await db.query("INSERT INTO pulse_private.sessions(token_hash,credential_id,expires_at) VALUES($1,$2,now()+interval '30 days')",
    [createHmac('sha256', Buffer.from(key.value)).update(token).digest('hex'), credential]);
  const headers = {cookie: `__Host-pulse_session=${token}`, origin: config.origin, 'content-type': 'application/json'};
  const initial = await app.inject({url: '/handover', headers});
  assert.match(initial.body, /Customer service/); assert.match(initial.body, /Waiting on others/); assert.match(initial.body, /Not set up yet/);
  const added = await app.inject({method: 'POST', url: '/api/waiting-on/add', headers,
    payload: {contact: 'Invented supplier team', subject: 'Confirm the sample packaging', since: '2037-10-19'}});
  assert.equal(added.statusCode, 200); assert.equal(added.json().saved, true);
  const view = added.json<{view: WaitingView}>().view;
  assert.equal(view.rows.length, 1); assert.equal(view.rows[0]!.days, 7); assert.equal(view.mode, 'sample');
  const dashboard = (await app.inject({url: '/api/dashboard', headers})).json<DashboardSnapshot>();
  const need = dashboard.shopify!.needs.find(row => row.id === 'waiting-on-overdue')!;
  assert.ok(need); assert.equal(need.state, 'warn'); assert.equal(need.sourceMode, 'live'); assert.equal(need.link, '/handover');
  const changed = changedSourceScopes(defaultSettings(), {...defaultSettings(), waitingOnDays: 9});
  assert.equal(fenceDashboardScopes(dashboard, changed).shopify!.needs.some(row => row.id === need.id), false);
  assert.ok(fenceDashboardScopes(dashboard, changed).sourceHealth!.some(row => row.source === 'github-hq'), 'A threshold change does not conceal HQ health');
  const sources = await app.inject({url: '/sources', headers});
  assert.match(sources.body, /data-waiting-read-health/); assert.match(sources.body, /0 malformed rows skipped/);
  const done = await app.inject({method: 'POST', url: '/api/waiting-on/done', headers, payload: {id: view.rows[0]!.id}});
  assert.equal(done.statusCode, 200); assert.equal(done.json().view.rows.length, 0); assert.equal(done.json().view.done.length, 1);
  const restored = await app.inject({method: 'POST', url: '/api/waiting-on/restore', headers, payload: {id: view.rows[0]!.id}});
  assert.equal(restored.statusCode, 200); assert.equal(restored.json().view.rows.length, 1);
});

test('Sources exposes waiting parser diagnostics without showing contact or subject values', () => {
  const view: WaitingView = {mode: 'live', status: 'ready', updatedLabel: '2037-10-26 09:00 UK', readAt: '2037-10-26T09:00:00Z',
    asOf: '2037-10-26T09:00:00Z', malformedRows: 3, cappedRows: 2, thresholdDays: 7, done: [], rows: [
      {id: 'manual:invented', source: 'manual', contact: 'Invented private business', subject: 'Invented private subject', since: '2037-10-19', days: 7},
    ]};
  const html = waitingReadDetails(view);
  assert.match(html, /3 malformed rows skipped · 2 valid rows beyond/);
  assert.match(html, /2037-10-26 09:00 UK/);
  assert.doesNotMatch(html, /Invented private/);
  const missing = waitingReadDetails({...view, status: 'missing'});
  assert.match(missing, /this is not an error/);
  assert.doesNotMatch(missing, /source is healthy/);
});
