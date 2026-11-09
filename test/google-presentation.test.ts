import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { googlePresentationFacts } from './helpers/google-facts.js';
import { googleRisks } from '../src/ad-spend/risks.js';
import { spendMarket, needsMarketName } from '../src/ad-spend/placement.js';
import { spendNeeds } from '../src/ad-spend/metrics.js';
import { applyGoogleDashboard, isGooglePaidOrder } from '../src/google-ads/dashboard.js';
import { cleanOrder, type Order } from '../src/shopify/model.js';
import { defaultSettings, readSettings, saveSettings, validateSettings, SettingsValidationError } from '../src/settings.js';
import { settingsPage } from '../src/settings-view.js';
import { getSampleDashboard } from '../src/sample-dashboard.js';
import { dashboardPage } from '../src/dashboard-view.js';
import { createTestDatabase } from './helpers/database.js';
import type { ActivityView } from '../src/meta-adsets/activity.js';

const now = new Date('2026-10-26T12:00:00Z'), today = '2026-10-26';
const settings = () => ({...defaultSettings(), expectedGoogleCampaigns: [{campaignId: '9900101'}, {campaignId: '9900102'}]});
const shopify = {mode: 'sample' as const, orders: [], ready: false, from: today};
const meta: ActivityView = {hasRead: true, lastRead: now.toISOString(), error: null, events: [], notOurs: 0, line: 'Meta activity: invented successful read'};

test('Google names win, only nameless campaigns use country codes, and unknown placement still raises its existing need', () => {
  const row = {source: 'google-ads' as const, campaignName: 'Invented neutral', adSetName: null, owner: 'freelancer' as const, targetCountries: ['US']};
  assert.equal(needsMarketName(row), true); assert.equal(spendMarket(row), 'us');
  for (const [name, countries, expected] of [['Invented UK', ['US'], 'uk'], ['Invented UK US', ['GB'], 'unknown'], ['Invented_UK', ['US'], 'uk'], ['Invented UK_US', ['GB'], 'unknown'], ['Invented BUSINESS', ['GB'], 'uk'], ['Invented neutral', ['GB','JE'], 'uk'], ['Invented neutral', ['2826'], 'unknown'], ['Invented neutral', ['GB','US'], 'unknown']] as const)
    assert.equal(spendMarket({...row, campaignName: name, targetCountries: countries}), expected);
  const facts = {mode: 'live' as const, rows: [{...row, accountId: '9900001', campaignId: '9900101', adSetId: null, market: 'unknown' as const, day: today, amount: '9', currency: 'GBP'}], days: [], sources: []};
  assert.ok(!spendNeeds(facts, settings(), today, now).some(need => need.id.startsWith('ad-market:')));
  facts.rows[0]!.targetCountries = ['GB','US'];
  assert.ok(spendNeeds(facts, settings(), today, now).some(need => need.id.startsWith('ad-market:google-ads:')));
});

test('expected list yields one setup row, unlisted spend is deduplicated, PMax and per-slice bars are independent', () => {
  const facts = googlePresentationFacts(), configured = settings();
  const empty = googleRisks(facts, {...configured, expectedGoogleCampaigns: []}, today);
  assert.equal(empty.filter(need => need.id === 'google-expected-list').length, 1);
  assert.equal(empty.filter(need => need.id.startsWith('google-unexpected:')).length, 0);
  const unexpected = googleRisks(facts, {...configured, expectedGoogleCampaigns: [{campaignId: '9900101'}]}, today);
  assert.equal(unexpected.filter(need => need.id.startsWith('google-unexpected:')).length, 1);
  facts.campaigns[0]!.channelType = 'PERFORMANCE_MAX'; facts.campaigns[0]!.targetRoas = null;
  assert.ok(googleRisks(facts, configured, today).some(need => need.id === 'google-bidding:9900101'));
  facts.campaigns[0]!.targetRoas = 1.7;
  assert.ok(!googleRisks(facts, configured, today).some(need => need.id.startsWith('google-bidding:')));
  facts.campaigns[0]!.biddingStrategyType = 'TARGET_ROAS';
  assert.ok(googleRisks(facts, configured, today).some(need => need.id.startsWith('google-bidding:')));
  facts.campaigns[0]!.status = 'PAUSED';
  assert.ok(!googleRisks(facts, configured, today).some(need => need.id.startsWith('google-bidding:')));
  assert.deepEqual(googleRisks({...facts, mode: 'sample'}, configured, today), []);
});

test('network rules use spend and ROAS thresholds per campaign, keep mixed/unknown slices and never judge YouTube share', () => {
  const facts = googlePresentationFacts(), configured = settings();
  facts.networks = [{campaignId: '9900101', network: 'YOUTUBE_WATCH', day: '2026-10-25', spendMicros: '40000000', conversionValueMicros: '48000000', conversions: 1}];
  assert.ok(!googleRisks(facts, configured, today).some(need => need.id.startsWith('google-network:')), '100% YouTube with sufficient ROAS is informational');
  facts.networks[0]!.conversionValueMicros = '47999999';
  assert.equal(googleRisks(facts, configured, today).filter(need => need.id.startsWith('google-network:')).length, 1);
  facts.networks[0]!.spendMicros = '39999999'; facts.networks[0]!.conversionValueMicros = '0';
  assert.ok(!googleRisks(facts, configured, today).some(need => need.id.startsWith('google-network:')));
  facts.networks = ['MIXED','INVENTED_NETWORK'].map(network => ({...facts.networks[0]!, network, spendMicros: '40000000'}));
  assert.equal(googleRisks(facts, configured, today).filter(need => need.id.startsWith('google-network:')).length, 2);
  facts.jobs.find(job => job.kind === 'networks')!.currency = 'USD';
  assert.ok(!googleRisks(facts, configured, today).some(need => need.id.startsWith('google-network:')));
  facts.jobs.find(job => job.kind === 'networks')!.currency = 'GBP'; facts.jobs.find(job => job.kind === 'networks')!.coverage!.from = '2026-10-20';
  assert.ok(!googleRisks(facts, configured, today).some(need => need.id.startsWith('google-network:')));
});

test('Google tiles promote separately, show freshness, preserve market and sample boundaries, and require both activity feeds', () => {
  const facts = googlePresentationFacts(), snapshot = getSampleDashboard();
  applyGoogleDashboard(snapshot, facts, shopify, settings(), meta, now);
  for (const key of ['w024','w025','w026','w028']) assert.equal(snapshot.widgets[key]!.mode, 'live');
  const share = snapshot.widgets.w024!, plan = snapshot.widgets.w025!, roas = snapshot.widgets.w026!;
  assert.equal(share.kind, 'dial'); if (share.kind !== 'dial' || plan.kind !== 'dial' || roas.kind !== 'dial') return assert.fail();
  assert.equal(share.value.l, 'YouTube share'); assert.ok(share.value.z.every(zone => zone[2] === 'info'));
  assert.equal(share.markets!.us.v, 0); assert.ok(share.value.d.extra!.some(([label]) => label === 'Mixed'));
  assert.ok(share.value.d.extra!.some(([label]) => label === 'INVENTED_NETWORK'));
  assert.ok(Math.abs(plan.value.v - 50 / 120 * 100) < 0.00001); assert.equal(plan.markets!.us.v, 50);
  assert.match(plan.value.s, /assumption/); assert.match(roas.value.d.why, /Shopify comparison unavailable · Shopify is on sample data/);
  assert.match(roas.value.d.src, /lag about 3 hours/); assert.ok(Math.abs(roas.value.v - 315 / 170) < 0.00001);
  assert.equal(snapshot.textValues.t0254!.value, 'Account changes');
  const html = dashboardPage({...snapshot, shopify: {mode: 'sample', needs: [], checks: [], stock: [], live: {lastOrder:'',dispatch:'',carts:''},detail:{}}});
  assert.match(html, /<button[^>]*data-state="info"[^>]*data-model-id="w028"/);
  const missing = getSampleDashboard(); facts.jobs.find(job => job.kind === 'networks')!.coverage = null;
  applyGoogleDashboard(missing, facts, shopify, settings(), {...meta, error: 'invented failure'}, now);
  assert.equal(missing.widgets.w024!.mode, 'sample'); assert.equal(missing.widgets.w025!.mode, 'live'); assert.equal(missing.widgets.w028!.mode, 'sample');
  const midnight = getSampleDashboard(); applyGoogleDashboard(midnight, facts, shopify, settings(), meta, new Date('2026-10-27T00:01:00Z'));
  assert.equal(midnight.widgets.w025!.mode, 'sample'); assert.equal(midnight.widgets.w026!.mode, 'sample', 'yesterday’s partial report cannot become a complete day at midnight');
  const outage = getSampleDashboard(); applyGoogleDashboard(outage, facts, shopify, settings(), meta, new Date('2026-10-28T12:00:00Z'));
  assert.equal(outage.widgets.w028!.mode, 'sample', 'old successful reads cannot become a false zero for the last 24 hours');
  const oldBudgets = getSampleDashboard(); facts.jobs.find(job => job.kind === 'campaigns')!.lastSuccessAt = '2026-10-20T12:00:00Z';
  applyGoogleDashboard(oldBudgets, facts, shopify, settings(), meta, now);
  assert.equal(oldBudgets.widgets.w025!.mode, 'sample');
  const oldRoas = oldBudgets.widgets.w026!; if (oldRoas.kind !== 'dial') return assert.fail();
  assert.match(oldRoas.value.d.src, /campaign settings are stale/);
});

test('Google claims stay beside counted Shopify last-visit orders, by market and day across 25 October', async () => {
  const raw = JSON.parse(await readFile(new URL('fixtures/shopify/orders.json', import.meta.url), 'utf8'));
  const base = cleanOrder(raw.data.orders.nodes[0]);
  const order = (lastVisit: Order['lastVisit'], market: Order['market'] = 'UK'): Order => ({...base, day:'2026-10-25', market, lastVisit});
  const orders = [order({gclid:true}), order({source:'GoOgLe',medium:'CPC',campaign:'9900101'}), order({source:'google',medium:'organic'}), order({source:'invented',medium:'cpc'}), order({source:'google',medium:'paid_search'}, 'US')];
  assert.deepEqual(orders.map(isGooglePaidOrder), [true,true,false,false,true]);
  const snapshot = getSampleDashboard(); applyGoogleDashboard(snapshot, googlePresentationFacts(), {mode:'live',orders,ready:true,from:'2026-10-01',through:'2026-10-25',lastRead:now.toISOString()}, settings(), meta, now);
  const widget = snapshot.widgets.w026!; if(widget.kind !== 'dial') return assert.fail();
  assert.match(widget.value.d.why, /21.00 conversions/); assert.match(widget.value.d.why, /3 Shopify orders/);
  assert.match(widget.markets!.uk.d.why, /2 Shopify orders/); assert.match(widget.markets!.us.d.why, /1 Shopify orders/);
  assert.ok(widget.value.d.extra!.some(([label,value]) => label === '2026-10-25' && value.includes('3 Shopify Google-paid orders')));
  const stale = getSampleDashboard(); applyGoogleDashboard(stale, googlePresentationFacts(), {mode:'live',orders:[],ready:true,from:'2026-10-01',through:'2026-10-24'}, settings(), meta, now);
  assert.equal(stale.widgets.w026!.mode, 'live');
  const staleRoas = stale.widgets.w026!; if (staleRoas.kind !== 'dial') return assert.fail();
  assert.match(staleRoas.value.d.why, /Shopify comparison unavailable/);
});

test('Google network Settings validate, fill on read and save through the audit CHECK', async t => {
  const defaults = defaultSettings();
  for (const field of ['googleNetworkSpendFloorGbp','googleNetworkRoasFloor'] as const) {
    for (const value of [-1, Infinity, null, '4']) assert.throws(() => validateSettings({...defaults,[field]:value}), SettingsValidationError);
    assert.equal(validateSettings({...defaults,[field]:0})[field], 0);
    assert.match(settingsPage({version:0,values:defaults}), new RegExp(`name="${field}"`));
  }
  const db = await createTestDatabase(); t.after(() => db.close());
  const initial = await readSettings(db), {googleNetworkSpendFloorGbp: _floor, googleNetworkRoasFloor: _roas, ...old} = initial.values;
  await db.query('UPDATE pulse.settings SET values=$1', [JSON.stringify(old)]);
  const read = await readSettings(db); assert.equal(read.version,initial.version);
  assert.equal(read.values.googleNetworkSpendFloorGbp,40); assert.equal(read.values.googleNetworkRoasFloor,1.2);
  assert.deepEqual((await db.query<{values:object}>('SELECT values FROM pulse.settings')).rows[0]!.values, old);
  assert.equal((await db.query('SELECT * FROM pulse.settings_changes')).rowCount,0);
  const saved = await saveSettings(db,{...read,values:{...read.values,googleNetworkSpendFloorGbp:53,googleNetworkRoasFloor:1.6}},randomUUID());
  assert.deepEqual(saved.changedFields,['googleNetworkSpendFloorGbp','googleNetworkRoasFloor']);
});
