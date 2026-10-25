import assert from 'node:assert/strict';
import test from 'node:test';
import type { SourceHealth } from '../src/sources.js';
import { auditPage, sourceHealthPage, loginPage } from '../src/views.js';
import type { ShopifyDashboard } from '../src/shopify/dashboard.js';

function source(overrides: Partial<SourceHealth> = {}): SourceHealth {
  return {
    source: 'shopify', name: 'Shopify', stage: 1,
    requiredKeys: ['SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET'],
    mode: 'sample', status: 'waiting_for_keys', lastSuccessAt: null,
    lastAttemptAt: null, consecutiveFailures: 0, updatedAt: new Date(),
    ...overrides,
  };
}

test('the shared head and page wrappers reserve the safe area on sign-in, Source health and Audit', () => {
  for (const html of [loginPage(false), sourceHealthPage([source()]), auditPage([])]) {
    assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">/);
    assert.match(html, /<header class="top"><div class="hin">/);
    assert.match(html, /<main class="wrap" id="main">/);
    assert.ok(html.indexOf('</div></header>') < html.indexOf('<main class="wrap"'));
  }
});

test('source and audit values cannot inject markup or execute a script', () => {
  const attack = '<img src=x onerror="alert(1)">&\'"';
  const healthHtml = sourceHealthPage([source({ name: attack, requiredKeys: [attack] })]);
  const auditHtml = auditPage([{ event: attack, occurred_at: new Date() }]);
  for (const html of [healthHtml, auditHtml]) {
    assert.ok(!html.includes(attack));
    assert.ok(html.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;&quot;'));
  }
});

test('audit times follow the UK clock change on 25 October 2026', () => {
  const html = auditPage([
    { event: 'sign_in', occurred_at: '2026-10-24T12:00:00Z' },
    { event: 'sign_out', occurred_at: '2026-10-25T12:00:00Z' },
  ]);
  assert.match(html, /24 Oct 13:00 UK/);
  assert.match(html, /25 Oct 12:00 UK/);
  assert.match(html, /datetime="2026-10-24T12:00:00.000Z"/);
  assert.match(html, /datetime="2026-10-25T12:00:00.000Z"/);
});

test('the source page labels samples and does not mistake key presence for a working client', () => {
  const html = sourceHealthPage([
    source(), source({ source: 'meta', name: 'Meta Ads', mode: 'live', status: 'not_implemented' }),
  ]);
  assert.match(html, /<strong>sample data<\/strong>/);
  assert.match(html, /No source data has been imported/);
  assert.match(html, /Waiting for keys/);
  assert.match(html, /Client not built/);
  assert.match(html, /<td>Sample<\/td>/);
  assert.match(html, /<td>Live<\/td>/);
  assert.ok(!html.includes('<td>Healthy</td>'));
});

test('Shopify health shows gross-history weeks from its job without changing Healthy', () => {
  // Invented history blocks; the last week is deliberately shorter than seven days.
  const imports: NonNullable<Parameters<typeof sourceHealthPage>[1]> = {
    mode: 'live', sample: false, counts: {}, notices: [], geoNotice: null, pendingWebhooks: 0,
    jobs: [{ name: 'gross_history', last_success_at: null, failures: 0, state: {
      first: '2026-03-01', last: '2026-03-17', next: '2026-03-15',
      filled: [{ from: '2026-03-01', to: '2026-03-07' }],
      skipped: [{ from: '2026-03-08', to: '2026-03-14' }],
    } }],
  };
  const health = source({ mode: 'live', status: 'healthy' });
  const html = sourceHealthPage([health], imports);
  const row = html.match(/<th scope="row">Shopify<\/th>([\s\S]*?)<\/tr>/)![1]!;
  assert.match(row, /Healthy<br><small data-gross-history>Total sales history: 1 of 3 weeks filled, 1 skipped/);
  assert.equal((html.match(/data-gross-history/g) ?? []).length, 1);
  imports.jobs[0]!.state.filled.push({ from: '2026-03-15', to: '2026-03-17' });
  assert.match(sourceHealthPage([health], imports), /Total sales history: 2 of 3 weeks filled, 1 skipped/);
  imports.jobs[0]!.state = {};
  assert.match(sourceHealthPage([health], imports), /Total sales history: 0 of 0 weeks filled, 0 skipped/);
  assert.doesNotMatch(sourceHealthPage([source()], { ...imports, mode: 'sample', sample: true }), /data-gross-history/);
});

test('setup phrase form is available only when configured and can never submit it in a URL', () => {
  const enabled = loginPage(true);
  assert.match(enabled, /id="register-device" method="post" action="\/auth\/register\/options"/);
  assert.match(enabled, /type="password"/);
  assert.ok(!loginPage(false).includes('id="register-device"'));
});

test('Source health starts with sources and modes, then the watchdog count, UK time and escaped list', () => {
  const shopify: ShopifyDashboard = {
    mode: 'sample', stock: [], needs: [], detail: {}, live: { lastOrder: 'No data', dispatch: 'No data', carts: 'No data' },
    checks: [
      { id: 'sample-pass', name: 'Example passing check', status: 'pass', why: 'Invented passing observation.', link: '/sources' },
      { id: 'sample-fail', name: '<script>example</script>', status: 'tripped', why: '<img src=x>', link: '/sources' },
      { id: 'sample-unknown', name: 'Example unknown check', status: 'unknown', why: 'Invented unknown observation.', link: '/sources' },
    ],
  };
  const html = sourceHealthPage([source()], undefined, undefined, undefined, {
    summary: 'Shopify sample data. Ad spend uses separately labelled source connections.', shopify, checkedAt: '2026-10-09T12:00:00Z',
  });
  assert.match(html, /<section id="source-summary"/);
  assert.match(html, /Shopify sample data\. Ad spend uses separately labelled source connections\./);
  assert.match(html, /1\/3 checks passing · Shopify sample data · checked/);
  assert.match(html, /datetime="2026-10-09T12:00:00\.000Z">9 Oct 13:00 UK<\/time>/);
  assert.match(html, /✓ Good · Example passing check/);
  assert.match(html, /△ Watch · &lt;script&gt;example&lt;\/script&gt;/);
  assert.match(html, /○ Unknown · Example unknown check/);
  assert.doesNotMatch(html, /<script>example|<img src=x>/);
  assert.ok(html.indexOf('id="source-summary"') < html.indexOf('id="shopify-watchdogs"'));
  assert.ok(html.indexOf('id="shopify-watchdogs"') < html.indexOf('id="source-health"'));
});
