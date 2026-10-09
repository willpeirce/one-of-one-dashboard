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
    for (const metric of [period.net, period.orders, period.cr, period.spend, period.roas, period.margin, period.profit, period.ukcpo, period.uscpo]) {
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
  const text = snapshot.textValues.t0033;
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

test('Home opens on the greeting with paired margin and profit, and status only in menu badges', () => {
  const snapshot = getSampleDashboard();
  snapshot.metaCampaigns = { unconfirmedCount: 1 };
  snapshot.shopify = {
    mode: 'sample', stock: [], needs: [], detail: {}, live: { lastOrder: 'No data', dispatch: 'No data', carts: 'No data' },
    checks: [
      { id: 'sample-pass', name: 'Sample passing check', status: 'pass', why: 'Invented passing check.', link: '/sources' },
      { id: 'sample-fail', name: 'Sample failing check', status: 'tripped', why: 'Invented failing check.', link: '/sources' },
      { id: 'sample-unknown', name: 'Sample unknown check', status: 'unknown', why: 'Invented unknown check.', link: '/sources' },
    ],
  };
  snapshot.banner = 'Sample source summary belongs on Source health.';
  const html = dashboardPage(snapshot);
  const visible = html.split('<div id="dashboard-state"')[0]!;
  assert.doesNotMatch(visible, /sample-banner|id="shopify-checks"|Sample source summary belongs|Shopify checks and sample previews are shown separately/);
  assert.match(visible, /<main class="wrap" id="main">\s*<section class="hero"/);
  assert.match(visible, /id="greeting"/);
  assert.match(visible, /id="source-health-count" class="menu-count" aria-label="1 failing checks">1<\/span>/);
  assert.match(visible, /id="settings-count" class="menu-count" aria-label="1 campaigns to confirm">1<\/span>/);
  assert.match(visible, /data-k="margin"[\s\S]*?<\/button>\s*<button[^>]*data-k="profit"/);
  const profitTile = /<button[^>]*data-k="profit"[^>]*>([\s\S]*?)<\/button>/.exec(visible)?.[1];
  assert.ok(profitTile);
  assert.ok(profitTile.includes('Net profit'));
  assert.ok(profitTile.includes(`£${snapshot.hero.today.profit.n.toFixed(2)}`));
  assert.doesNotMatch(profitTile, /class="spark"/);
  snapshot.metaCampaigns.unconfirmedCount = 0;
  snapshot.shopify.checks = snapshot.shopify.checks.filter(check => check.status !== 'tripped');
  const clear = dashboardPage(snapshot);
  assert.match(clear, /id="source-health-count" class="menu-count" hidden/);
  assert.match(clear, /id="settings-count" class="menu-count" hidden/);
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
  assert.ok(changed.hero['7d'].ukcpo.d.why.includes('0 of 7 days were'));
  assert.ok(changed.hero['7d'].uscpo.d.why.includes('6 of 7 days were'));
  assert.ok(!changed.hero['7d'].ukcpo.d.why.includes('Two days'));
  assert.ok(!changed.hero['7d'].uscpo.d.why.includes('All 7 days'));
  const highBar = getSampleDashboard({ ...defaultSettings(), blendedMetaTripwireGbp: 100 });
  for (const [key, days] of [['today', 1], ['yday', 1], ['7d', 7], ['30d', 30]] as const) {
    const period = highBar.hero[key];
    assert.ok(period.ukcpo.d.why.includes(`0 of ${days} days were`));
    assert.ok(period.uscpo.d.why.includes(`0 of ${days} days were`));
  }
  const fractionalBar = getSampleDashboard({ ...defaultSettings(), blendedMetaTripwireGbp: 31.2 });
  assert.ok(fractionalBar.hero.today.ukcpo.d.rule.includes('£28.08'));
  assert.ok(fractionalBar.hero.today.ukcpo.d.rule.includes('£31.2'));
  assert.ok(!fractionalBar.hero.today.ukcpo.d.rule.includes('£31.2.08'));
  changed.hero.today.net.n = -1;
  assert.equal(getSampleDashboard().hero.today.net.n, original.hero.today.net.n);
  assert.equal(original.hero.today.ukcpo.z[1]?.[1], 28);
});

test('Today retains the supplied complete-week history and never judges a partial-day percentage', () => {
  const today = getSampleDashboard().hero.today;
  assert.deepEqual(today.spark, [1640, 1710, 1980, 1820, 2310, 1760, 2099]);
  assert.deepEqual(today.net.d.hl, ['23 Sep', '29 Sep']);
  assert.equal(today.net.ss, '6 orders · 7-day avg £1,903 a day');
  assert.equal(today.net.n, 296);
  assert.equal(today.net.state, 'sofar');
  assert.doesNotMatch(today.net.d.why, /%/);
  assert.match(today.net.d.why, /4 orders by this time yesterday/);
  assert.equal(today.net.d.hm, undefined);
  assert.ok(today.orders.d.hm?.some((mark) => mark.includes('24 Sep (UK)')));
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
