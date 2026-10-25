import test from 'node:test';
import assert from 'node:assert/strict';
import { creativeHealthDetails } from '../src/views.js';
import { reconciliationLine, type CreativeHealth } from '../src/creatives/store.js';

const health: CreativeHealth = {
  mode: 'live', catalogueCount: 12, reducedCount: 2, backfillNext: '2026-09-04', backfillDone: false,
  completedDays: 28, totalDays: 68, bytes: 2 * 1024 * 1024, capBytes: 300 * 1024 * 1024,
  lastSuccessAt: '2026-10-13T09:00:00Z', reconciliation: null, error: null,
};

test('creative health shows catalogue, durable progress, storage and last read', () => {
  const html = creativeHealthDetails(health);
  assert.match(html, /Catalogue: 12 ads/);
  assert.match(html, /2 creatives at reduced detail/);
  assert.match(html, /28 of 68 days read · next 2026-09-04/);
  assert.match(html, /2\.0 MB of 300\.0 MB/);
  assert.match(html, /datetime="2026-10-13T09:00:00.000Z"/);
  assert.match(html, /hero keeps the ad-set spend figure/);
});

test('only material reconciled gaps appear, and health diagnostics are escaped', () => {
  assert.doesNotMatch(creativeHealthDetails({ ...health, reconciliation: reconciliationLine([{ adSpend: 2.4, setSpend: 2, day: '2026-10-12' }]) }), /data-creative-reconciliation/);
  const html = creativeHealthDetails({ ...health, reconciliation: reconciliationLine([{ adSpend: 41.4, setSpend: 46.4, day: '2026-10-12' }]), error: '<invalid>' });
  assert.match(html, /differs from ad set spend on 12 Oct: £41.40 against £46.40 \(1 set\)/);
  assert.match(html, /&lt;invalid&gt;/);
  assert.doesNotMatch(html, /<invalid>/);
});

test('creative health preserves the safe diagnostic and failing step unchanged', () => {
  for (const error of ['http 400, meta 100/1815001 at catalogue after 0 ads', 'timeout at catalogue after 150 ads',
    'http 400, meta 100/1815001 at insights', 'http 400, meta 100/1815001 at backfill']) {
    const html = creativeHealthDetails({ ...health, error });
    assert.ok(html.includes(`Creative read needs attention (${error}).`));
    assert.match(html, /Stored data is retained/);
  }
});


test('creative health supports other account timezones and reserves unsupported-account notice for currency', () => {
  for (const mode of ['live', 'sample'] as const) {
    for (const error of ['unsupported_account', 'unsupported_account at catalogue', 'unsupported_account at catalogue after 0 ads', 'unsupported_account at insights']) {
      const html = creativeHealthDetails({ ...health, mode, error });
      assert.ok(html.includes(`Creative read needs attention (${error}).`));
      assert.match(html, /Creative insights need a GBP account\./);
      assert.doesNotMatch(html, /GBP account using Europe\/London days/);
      assert.match(html, /hourly reports are aligned to Europe\/London when the Meta account timezone differs/);
      assert.match(html, /Reach, frequency and average play time keep Meta account days/);
    }
  }
});

test('spend gap ignores pennies and names the worst day, both day totals and affected set count', () => {
 assert.equal(reconciliationLine([{day:'2026-10-22',adSpend:1.6,setSpend:2}]),null);
 assert.equal(reconciliationLine([
  {day:'2026-10-21',adSpend:3,setSpend:5},
  {day:'2026-10-22',adSpend:20,setSpend:25},
  {day:'2026-10-22',adSpend:21.2,setSpend:26.2},
 ]),'Meta ad-level spend differs from ad set spend on 22 Oct: £41.20 against £51.20 (2 sets)');
});
