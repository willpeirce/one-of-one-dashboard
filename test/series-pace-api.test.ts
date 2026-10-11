import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { appConfig } from '../src/config.js';
import type { DashboardSnapshot } from '../src/dashboard-types.js';
import { readRuntime } from '../src/runtime.js';
import type { SeriesPaceCard } from '../src/series-pace/presentation.js';
import { saveSeriesPaceSales, seriesPaceQuery } from '../src/series-pace/store.js';
import { SampleShopify } from '../src/shopify/sample.js';
import { ShopifyStore } from '../src/shopify/store.js';
import { ShopifyWorker } from '../src/shopify/worker.js';
import { createTestDatabase } from './helpers/database.js';

test('dial target saves through authenticated Settings and recalculates the live card, then clears to landing', async t => {
  const db = await createTestDatabase();
  const now = new Date(appConfig.shopify.sampleNow);
  const reader = new SampleShopify();
  // Exercise live data selection using only invented API fixtures; no background race or network.
  t.mock.method(ShopifyWorker.prototype, 'start', () => {});
  const config = readRuntime({ DATABASE_URL: 'postgresql://localhost/pulse_test', APP_ORIGIN: 'https://pulse.example.test' });
  const app = await createApp(db, config, { SHOPIFY_CLIENT_ID: randomUUID(), SHOPIFY_CLIENT_SECRET: randomUUID() }, { reader, clock: () => now });
  t.after(async () => { await app.close(); await db.close(); });
  const stockFixture = (await reader.inventory())[0];
  const kit = appConfig.shopify.stockProducts.find(product => 'sku' in product && product.sku === 'oneofone1')!;
  await new ShopifyStore(db, 'live').inventory([appConfig.shopify.locations.uk, appConfig.shopify.locations.us].map((location, index) => ({
    ...stockFixture, productId: `gid://shopify/Product/${kit.id}`, sku: 'oneofone1', location: { id: location.id },
    quantities: [{ name: 'available', quantity: 150 + index * 50 }],
  })), now);
  await saveSeriesPaceSales(db, await reader.report(seriesPaceQuery('2026-09-23', '2026-09-29')), '2026-09-23', '2026-09-29', now);
  const secret = (await db.query<{ value: Uint8Array }>("SELECT value FROM pulse_private.app_secrets WHERE name = 'session_hmac'")).rows[0]!;
  const token = randomBytes(32).toString('base64url'), credentialId = randomBytes(32).toString('base64url');
  await db.query('INSERT INTO pulse_private.credentials(id, public_key) VALUES ($1, $2)', [credentialId, randomBytes(32)]);
  await db.query("INSERT INTO pulse_private.sessions(token_hash, credential_id, expires_at) VALUES ($1, $2, now() + interval '30 days')",
    [createHmac('sha256', Buffer.from(secret.value)).update(token).digest('hex'), credentialId]);
  const headers = { origin: config.origin, 'content-type': 'application/json', cookie: `__Host-pulse_session=${token}` };
  const card = async () => {
    const response = await app.inject({ url: '/api/dashboard', headers });
    assert.equal(response.statusCode, 200);
    const widget = response.json<DashboardSnapshot>().widgets.w017!;
    assert.equal(widget.kind, 'series-pace'); assert.equal(widget.mode, 'live');
    return widget.value as SeriesPaceCard;
  };
  const before = await card();
  assert.equal(before.markets.UK.targetOverride, null);
  assert.equal(before.markets.UK.targetDate, '2027-02-16');
  assert.equal(before.markets.US.targetDate, '2027-01-17');
  assert.ok(before.markets.UK.stock! > 0);
  assert.ok(before.markets.UK.average! > 0);
  for (const target of ['2026-11-18', '']) {
    const settings = (await app.inject({ url: '/api/settings', headers })).json();
    const saved = await app.inject({ method: 'POST', url: '/api/settings', headers,
      payload: { version: settings.version, values: { ...settings.values, series1UkTargetDate: target } } });
    assert.equal(saved.statusCode, 200);
    assert.deepEqual(saved.json().changedFields, ['series1UkTargetDate']);
    const after = await card();
    assert.equal(after.markets.UK.targetDate, target || before.markets.UK.landingDate);
    assert.equal(after.markets.UK.targetOverride, target || null);
    assert.equal(after.markets.UK.stock, before.markets.UK.stock);
    assert.equal(after.markets.UK.average, before.markets.UK.average);
    assert.deepEqual(after.markets.US, before.markets.US);
    if (target) {
      assert.notEqual(after.markets.UK.needed, before.markets.UK.needed);
      assert.notEqual(after.markets.UK.gap, before.markets.UK.gap);
    } else assert.deepEqual(after, before);
  }
  const audit = await db.query<{ field: string }>('SELECT field FROM pulse.settings_changes ORDER BY audit_id');
  assert.deepEqual(audit.rows.map(row => row.field), ['series1UkTargetDate', 'series1UkTargetDate']);
});
