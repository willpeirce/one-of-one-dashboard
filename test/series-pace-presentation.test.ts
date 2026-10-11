import assert from 'node:assert/strict';
import test from 'node:test';
import { dashboardPage } from '../src/dashboard-view.js';
import { dashboardTemplate } from '../src/dashboard-template.js';
import { defaultSettings } from '../src/settings.js';
import { getSampleDashboard } from '../src/sample-dashboard.js';
import { sampleSeriesPaceCard, seriesPaceDial, seriesPaceFacts, seriesPaceSheetHtml } from '../src/series-pace/presentation.js';

test('Series 1 replaces only the Meta spend dial and keeps both markets and Google spend', () => {
  const snapshot = getSampleDashboard();
  assert.equal(snapshot.widgets.w017?.kind, 'series-pace');
  const html = dashboardPage(snapshot);
  assert.match(html, /<article class="tile series-pace"[^>]*data-model-id="w017"/);
  assert.match(html, /<h3>Series 1 sell-out pace<\/h3>/);
  assert.match(html, /data-series-market="UK"/);
  assert.match(html, /data-series-market="US"/);
  for (let index = 18; index <= 24; index += 1) assert.ok(html.includes(`data-model-id="w0${index}"`));
  assert.equal(snapshot.widgets.w024?.kind, 'dial');
  assert.ok(snapshot.widgets.w024?.source.includes('google-ads'));
  assert.ok(!dashboardTemplate.includes('{{widget:w017}}'));
  assert.ok(!JSON.stringify(snapshot.widgets.w017).includes('Our spend vs plan'));
});

test('sample pace ignores Settings and presents exact invented targets and daily correction', () => {
  const changed = { ...defaultSettings(), series1UkTargetDate: '2030-01-01', series1OrderDate: '2030-01-01' };
  assert.deepEqual(getSampleDashboard(changed).widgets.w017, getSampleDashboard().widgets.w017);
  const card = sampleSeriesPaceCard('2026-09-30T06:41:00Z');
  const uk = seriesPaceFacts(card.markets.UK), us = seriesPaceFacts(card.markets.US);
  assert.match(uk, /1,850/); assert.match(uk, /120 days to target/); assert.match(uk, /15\.4 needed/);
  assert.match(uk, /15\.0 average/); assert.match(uk, /sell about 0\.4 more a day/);
  assert.match(uk, /last 3 days: 15\.3 a day ↑/); assert.match(uk, /7-day average, complete days to 29 Sept 2026/);
  assert.match(us, /2,400/); assert.match(us, /90 days to target/); assert.match(us, /last 3 days: 15\.0 a day ↓/);
  assert.equal(seriesPaceDial('UK', card.markets.UK).cap, 'good');
  assert.equal(seriesPaceDial('US', card.markets.US).cap, 'warn');
  assert.ok(seriesPaceDial('US', card.markets.US).z.every(zone => zone[2] !== 'alarm'));
});

test('pace sheet shows signed days, missing days, snapshot time and late flag, and target in force', () => {
  const model = sampleSeriesPaceCard('2026-09-30T06:41:00Z').markets.UK;
  model.days[0]!.sold = -4; model.days[0]!.source = 'snapshot'; model.days.splice(1, 1);
  model.targetOverride = '2027-01-12'; model.targetDate = model.targetOverride;
  model.snapshots = [{ day: '2026-09-23', takenAt: '2026-09-23T02:12:00Z', late: true }];
  const live = seriesPaceSheetHtml('UK', model, 'live');
  assert.match(live, /<td>-4<\/td><td>Snapshot<\/td>/);
  assert.match(live, /<td>Unknown<\/td><td>Not available<\/td>/);
  assert.match(live, /ShopifyQL/); assert.match(live, /03:12 UK · late/);
  assert.match(live, /Target in force: <strong>12 Jan 2027<\/strong> · your date/);
  assert.match(live, /id="series-target-date"[^>]*value="2027-01-12"/);
  assert.ok(!live.includes('<fieldset disabled>'));
  const sample = seriesPaceSheetHtml('UK', model, 'sample');
  assert.match(sample, /<fieldset disabled>/);
  assert.match(sample, /Target dates cannot be changed in sample mode/);
  assert.match(sample, /data-series-use-landing>Use landing date/);
});
