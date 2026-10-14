import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { creativeSettingsDefaults, defaultSettings, readSettings, saveSettings, SettingsValidationError, validateSettings } from '../src/settings.js';
import { settingsPage } from '../src/settings-view.js';
import { creativeFeatureFlags } from '../src/creatives/config.js';
import { seedCreativeSample } from '../src/creatives/seed.js';
import { sampleCreativeAttributeRows, sampleCreativeData, sampleCreativeStoredLifts } from '../src/creatives/sample.js';
import { createTestDatabase } from './helpers/database.js';
import { readGroupAttributes, toggleWillAttribute } from '../src/creatives/attribute-store.js';
import { readCreativeLifts } from '../src/creatives/lifts.js';
import { SAMPLE_CREATIVE_ACCOUNT } from '../src/creatives/sample.js';

const edits = {
  creativeDefaultWindow: '7d', creativeSpendFloorGbp: 63.25, creativePurchaseMinimum: 3,
  creativeFadeFrequency: 3.4, creativeFadeCtrDropPercent: 45, creativeWeeklyTarget: 9,
  creativeHitWinnerSpendGbp: 111, creativeHitKilledSpendGbp: 82,
  creativeHitKilledTargetMultiplier: 1.6, creativeLiftWindowDays: 21,
  creativeLiftMinimumGroups: 4, creativeLiftMinimumSpendGbp: 180,
  creativeMediaCapMb: 360, creativeScanModel: 'claude-invented-test-model',
  creativeScanInputPrice: 1.25, creativeScanOutputPrice: 5.75,
  creativeScanCapGbp: 2, creativeFreelancerInitial: 'Q',
} as const;

test('every creative preference saves, audits and renders its new value in Settings', async t => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  let snapshot = await readSettings(db);
  assert.deepEqual(Object.keys(edits).sort(), Object.keys(creativeSettingsDefaults()).sort());
  for (const [key, value] of Object.entries(edits)) {
    const saved = await saveSettings(db, { version: snapshot.version, values: { ...snapshot.values, [key]: value } }, randomUUID());
    assert.deepEqual(saved.changedFields, [key]);
    snapshot = await readSettings(db);
    assert.equal(snapshot.values[key as keyof typeof edits], value);
    const html = settingsPage(snapshot);
    if (key === 'creativeDefaultWindow') assert.match(html, /value="7d" selected>7 days/);
    else assert.ok(html.includes(`name="${key}" data-setting-path="${key}"`) || html.includes(`name="${key}" data-setting-path="${key}" aria-describedby=`));
    const control = html.match(new RegExp(`<input[^>]*name="${key}"[^>]*>`));
    if (control) assert.ok(control[0].includes(`value="${value}"`));
  }
  assert.equal((await db.query('SELECT * FROM pulse.settings_changes')).rowCount, Object.keys(edits).length);
});

test('older Settings receive creative defaults without writing, versioning or auditing', async t => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  const previous: Record<string, unknown> = { ...defaultSettings(), goalOrdersPerDay: 41 };
  for (const key of Object.keys(creativeSettingsDefaults())) delete previous[key];
  await db.query('INSERT INTO pulse.settings(values,version) VALUES($1,6)', [JSON.stringify(previous)]);
  const read = await readSettings(db);
  assert.equal(read.version, 6);
  assert.equal(read.values.goalOrdersPerDay, 41);
  for (const [key, value] of Object.entries(creativeSettingsDefaults())) assert.equal(read.values[key as keyof typeof edits], value);
  assert.deepEqual((await db.query('SELECT values FROM pulse.settings')).rows[0]!.values, previous);
  assert.equal((await db.query('SELECT * FROM pulse.settings_changes')).rowCount, 0);
});

test('creative settings reject invalid ranges, unrecognised windows and unsafe model IDs', () => {
  for (const [key, value] of Object.entries(edits)) {
    if (typeof value === 'number') {
      for (const invalid of [-1, Infinity, NaN, '2']) assert.throws(() => validateSettings({ ...defaultSettings(), [key]: invalid }), SettingsValidationError);
    }
  }
  for (const [key, value] of [
    ['creativeDefaultWindow', '30d'], ['creativePurchaseMinimum', 1.5], ['creativeFadeCtrDropPercent', 101],
    ['creativeWeeklyTarget', 0], ['creativeHitKilledTargetMultiplier', 0.9], ['creativeMediaCapMb', 0],
    ['creativeLiftWindowDays', 366], ['creativeLiftMinimumGroups', 0], ['creativeFreelancerInitial', 'FA'],
    ['creativeScanModel', 'https://example.invalid/model'], ['creativeScanModel', 'sk-ant-invented-credential'],
  ]) assert.throws(() => validateSettings({ ...defaultSettings(), [String(key)]: value }), SettingsValidationError);
  assert.equal(validateSettings({ ...defaultSettings(), creativeFreelancerInitial: 'q' }).creativeFreelancerInitial, 'Q');
});

test('creative flags are read-only and Settings shows the current scan and lift controls', () => {
  assert.deepEqual(creativeFeatureFlags({}), { creativeScanEnabled: false, metaActionsEnabled: false });
  assert.equal(creativeFeatureFlags({ CREATIVE_SCAN_ENABLED: 'TRUE' }).creativeScanEnabled, false);
  const flags = creativeFeatureFlags({ CREATIVE_SCAN_ENABLED: 'true' });
  const html = settingsPage({ version: 0, values: defaultSettings() }, [], 'sample', new Date(), [], undefined, flags);
  assert.match(html, /data-creative-scan-flag>On<\/dd>/);
  assert.match(settingsPage({ version: 0, values: defaultSettings() }, [], 'sample', new Date(), [], undefined, creativeFeatureFlags({})), /data-creative-scan-flag>Off<\/dd>/);
  assert.doesNotMatch(html, /(?:Attribute lifts|Creative scan) · planned|workflow not built yet|Live attribute lifts and tagging are not built yet/);
  assert.match(html, /data-meta-actions-flag>Off · read-only, no Meta actions are built/);
  assert.doesNotMatch(html, /name="(?:creativeScanEnabled|metaActionsEnabled)"/);
  assert.doesNotMatch(html, /Scan now/);
  assert.match(html, /zero means not configured/);
});

test('Settings asks for scan prices until both prices are configured', () => {
  for (const [input, output, missing] of [[0, 0, true], [1.25, 0, true], [0, 6.25, true], [1.25, 6.25, false]] as const) {
    const values = { ...defaultSettings(), creativeScanInputPrice: input, creativeScanOutputPrice: output };
    const html = settingsPage({ version: 0, values });
    const notice = html.match(/<p[^>]*data-creative-scan-prices[^>]*>/)![0];
    assert.equal(notice.includes(' hidden'), !missing);
    assert.match(html, /Set the scan prices in Settings/);
  }
});

test('sample seed persists invented ads, media, insights, attributes and lifts once, separate from live data', async t => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  const settings = defaultSettings();
  const now = new Date('2026-10-13T12:00:00Z');
  await seedCreativeSample(db, settings, now);
  const expected = sampleCreativeData(settings, now);
  for (const [table, count] of [
    ['ads', expected.ads.length], ['media_groups', expected.groups.length], ['ad_insights_daily', expected.insights.length],
    ['media_attributes', sampleCreativeAttributeRows(expected).length], ['attribute_lifts', sampleCreativeStoredLifts(now).length],
  ] as const) {
    assert.equal((await db.query(`SELECT * FROM pulse.${table} WHERE mode='sample'`)).rowCount, count);
    assert.equal((await db.query(`SELECT * FROM pulse.${table} WHERE mode='live'`)).rowCount, 0);
  }
  assert.equal((await readCreativeLifts(db, SAMPLE_CREATIVE_ACCOUNT, 'sample')).length, sampleCreativeStoredLifts(now).length);
  const cleared = await toggleWillAttribute(db, 'sample', SAMPLE_CREATIVE_ACCOUNT, 'sample-video-1', 'slabEarly', 'yes', now);
  assert.equal(cleared.source, 'model');
  assert.equal(cleared.value, 'no');
  await db.query("UPDATE pulse.media_groups SET merged_into_id=NULL WHERE id='sample-video-1-crop'");
  await seedCreativeSample(db, settings, now);
  assert.equal((await db.query("SELECT merged_into_id FROM pulse.media_groups WHERE id='sample-video-1-crop'")).rows[0]!.merged_into_id, null);
  assert.equal((await db.query("SELECT * FROM pulse.ads WHERE mode='sample'")).rowCount, expected.ads.length);
  const attributes = await readGroupAttributes(db, 'sample', SAMPLE_CREATIVE_ACCOUNT, 'sample-video-1');
  assert.equal(attributes.find(row => row.key === 'slabEarly')!.source, 'model');
  assert.equal(attributes.find(row => row.key === 'slabEarly')!.value, 'no');
  for (const group of expected.groups) assert.match(decodeURIComponent(group.thumbnailUrl), /Invented picture · sample data/);
});


test('invented creative owners follow the same campaign controls as Settings without changing other ads', () => {
  const now = new Date('2026-10-13T12:00:00Z');
  const initial = sampleCreativeData(defaultSettings(), now);
  const edited = sampleCreativeData({ metaOwners: [
    { campaignId: '900000000601', owner: 'freelancer' },
    { campaignId: '900000000603', owner: 'ours' },
  ] }, now);
  for (const ad of edited.ads) {
    if (ad.campaignId === '900000000601') { assert.equal(ad.owner, 'freelancer'); assert.equal(ad.market, 'unknown'); }
    else if (ad.campaignId === '900000000603') assert.equal(ad.owner, 'ours');
    else assert.equal(ad.owner, initial.ads.find(row => row.id === ad.id)!.owner);
  }
  assert.deepEqual(edited.insights.map(row => row.spend), initial.insights.map(row => row.spend));
});

test('batch 4 upgrades reserved sample examples without resetting existing media or touching a live attribute', async t => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  const settings = defaultSettings();
  const now = new Date('2026-10-14T12:00:00Z');
  await seedCreativeSample(db, settings, now);
  await db.query("DELETE FROM pulse.attribute_lifts WHERE mode='sample' AND account_id=$1", [SAMPLE_CREATIVE_ACCOUNT]);
  await db.query("DELETE FROM pulse.media_attributes WHERE mode='sample' AND account_id=$1", [SAMPLE_CREATIVE_ACCOUNT]);
  await db.query(`INSERT INTO pulse.media_attributes(id,mode,account_id,media_group_id,attribute_key,value,source,recorded_at)
    VALUES('invented-sample-video-1-hookType','sample',$1,'sample-video-1','hookType',$2,'will',$3)`,
  [SAMPLE_CREATIVE_ACCOUNT, JSON.stringify({ label: 'Unboxing', value: 'unboxing', sample: true }), now]);
  await db.query(`INSERT INTO pulse.media_groups(id,mode,account_id,source_id,kind,media_key,title,first_seen,fetched_at)
    VALUES('invented-live-group','live','invented-live-account','invented-live-media','video','invented-live-media','Invented live fixture',$1,$1)`, [now]);
  await db.query(`INSERT INTO pulse.media_attributes(id,mode,account_id,media_group_id,attribute_key,value,source,recorded_at)
    VALUES('invented-live-attribute','live','invented-live-account','invented-live-group','hookType',$1,'will',$2)`,
  [JSON.stringify({ value: 'question' }), now]);
  await db.query("UPDATE pulse.media_groups SET merged_into_id=NULL WHERE id='sample-video-1-crop'");
  await seedCreativeSample(db, settings, now);
  assert.equal((await db.query("SELECT merged_into_id FROM pulse.media_groups WHERE id='sample-video-1-crop'")).rows[0]!.merged_into_id, null);
  const upgraded = await readGroupAttributes(db, 'sample', SAMPLE_CREATIVE_ACCOUNT, 'sample-video-1');
  assert.equal(upgraded.find(row => row.key === 'hookType')!.value, 'unboxing');
  assert.equal(upgraded.find(row => row.key === 'lengthBand')!.source, 'meta');
  assert.equal(upgraded.find(row => row.key === 'productEarly')!.source, 'model');
  assert.equal((await readCreativeLifts(db, SAMPLE_CREATIVE_ACCOUNT, 'sample')).length, 2);
  assert.deepEqual((await db.query("SELECT value FROM pulse.media_attributes WHERE id='invented-live-attribute'")).rows[0]!.value, { value: 'question' });
});
