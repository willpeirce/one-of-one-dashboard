import assert from 'node:assert/strict';
import test from 'node:test';
import {blankObservation, evaluateWatchdogs} from '../src/shopify/watchdogs.js';
import type {Facts} from '../src/shopify/metrics.js';
import type {SourceHealth} from '../src/sources.js';
import {defaultSettings} from '../src/settings.js';

const at = new Date('2032-04-07T12:00:00Z');
const facts: Facts = {mode: 'sample', sample: true, counts: {}, pendingWebhooks: 0, failedWebhooks: [], notices: [],
  geoNotice: null, noticeDetails: [], records: [], jobs: []};
const health: SourceHealth = {source: 'gorgias', name: 'Gorgias', stage: 5, requiredKeys: [], mode: 'live', status: 'healthy',
  lastSuccessAt: at, lastAttemptAt: at, consecutiveFailures: 0, updatedAt: at};
const check = (source: SourceHealth, now: Date, viewId = '') => evaluateWatchdogs(facts, new Date('2030-01-01T12:00:00Z'),
  {...defaultSettings(), gorgiasHandoverViewId: viewId},
  blankObservation(), [], [source], {entry: null, now}).find(row => row.id === 'self')!;

test('Self-check follows view/tag freshness using the local clock in mixed source modes', () => {
  for (const [viewId, minutes] of [['71001', 6], ['', 30]] as const) {
    assert.equal(check(health, new Date(+at + minutes * 60_000), viewId).status, 'pass');
    const stale = check(health, new Date(+at + minutes * 60_000 + 1), viewId);
    assert.equal(stale.status, 'tripped'); assert.equal(stale.link, '/sources'); assert.match(stale.why, /Gorgias/);
  }
  assert.equal(check(health, new Date(+at + 9 * 60_000)).status, 'pass', 'Tag mode stays fresh between ten-minute polls');
  assert.equal(check({...health, mode: 'sample'}, new Date(+at + 60 * 60_000)).status, 'pass');
  assert.equal(check({...health, status: 'error', consecutiveFailures: 1}, at).status, 'pass');
  assert.equal(check({...health, status: 'error', consecutiveFailures: 2}, at).status, 'tripped');
});
