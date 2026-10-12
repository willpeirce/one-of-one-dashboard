import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { defaultSettings } from '../src/settings.js';
import { parseMeta } from '../src/ad-spend/clients.js';
import type { SpendRow } from '../src/ad-spend/model.js';
import { googleSpendMarket, metaSpendMarket, spendMarket, tiktokSpendMarket } from '../src/ad-spend/placement.js';
import { sampleMetaCampaigns, sampleSpend, saveSpend, spendFacts } from '../src/ad-spend/store.js';
import { createTestDatabase } from './helpers/database.js';

test('Meta places our exact set markers, then set market words, then the campaign name', () => {
  assert.equal(metaSpendMarket('Invented discovery US', 'Invented — UK — Discovery', 'ours'), 'uk');
  assert.equal(metaSpendMarket('Invented discovery UK', 'Invented — US — Discovery', 'ours'), 'us');
  assert.equal(metaSpendMarket('Invented campaign US', 'Invented UK set', 'ours'), 'uk');
  assert.equal(metaSpendMarket('Invented campaign UK', 'Invented discovery us set', 'ours'), 'us');
  assert.equal(metaSpendMarket('Invented campaign UK', null, 'ours'), 'uk');
  assert.equal(metaSpendMarket('Invented campaign', 'Invented — uk — Discovery', 'ours'), 'uk');
  assert.equal(metaSpendMarket('Invented campaign', 'Invented - UK - Discovery', 'ours'), 'uk');
  assert.equal(metaSpendMarket('Invented campaign', 'Invented— UK —Discovery', 'ours'), 'uk');
  assert.equal(metaSpendMarket('Invented campaign US', 'Invented — UK — US discovery', 'ours'), 'uk');
  assert.equal(metaSpendMarket('Invented campaign US', 'Invented ordinary set', 'ours'), 'us');
  assert.equal(metaSpendMarket('Invented campaign', 'Invented UK and US set', 'ours'), 'unknown');
  assert.equal(metaSpendMarket('Invented campaign UK', 'Invented UK and US set', 'ours'), 'unknown');
  assert.equal(metaSpendMarket('Invented campaign', 'Invented UKulele and bonus set', 'ours'), 'unknown');
});

test('Meta freelancer and unassigned campaigns ignore all set markers', () => {
  for (const owner of ['freelancer', 'unassigned'] as const) {
    assert.equal(metaSpendMarket('Invented campaign US', 'Invented — UK — Discovery', owner), 'us');
    assert.equal(metaSpendMarket('Invented campaign US', 'Invented UK set', owner), 'us');
    assert.equal(metaSpendMarket('Invented campaign', 'Invented — UK — Discovery', owner), 'unknown');
    assert.equal(metaSpendMarket('Invented campaign', 'Invented UK set', owner), 'unknown');
  }
  assert.equal(metaSpendMarket('Invented campaign UK US', 'Invented ordinary set', 'ours'), 'unknown');
  assert.equal(metaSpendMarket('Invented campaign UK', 'Invented — UK — US — Discovery', 'ours'), 'unknown');
});

test('Google uses whole market words anywhere and leaves ambiguous or unmatched names unknown', () => {
  assert.equal(googleSpendMarket('Invented search UK'), 'uk');
  assert.equal(googleSpendMarket('Invented search US'), 'us');
  assert.equal(googleSpendMarket('Invented search uk  '), 'uk');
  assert.equal(googleSpendMarket('UK invented discovery'), 'uk');
  assert.equal(googleSpendMarket('Invented UK discovery'), 'uk');
  assert.equal(googleSpendMarket('Invented discovery us video'), 'us');
  assert.equal(googleSpendMarket('Invented UK-search UK'), 'uk');
  assert.equal(googleSpendMarket('Invented bonus'), 'unknown');
  assert.equal(googleSpendMarket('Invented UKulele discovery'), 'unknown');
  assert.equal(googleSpendMarket('Invented discovery'), 'unknown');
  assert.equal(googleSpendMarket('Invented UK search US'), 'unknown');
});

test('TikTok uses the campaign market anywhere and keeps ambiguous or unnamed rows under All', () => {
  assert.equal(tiktokSpendMarket('Invented UK discovery'), 'uk');
  assert.equal(tiktokSpendMarket('Invented discovery US video'), 'us');
  assert.equal(tiktokSpendMarket('Invented UK and US discovery'), 'unknown');
  assert.equal(tiktokSpendMarket('Invented discovery'), 'unknown');
  assert.equal(tiktokSpendMarket('Invented bonus video'), 'unknown');
  for (const source of ['meta', 'google-ads', 'tiktok'] as const) {
    assert.equal(spendMarket({ source, campaignName: 'Invented discovery', adSetName: null, owner: 'ours' }), 'unknown');
  }
});

test('Meta parser applies the current local owner before placing the row', () => {
  const body = { data: [{
    campaign_id: 'invented-campaign', campaign_name: 'Invented campaign US',
    adset_id: 'invented-set', adset_name: 'Invented — UK — Discovery',
    date_start: '2026-09-30', spend: '9.10',
  }] };
  const settings = defaultSettings();
  assert.equal(parseMeta(body, 'invented-account', 'GBP', 'Europe/London', settings)[0]!.market, 'uk');
  settings.metaOwners = [{ campaignId: 'invented-campaign', owner: 'freelancer' }];
  const row = parseMeta(body, 'invented-account', 'GBP', 'Europe/London', settings)[0]!;
  assert.equal(row.owner, 'freelancer');
  assert.equal(row.market, 'us');
});

test('stored placement is rebuilt from names and owner changes apply to historical spend', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  const settings = { ...defaultSettings(), metaAdAccountId: 'invented-account' },
    env = { META_ACCESS_TOKEN: randomBytes(16).toString('hex') },
    day = '2026-09-30', now = new Date('2026-09-30T12:00:00Z');
  const row: SpendRow = {
    source: 'meta', accountId: settings.metaAdAccountId,
    campaignId: 'invented-campaign', campaignName: 'Invented campaign US',
    adSetId: 'invented-set', adSetName: 'Invented — UK — Discovery',
    owner: 'ours', market: 'unknown', day, amount: '9.100000', currency: 'GBP',
  };
  await saveSpend(db, 'meta', settings.metaAdAccountId, day, day, [row], now);
  assert.equal((await db.query<{ market: string }>('SELECT market FROM pulse.ad_spend')).rows[0]!.market, 'uk');
  await db.query("UPDATE pulse.ad_spend SET market='us'");
  assert.equal((await spendFacts(db, settings, env, 'live', day, day, now)).rows[0]!.market, 'uk');
  settings.metaOwners = [{ campaignId: row.campaignId, owner: 'freelancer' }];
  assert.equal((await spendFacts(db, settings, env, 'live', day, day, now)).rows[0]!.market, 'us');
});

test('sample campaign and set names follow the same rules as live spend', () => {
  const campaigns = sampleMetaCampaigns({ metaOwners: [] }),
    rows = sampleSpend('2026-09-30', '2026-09-30').rows;
  assert.ok(rows.every((row) => row.market === spendMarket(row) && row.market !== 'unknown'));
  assert.ok(rows.filter((row) => row.source === 'meta').every((row) =>
    campaigns.some((campaign) => campaign.id === row.campaignId && campaign.name === row.campaignName)));
  const changed = sampleSpend('2026-09-30', '2026-09-30', {
    metaOwners: [{ campaignId: '900000000601', owner: 'freelancer' }],
  });
  assert.ok(changed.rows.filter((row) => row.campaignId === '900000000601').every((row) => row.market === 'unknown'));
});
