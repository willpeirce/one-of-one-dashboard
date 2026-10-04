import assert from 'node:assert/strict';
import test from 'node:test';
import { dashboardPage } from '../src/dashboard-view.js';
import { dashboardTemplate } from '../src/dashboard-template.js';
import { getSampleDashboard } from '../src/sample-dashboard.js';
import { defaultSettings } from '../src/settings.js';
import { sourceDefinitions } from '../src/sources.js';

test('every dashboard binding resolves from source-tagged server sample data', () => {
  const snapshot = getSampleDashboard();
  const sources = new Set<string>(sourceDefinitions.map((source) => source.id));
  assert.equal(snapshot.mode, 'sample');
  assert.equal(snapshot.brand, 'one-of-one');
  for (const item of [...Object.values(snapshot.widgets), ...Object.values(snapshot.textValues)]) {
    assert.equal(item.mode, 'sample');
    assert.ok(item.source.length > 0);
    assert.ok(item.source.every((source) => sources.has(source)));
  }
  for (const period of Object.values(snapshot.hero)) {
    for (const metric of [period.net, period.orders, period.cr, period.spend, period.roas, period.margin, period.ukcpo, period.uscpo]) {
      assert.equal(metric.mode, 'sample');
      assert.ok(metric.source.length > 0 && metric.source.every((source) => sources.has(source)));
    }
  }
  for (const match of dashboardTemplate.matchAll(/\{\{(sample|widget):([a-z0-9]+)\}\}/g)) {
    assert.ok(match[1] === 'sample' ? snapshot.textValues[match[2]!] : snapshot.widgets[match[2]!]);
  }
  const page = dashboardPage(snapshot);
  assert.ok(!page.includes('{{sample:') && !page.includes('{{widget:'));
  assert.ok(page.indexOf('id="reviews"') < page.indexOf('id="tests"'));
  assert.ok(page.includes('Sample data'));
});

test('rendered sample strings cannot inject HTML, attributes or an executable inline script', () => {
  const snapshot = getSampleDashboard();
  const payload = '"><img src=x onerror=alert(1)><script>alert(1)</script>';
  const text = Object.values(snapshot.textValues).find((item) => item.value === 'Morning, Will.');
  assert.ok(text);
  text.value = payload;
  snapshot.hero.today.net.d.why = payload;
  const widget = Object.values(snapshot.widgets).find((item) => item.kind === 'dial');
  assert.ok(widget?.kind === 'dial');
  widget.value.d.why = payload;
  const page = dashboardPage(snapshot);
  assert.ok(!page.includes(payload));
  assert.ok(page.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.equal((page.match(/<script\b/g) ?? []).length, 2);
  assert.ok(!/<script\b(?![^>]*\bsrc=)/.test(page));
});

test('sample snapshots remain independent and configured tripwires update every hero period', () => {
  const original = getSampleDashboard(defaultSettings());
  assert.equal(original.hero.today.ukcpo.max, 40);
  const changed = getSampleDashboard({ ...defaultSettings(), blendedMetaTripwireGbp: 31 });
  for (const period of Object.values(changed.hero)) {
    for (const dial of [period.ukcpo, period.uscpo]) {
      assert.equal(dial.z[1]?.[1], 31);
      assert.equal(dial.z[1]?.[0], 27.9);
      assert.ok(dial.s.includes('£31'));
      assert.ok(dial.d.rule.includes('£31'));
    }
  }
  assert.equal(changed.hero.today.net.n, original.hero.today.net.n);
  assert.ok(changed.hero['7d'].ukcpo.d.why.includes('0 of 7 sample history days'));
  assert.ok(changed.hero['7d'].uscpo.d.why.includes('6 of 7 sample history days'));
  assert.ok(!changed.hero['7d'].ukcpo.d.why.includes('Two days'));
  assert.ok(!changed.hero['7d'].uscpo.d.why.includes('All 7 days'));
  const highBar = getSampleDashboard({ ...defaultSettings(), blendedMetaTripwireGbp: 100 });
  for (const period of Object.values(highBar.hero)) {
    assert.ok(period.ukcpo.d.why.includes('0 of 7 sample history days'));
    assert.ok(period.uscpo.d.why.includes('0 of 7 sample history days'));
  }
  const fractionalBar = getSampleDashboard({ ...defaultSettings(), blendedMetaTripwireGbp: 31.2 });
  assert.ok(fractionalBar.hero.today.ukcpo.d.rule.includes('£28.08'));
  assert.ok(fractionalBar.hero.today.ukcpo.d.rule.includes('£31.2'));
  assert.ok(!fractionalBar.hero.today.ukcpo.d.rule.includes('£31.2.08'));
  changed.hero.today.net.n = -1;
  assert.equal(getSampleDashboard().hero.today.net.n, original.hero.today.net.n);
  assert.equal(original.hero.today.ukcpo.z[1]?.[1], 28);
});

test('source actions are disabled while account navigation and sign-out remain available', () => {
  const page = dashboardPage(getSampleDashboard());
  const unavailableButtons = [...page.matchAll(/<button\b[^>]*\bdata-unbuilt\b[^>]*>/g)];
  assert.ok(unavailableButtons.length > 0);
  assert.ok(unavailableButtons.every(([button]) => /\bdisabled\b/.test(button)));
  assert.ok(!/\bdata-(act|copy|confirm|undo)=/.test(page));
  assert.ok(!/<button[^>]*id="sign-out"[^>]*data-unbuilt/.test(page));
  for (const path of ['/sources', '/settings', '/audit']) assert.ok(page.includes(`href="${path}"`));
  assert.ok(!/\b(?:src|href)="https?:/.test(page));
});
