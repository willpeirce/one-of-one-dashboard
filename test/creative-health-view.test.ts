import test from 'node:test';
import assert from 'node:assert/strict';
import { creativeHealthDetails } from '../src/views.js';
import { reconciliationLine, type CreativeHealth } from '../src/creatives/store.js';

const health: CreativeHealth = {
  mode: 'live', catalogueCount: 12, backfillNext: '2026-09-04', backfillDone: false,
  completedDays: 28, totalDays: 68, bytes: 2 * 1024 * 1024, capBytes: 300 * 1024 * 1024,
  lastSuccessAt: '2026-10-13T09:00:00Z', reconciliation: null, error: null,
};

test('creative health shows catalogue, durable progress, storage and last read', () => {
  const html = creativeHealthDetails(health);
  assert.match(html, /Catalogue: 12 ads/);
  assert.match(html, /28 of 68 days read · next 2026-09-04/);
  assert.match(html, /2\.0 MB of 300\.0 MB/);
  assert.match(html, /datetime="2026-10-13T09:00:00.000Z"/);
  assert.match(html, /hero keeps the ad-set spend figure/);
});

test('only material reconciled gaps appear, and health diagnostics are escaped', () => {
  assert.doesNotMatch(creativeHealthDetails({ ...health, reconciliation: reconciliationLine([{ percent: 0.5, day: '2026-10-12' }]) }), /data-creative-reconciliation/);
  const html = creativeHealthDetails({ ...health, reconciliation: reconciliationLine([{ percent: 1.5, day: '2026-10-12' }]), error: '<invalid>' });
  assert.match(html, /differs from ad set spend by 1.5% on 1 day/);
  assert.match(html, /&lt;invalid&gt;/);
  assert.doesNotMatch(html, /<invalid>/);
});


test('creative health supports other account timezones and reserves unsupported-account notice for currency', () => {
  for (const mode of ['live', 'sample'] as const) {
    const html = creativeHealthDetails({ ...health, mode, error: 'unsupported_account' });
    assert.match(html, /Creative insights need a GBP account\./);
    assert.doesNotMatch(html, /GBP account using Europe\/London days/);
    assert.match(html, /hourly reports are aligned to Europe\/London when the Meta account timezone differs/);
    assert.match(html, /Reach, frequency and average play time keep Meta account days/);
  }
});
