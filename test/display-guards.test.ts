import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac, randomBytes } from 'node:crypto';
import { createApp } from '../src/app.js';
import type { DashboardSnapshot } from '../src/dashboard-types.js';
import { readRuntime } from '../src/runtime.js';
import { readSettings, saveSettings } from '../src/settings.js';
import { radarMeasure, type RadarAdSource } from '../src/radar.js';
import { geoNotice } from '../src/shopify/geo-notice.js';
import { ShopifyStore } from '../src/shopify/store.js';
import { glance, type Summary } from '../src/fulfilment/view.js';
import { sourceHealthPage } from '../src/views.js';
import { createTestDatabase } from './helpers/database.js';

const now = new Date('2026-10-25T23:30:00Z');
const ad = (source: RadarAdSource['source'], overrides: Partial<RadarAdSource> = {}): RadarAdSource => ({
  source, live: true, status: 'live', fetchedAt: now.toISOString(), ...overrides,
});

test('Meta and Google radar use spend state even without campaign measures', () => {
  for (const [group, source] of [['meta', 'meta'], ['google', 'google-ads']] as const) {
    assert.equal(radarMeasure(group, undefined, [ad(source)]).label, 'Live');
    assert.equal(radarMeasure(group, undefined, [ad(source, { stale: true, status: 'stale · last fetched earlier' })]).label, 'Stale');
    assert.equal(radarMeasure(group, undefined, [ad(source, { failures: 1, status: 'source unavailable', stale: true })]).label, 'Unavailable');
    assert.equal(radarMeasure(group, undefined, [ad(source, { live: false })]).label, 'Waiting for keys');
    const pending = radarMeasure(group, undefined, [ad(source, { fetchedAt: null, status: 'first sync pending' })]);
    assert.equal(pending.label, 'No data yet'); assert.match(pending.reason, /first ad spend sync/);
  }
  for (const group of ['growth', 'store', 'email', 'stock']) {
    const measure = radarMeasure(group);
    assert.equal(measure.label, 'Not built'); assert.ok(measure.reason.length > 10);
  }
  assert.equal(radarMeasure('store', { good: 3, warn: 2, alarm: 0 }).label, '80%');
});

test('sample Shopify numbers retain real ad source readiness and the ad clock in the radar', async t => {
  const db = await createTestDatabase();
  const config = readRuntime({ DATABASE_URL: 'postgresql://localhost/pulse_test', APP_ORIGIN: 'https://pulse.example.test' });
  const env = Object.fromEntries(['META_ACCESS_TOKEN', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_REFRESH_TOKEN']
    .map(key => [key, randomBytes(24).toString('hex')]));
  const app = await createApp(db, config, env, {}, { clock: () => now });
  t.after(async () => { await app.close(); await db.close(); });
  const secret = (await db.query<{ value: Uint8Array }>("SELECT value FROM pulse_private.app_secrets WHERE name='session_hmac'")).rows[0]!;
  const token = randomBytes(32).toString('base64url'), credentialId = randomBytes(32).toString('base64url');
  await db.query('INSERT INTO pulse_private.credentials(id,public_key) VALUES ($1,$2)', [credentialId, randomBytes(32)]);
  await db.query("INSERT INTO pulse_private.sessions(token_hash,credential_id,expires_at) VALUES ($1,$2,now()+interval '30 days')",
    [createHmac('sha256', Buffer.from(secret.value)).update(token).digest('hex'), credentialId]);
  const settings = await readSettings(db);
  await saveSettings(db, { ...settings, values: { ...settings.values, metaAdAccountId: '900000000801', googleCustomerId: '9000000802' } }, credentialId);
  for (const [source, account, minutes] of [['meta', '900000000801', 89], ['google-ads', '9000000802', 91]] as const)
    await db.query('INSERT INTO pulse.ad_spend_jobs(source,account_id,backfill_done,last_success_at) VALUES ($1,$2,true,$3)',
      [source, account, new Date(now.getTime() - minutes * 60_000)]);
  const response = await app.inject({ url: '/api/dashboard', headers: { cookie: `__Host-pulse_session=${token}` } });
  assert.equal(response.statusCode, 200);
  const snapshot = response.json<DashboardSnapshot>();
  assert.equal(snapshot.shopify!.mode, 'sample');
  assert.equal(snapshot.hero.today.spend.mode, 'sample');
  assert.match(snapshot.hero.today.spend.ss, /Sample ad spend/);
  assert.equal(radarMeasure('meta', undefined, snapshot.adSources).label, 'Live');
  assert.equal(radarMeasure('google', undefined, snapshot.adSources).label, 'Stale');
});

test('fulfilment displays grouped GBP, signed USD and parcel counts', () => {
  const html = glance({ mode: 'sample', averages: [{ warehouse: 'us', currency: 'USD', exportedMinor: -123400,
    gbpPence: 123456789, count: 1560 }], lastUpload: null, needs: [], unmatched: [], recent: [] } as unknown as Summary);
  assert.match(html, /-\$1,234\.00/); assert.match(html, /£1,234,567\.89/); assert.match(html, /1,560 parcels/);
});

test('geo rebuild replaces daily notices with one plain grouped notice and clears on correction or age', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const store = new ShopifyStore(db, 'live');
  for (const day of ['2026-10-18', '2026-10-19', '2026-10-24']) {
    await store.notice('geo_unreliable', `geo:${day}`, now);
    await store.put('sessions', day, { day, marketReliable: false }, now);
  }
  await store.rebuildGeoNotice(now);
  const persisted = await db.query<{ source_id: string; detail: { days: number; why: string } }>("SELECT source_id,detail FROM pulse.shopify_notices WHERE kind='geo_unreliable'");
  assert.equal(persisted.rows.length, 1); assert.equal(persisted.rows[0]!.source_id, 'geo:recent');
  assert.equal(persisted.rows[0]!.detail.days, 2);
  assert.match(persisted.rows[0]!.detail.why, /conversion by market is approximate for 2 days/);
  assert.equal((await store.facts(now)).noticeDetails.filter(row => row.kind === 'geo_unreliable').length, 1);
  assert.match(sourceHealthPage([], await store.summary(now)), /conversion by market is approximate for 2 days/);
  // The rolling notice expires on reads even if the source stops returning reports.
  assert.equal((await store.facts(new Date('2026-11-01T00:01:00Z'))).noticeDetails.filter(row => row.kind === 'geo_unreliable').length, 0);
  const corrected = new Date(now.getTime() + 1);
  for (const day of ['2026-10-19', '2026-10-24']) await store.put('sessions', day, { day, marketReliable: true }, corrected);
  await store.rebuildGeoNotice(corrected);
  assert.equal((await db.query("SELECT 1 FROM pulse.shopify_notices WHERE kind='geo_unreliable'")).rows.length, 0);
});

test('geo rolling window uses UK calendar days across midnight and the clock change', () => {
  const rows = ['2026-10-18', '2026-10-19', '2026-10-25', '2026-10-26'].map(day => ({ day, marketReliable: false }));
  assert.equal(geoNotice(rows, new Date('2026-10-24T23:30:00Z'))!.days, 2);
  assert.equal(geoNotice(rows, new Date('2026-10-25T23:30:00Z'))!.days, 2);
  assert.equal(geoNotice(rows, new Date('2026-10-26T00:01:00Z'))!.days, 2);
});
