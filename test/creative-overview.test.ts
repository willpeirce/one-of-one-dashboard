import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import type { Database } from '../src/db.js';
import { defaultSettings } from '../src/settings.js';
import { getSampleDashboard } from '../src/sample-dashboard.js';
import { morningInputFromDashboard } from '../src/morning/inputs.js';
import { tickerState } from '../src/ticker/model.js';
import { aggregateCreativeGroups, summarizeCreativeGroups } from '../src/creatives/ranking.js';
import { buildCreativeOverview, buildCreativeSheet, buildCreativeView, readCreativeOverview, readCreativeView } from '../src/creatives/routes.js';
import type { CreativeOverview, CreativeSelection, CreativeView } from '../src/creatives/presentation-types.js';
import { creativeCardsHtml, creativePanelHtml } from '../src/creatives/view.js';
import { sampleCreativeData, SAMPLE_CREATIVE_ACCOUNT } from '../src/creatives/sample.js';
import { seedCreativeSample } from '../src/creatives/seed.js';
import { saveCatalogue, saveInsights } from '../src/creatives/store.js';
import { createTestDatabase } from './helpers/database.js';
import { creativeAd, creativeData, creativeGroup, creativeInsight } from './helpers/creatives.js';

// Every date, ad, amount and account here is an invented fixture.
const now = new Date('2033-07-10T08:00:00Z'), today = '2033-07-10';
const settings = defaultSettings();

function withoutAdLists(view: CreativeView): CreativeOverview {
  return {...view, groups: view.groups.map(({ads: _ads, ...row}) => row),
    top: {...view.top, groups: view.top.groups.map(({ads: _ads, ...row}) => row)}};
}
function sameOverview(full: CreativeView, compact: CreativeOverview): void {
  assert.deepEqual(compact, withoutAdLists(full));
  for (const row of [...compact.groups, ...compact.top.groups]) assert.equal(Object.hasOwn(row, 'ads'), false);
  assert.equal(creativePanelHtml(compact, true), creativePanelHtml(full, true), 'Exact Home creative markup stays unchanged');
  assert.equal(creativeCardsHtml(compact.cards), creativeCardsHtml(full.cards));
  const dashboard = getSampleDashboard(settings), ticker = tickerState([], [], now, full.mode);
  const project = (creatives: CreativeOverview) => morningInputFromDashboard({...dashboard, creatives}, settings, ticker, full.mode);
  const before = project(full), after = project(compact);
  assert.deepEqual(after.creativeFigures, before.creativeFigures, 'Morning keeps identical dials and brief evidence');
  assert.deepEqual(after.creativeCards, before.creativeCards);
}

test('creative overview preserves Home and Morning evidence for every existing sample selection without ad lists', () => {
  const data = sampleCreativeData(settings, now), original = structuredClone(data);
  const selections: CreativeSelection[] = [{}, {window: '24h'}, {window: '7d'}, {owner: 'ours'}, {market: 'us'},
    {kind: 'image'}, {live: false}, {kind: 'video', attribute: 'hookType', value: 'reveal'}, {liftWindow: 3}];
  for (const selection of selections) {
    const full = buildCreativeView(data, settings, today, selection), compact = buildCreativeOverview(data, settings, today, selection);
    sameOverview(full, compact);
    assert.deepEqual(compact.groups.map(row => row.group.id), full.groups.map(row => row.group.id));
    assert.deepEqual(compact.merged, full.merged, 'Known group identities stay available for linked sheets');
    assert.ok(full.groups.every(row => Array.isArray(row.ads)), 'The full library still carries its ad lists');
  }
  assert.deepEqual(data, original, 'Overview projection does not edit shared source inputs');
});

test('summary aggregation retains selected ownership, markets and merged descendants in its exact totals', () => {
  const data = creativeData(['invented-parent', 'invented-image']);
  data.groups[1]!.kind = 'image';
  data.groups.push(creativeGroup('invented-child', {mergedIntoId: 'invented-parent'}),
    creativeGroup('invented-grandchild', {mergedIntoId: 'invented-child'}));
  data.ads[0]!.firstSpendDay = '2033-06-01';
  data.ads.push(creativeAd('invented-us', 'invented-child', {owner: 'freelancer', market: 'us', effectiveStatus: 'PAUSED'}),
    creativeAd('invented-unknown', 'invented-grandchild', {owner: 'unassigned', market: 'unknown'}));
  data.insights = [creativeInsight('invented-parent', {day: today, spend: 90, purchases: 3}),
    creativeInsight('invented-us', {day: today, spend: 40, purchases: 0}),
    creativeInsight('invented-unknown', {day: today, spend: 30, purchases: 1}),
    creativeInsight('invented-image', {day: today, spend: 11, purchases: 0, plays: null, thruPlays: null})];
  const whole = summarizeCreativeGroups(data, {to: today}).find(row => row.group.id === 'invented-parent')!;
  assert.equal(whole.totals.spend, 160); assert.equal(whole.totals.purchases, 4);
  assert.equal(whole.totals.costPerPurchase, 40); assert.equal(whole.firstSpendDay, '2033-06-01');
  assert.deepEqual(whole.markets, ['uk', 'unknown', 'us']);
  assert.deepEqual(whole.owners, ['freelancer', 'ours', 'unassigned']);
  for (const filter of [{}, {market: 'us' as const}, {owner: 'ours' as const}, {live: true}, {live: false}, {kind: 'image' as const}]) {
    const full = aggregateCreativeGroups(data, {...filter, to: today});
    assert.deepEqual(summarizeCreativeGroups(data, {...filter, to: today}), full.map(({ads: _ads, ...row}) => row));
    sameOverview(buildCreativeView(data, settings, today, filter, [], []), buildCreativeOverview(data, settings, today, filter, [], []));
  }
  assert.equal(summarizeCreativeGroups(data, {market: 'us', to: today})[0]!.totals.spend, 40);
  assert.equal(summarizeCreativeGroups(data, {live: true, to: today}).find(row => row.group.id === 'invented-parent')!.totals.spend, 120);
});

test('stored sample overview is read-only, retains hidden-card state and all brief windows, and details keep full ads', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  await seedCreativeSample(db, settings, now);
  const first = await readCreativeView(db, settings, {}, now, {}, {seedSample: false, briefWindows: true});
  assert.ok(first.cards.length);
  const hidden = first.cards[0]!.id;
  await db.query(`INSERT INTO pulse.creative_card_states(mode,account_id,card_id,done_at)
    VALUES('sample',$1,$2,$3)`, [SAMPLE_CREATIVE_ACCOUNT, hidden, now]);
  const writes: string[] = [];
  const readOnly: Database = {...db, query(sql, values) {
    if (/\b(?:INSERT\s+INTO|UPDATE\s+pulse\.|DELETE\s+FROM)\b/i.test(sql)) writes.push(sql);
    return db.query(sql, values);
  }, async transaction() { throw new Error('An overview read must not open a write transaction.'); }, async close() {}};
  const [full, compact] = await Promise.all([
    readCreativeView(readOnly, settings, {}, now, {}, {seedSample: false, briefWindows: true}),
    readCreativeOverview(readOnly, settings, {}, now, {}, {seedSample: false, briefWindows: true}),
  ]);
  sameOverview(full, compact);
  assert.deepEqual(writes, []); assert.equal(compact.cards.some(card => card.id === hidden), false);
  assert.deepEqual(Object.keys(compact.briefWindows!), ['1', '3', '7']);
  assert.ok(full.groups.some(row => row.ads.length > 0));
  const data = sampleCreativeData(settings, now);
  const sheet = await buildCreativeSheet(data, settings, today, data.groups[0]!.id, {}, async () => ({count: null, mode: 'sample'}));
  assert.ok(sheet?.ads.length); assert.ok(sheet!.group.ads.length);
  assert.equal(sheet!.ads[0]!.body, data.ads.find(ad => ad.id === sheet!.ads[0]!.id)!.body);
});

test('a live stored overview matches the full read and never falls back to sample fields', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const account = '120000000000081001', liveSettings = {...settings, metaAdAccountId: account,
    metaOwners: [{campaignId: 'invented-campaign', owner: 'ours' as const}]};
  const group = creativeGroup('invented-live-fern', {firstSeen: '2033-07-01T08:00:00Z'});
  const ad = creativeAd('invented-live-fern-ad', group.id, {accountId: account,
    body: 'Invented detail copy that the compact overview does not need.'});
  await saveCatalogue(db, account, [{ad, media: {...group, thumbnail: null, poster: null, frames: []}}], now);
  await saveInsights(db, account, today, today, [creativeInsight(ad.id, {day: today, spend: 80, purchases: 4})], now);
  const env = {META_ACCESS_TOKEN: randomBytes(24).toString('hex')};
  const full = await readCreativeView(db, liveSettings, env, now, {}, {seedSample: false, briefWindows: true});
  const compact = await readCreativeOverview(db, liveSettings, env, now, {}, {seedSample: false, briefWindows: true});
  sameOverview(full, compact);
  assert.equal(compact.mode, 'live'); assert.equal(compact.accountId, account);
  assert.equal(compact.groups.length, 1); assert.equal(compact.groups[0]!.totals.spend, 80);
  assert.ok(JSON.stringify(full).includes(ad.body)); assert.equal(JSON.stringify(compact).includes(ad.body), false);
  const empty = await readCreativeOverview(db, {...liveSettings, metaAdAccountId: '120000000000081002'}, env, now, {}, {seedSample: false});
  assert.equal(empty.mode, 'live'); assert.deepEqual(empty.groups, []); assert.deepEqual(empty.cards, []);
});

test('independent creative overview reads start while an attribute read is waiting', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  let release!: () => void, started!: () => void, siblings!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const attributeStarted = new Promise<void>(resolve => { started = resolve; });
  const siblingReads = new Promise<void>(resolve => { siblings = resolve; });
  const seen = new Set<string>();
  const observed: Database = {...db, async query(sql, values) {
    if (sql.includes('FROM pulse.media_attributes a')) { started(); await gate; }
    if (sql.includes('FROM pulse.attribute_lifts')) seen.add('lifts');
    if (sql.includes('FROM pulse.creative_card_states')) seen.add('states');
    if (seen.size === 2) siblings();
    return db.query(sql, values);
  }};
  const reading = readCreativeOverview(observed, settings, {}, now, {}, {seedSample: false});
  await attributeStarted;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([siblingReads, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Independent reads waited for the blocked attribute read.')), 1000);
    })]);
  } finally { if (timer) clearTimeout(timer); release(); }
  await reading;
  assert.deepEqual([...seen].sort(), ['lifts', 'states']);
});
