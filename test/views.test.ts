import assert from 'node:assert/strict';
import test from 'node:test';
import type { SourceHealth } from '../src/sources.js';
import { auditPage, sourceHealthPage, loginPage } from '../src/views.js';

function source(overrides: Partial<SourceHealth> = {}): SourceHealth {
  return {
    source: 'shopify', name: 'Shopify', stage: 1,
    requiredKeys: ['SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET'],
    mode: 'sample', status: 'waiting_for_keys', lastSuccessAt: null,
    lastAttemptAt: null, consecutiveFailures: 0, updatedAt: new Date(),
    ...overrides,
  };
}

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
  assert.match(html, /24 Oct 2026, 13:00/);
  assert.match(html, /25 Oct 2026, 12:00/);
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

test('setup phrase form is available only when configured and can never submit it in a URL', () => {
  const enabled = loginPage(true);
  assert.match(enabled, /id="register-device" method="post" action="\/auth\/register\/options"/);
  assert.match(enabled, /type="password"/);
  assert.ok(!loginPage(false).includes('id="register-device"'));
});
