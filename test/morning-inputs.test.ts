import assert from 'node:assert/strict';
import test from 'node:test';
import { addDays, ukToday } from '../src/hero-range.js';
import { defaultSettings } from '../src/settings.js';
import { getSampleDashboard } from '../src/sample-dashboard.js';
import { sampleAdSetsView } from '../src/meta-adsets/presentation.js';
import { buildCreativeView } from '../src/creatives/routes.js';
import { sampleCreativeData } from '../src/creatives/sample.js';
import { tickerState } from '../src/ticker/model.js';
import { morningInputFromDashboard, readMorningCoverage } from '../src/morning/inputs.js';
import { morningDeck, morningFacts, morningKey, type MorningState } from '../src/morning/model.js';
import { createTestDatabase } from './helpers/database.js';

test('Morning cleanup requires successful catalogue and creative reads independently of healthy Meta spend', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const now = new Date('2032-04-07T08:00:00Z'), day = ukToday(now), settings = defaultSettings();
  settings.metaAdAccountId = 'invented-morning-account';
  const account = settings.metaAdAccountId;
  for (let offset = -7; offset < 0; offset++) {
    await db.query("INSERT INTO pulse.ad_spend_days(source,account_id,uk_day,fetched_at,actions_complete) VALUES('meta',$1,$2,$3,true)", [account, addDays(day, offset), now]);
    await db.query('INSERT INTO pulse.creative_insight_days(account_id,day,fetched_at,completed) VALUES($1,$2,$3,true)', [account, addDays(day, offset), now]);
  }
  await db.query("INSERT INTO pulse.creative_jobs(account_id,last_success_at,last_catalogue_at,error_code,insights_error) VALUES($1,$2,$2,'denied','denied')", [account, now]);
  const dashboard = getSampleDashboard(settings);
  dashboard.sourceHealth = [{ source: 'meta', name: 'Meta', stage: 2, requiredKeys: [], mode: 'live', status: 'healthy',
    lastAttemptAt: now, lastSuccessAt: now, updatedAt: now, consecutiveFailures: 0 }];
  dashboard.adSets = { ...sampleAdSetsView(settings), mode: 'live', lastRead: new Date(now.getTime() - 60_000).toISOString() };
  dashboard.creatives = { ...buildCreativeView(sampleCreativeData(settings, now), settings, day), mode: 'live', cards: [] };
  const ticker = tickerState([], [], now, 'live');
  const row: MorningState = { mode: 'live', cardKey: morningKey('fading', 'invented-fading'), kind: 'fading', subjectId: 'invented-fading',
    state: 'hidden', untilDay: null, factsHash: morningFacts('fading', 'invented-fading', 'warn', ['frequency']),
    answer: null, credentialId: 'invented-device', pressedAt: now.toISOString(), clearedAt: null, title: 'Invented fading', sourceScope: 'creatives' };
  let coverage = await readMorningCoverage(db, account, now);
  let input = morningInputFromDashboard(dashboard, settings, ticker, 'live', coverage);
  assert.equal(input.sourceReadOk.adsets, false, 'Latest spend attempt is newer than the successful catalogue');
  assert.equal(input.sourceReadOk.creatives, false, 'Healthy spend cannot certify a failed creative read');
  assert.deepEqual(morningDeck(input, [row], now).clearKeys, []);
  await db.query('UPDATE pulse.creative_jobs SET error_code=NULL,insights_error=NULL WHERE account_id=$1', [account]);
  dashboard.adSets.lastRead = now.toISOString();
  coverage = await readMorningCoverage(db, account, now);
  input = morningInputFromDashboard(dashboard, settings, ticker, 'live', coverage);
  assert.equal(input.sourceReadOk.adsets, true);
  assert.equal(input.sourceReadOk.creatives, true);
  assert.deepEqual(morningDeck(input, [row], now).clearKeys, [row.cardKey]);
  dashboard.creatives.performance.frequencyUnavailable = 1;
  input = morningInputFromDashboard(dashboard, settings, ticker, 'live', coverage);
  assert.equal(input.sourceReadOk.creatives, false, 'Independent frequency failure cannot clear a hidden frequency rule');
  assert.deepEqual(morningDeck(input, [row], now).clearKeys, []);
  await db.query('UPDATE pulse.creative_insight_days SET completed=false WHERE account_id=$1 AND day=$2', [account, addDays(day, -1)]);
  await db.query("UPDATE pulse.ad_spend_days SET actions_complete=false WHERE account_id=$1 AND uk_day=$2", [account, addDays(day, -1)]);
  coverage = await readMorningCoverage(db, account, now);
  assert.equal(coverage.adsets, false); assert.equal(coverage.creatives, false);
  const missing = await readMorningCoverage(db, 'invented-waiting-account', now);
  assert.deepEqual(missing, {adsets: false, creatives: false, creativeReadAt: null, google: false, googleReadAt: null});
});

test('Morning retains hidden Google needs while any independent report is failed, waiting, stale or incomplete', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const now = new Date('2032-04-07T08:00:00Z'), today = ukToday(now), from = addDays(today, -7), to = addDays(today, -1);
  const settings = defaultSettings(), account = 'invented-google-cleanup'; settings.googleCustomerId = account;
  const dashboard = getSampleDashboard(settings);
  dashboard.sourceHealth = [{ source: 'google-ads', name: 'Google', stage: 3, requiredKeys: [], mode: 'live', status: 'healthy',
    lastAttemptAt: now, lastSuccessAt: now, updatedAt: now, consecutiveFailures: 0 }];
  const row: MorningState = { mode: 'live', cardKey: morningKey('need', 'google-network:invented:CONTENT'), kind: 'need',
    subjectId: 'google-network:invented:CONTENT', state: 'hidden', untilDay: null,
    factsHash: morningFacts('need', 'google-network:invented:CONTENT', 'warn', 'google-network:invented:CONTENT'),
    answer: null, credentialId: 'invented-device', pressedAt: now.toISOString(), clearedAt: null,
    title: 'Invented network return', sourceScope: 'needs:google-ads' };
  const read = async (at = now) => morningInputFromDashboard(dashboard, settings, tickerState([], [], at, 'live'), 'live',
    await readMorningCoverage(db, '', at, {googleAccount: account, googleNow: at}));
  const kept = (input: ReturnType<typeof morningInputFromDashboard>) => {
    assert.equal(input.sourceReadOk.google, false); assert.equal(input.sourceReadOk['needs:google-ads'], false);
    assert.deepEqual(morningDeck(input, [row], now).clearKeys, []);
  };
  kept(await read());
  for (const kind of ['campaigns', 'networks', 'conversions']) {
    const coverage = kind === 'campaigns' ? null : kind === 'networks' ? {from, to, basis: 'uk'}
      : {from: addDays(from, -1), to: today, basis: 'gmt', ukFrom: from, ukTo: today, completeUkTo: to};
    await db.query(`INSERT INTO pulse.google_sync(mode,account_id,kind,last_attempt_at,last_success_at,error,failures,currency,coverage)
      VALUES('live',$1,$2,$3,$3,NULL,0,'GBP',$4)`, [account, kind, now, coverage ? JSON.stringify(coverage) : null]);
  }
  let input = await read();
  assert.equal(input.sourceReadOk.google, true); assert.equal(input.sourceReadOk['needs:google-ads'], true);
  assert.deepEqual(morningDeck(input, [row], now).clearKeys, [row.cardKey]);
  for (const kind of ['campaigns', 'networks', 'conversions']) {
    await db.query("UPDATE pulse.google_sync SET error='denied',failures=1 WHERE account_id=$1 AND kind=$2", [account, kind]);
    kept(await read());
    await db.query('UPDATE pulse.google_sync SET error=NULL,failures=0 WHERE account_id=$1 AND kind=$2', [account, kind]);
  }
  await db.query("UPDATE pulse.google_sync SET last_attempt_at=$2 WHERE account_id=$1 AND kind='networks'", [account, new Date(now.getTime() + 60_000)]);
  kept(await read(new Date(now.getTime() + 60_000)));
  await db.query('UPDATE pulse.google_sync SET last_attempt_at=last_success_at WHERE account_id=$1', [account]);
  kept(await read(new Date(now.getTime() + 4 * 60 * 60_000 + 1)));
  await db.query("UPDATE pulse.google_sync SET coverage=coverage || $2::jsonb WHERE account_id=$1 AND kind='conversions'",
    [account, JSON.stringify({completeUkTo: addDays(to, -1)})]);
  kept(await read());
  await db.query("UPDATE pulse.google_sync SET coverage=coverage || $2::jsonb WHERE account_id=$1 AND kind='conversions'",
    [account, JSON.stringify({completeUkTo: to})]);
  await db.query("UPDATE pulse.google_sync SET currency='USD' WHERE account_id=$1 AND kind='networks'", [account]);
  kept(await read());
  await db.query("UPDATE pulse.google_sync SET currency='GBP' WHERE account_id=$1", [account]);
  input = await read(); assert.deepEqual(morningDeck(input, [row], now).clearKeys, [row.cardKey]);
  dashboard.sourceHealth[0]!.status = 'error'; kept(await read());
});

test('Morning generic Meta need cleanup waits for its catalogue, activity and Shopify inputs', () => {
  const now = new Date('2032-04-07T08:00:00Z'), settings = defaultSettings(), dashboard = getSampleDashboard(settings);
  const health = { stage: 2, requiredKeys: [], mode: 'live' as const, status: 'healthy' as const,
    lastAttemptAt: now, lastSuccessAt: now, updatedAt: now, consecutiveFailures: 0 };
  dashboard.sourceHealth = [{...health, source: 'meta', name: 'Meta'}, {...health, source: 'shopify', name: 'Shopify'}];
  dashboard.adSets = {...sampleAdSetsView(settings), mode: 'live', lastRead: now.toISOString(),
    activity: {hasRead: true, lastRead: now.toISOString(), error: null, events: [], notOurs: 0, line: 'Invented activity read'}};
  const coverage = {adsets: true, creatives: false, creativeReadAt: null, google: false, googleReadAt: null};
  const read = () => morningInputFromDashboard(dashboard, settings, tickerState([], [], now, 'live'), 'live', coverage);
  assert.equal(read().sourceReadOk['needs:meta'], true);
  dashboard.adSets.activity!.error = 'denied'; assert.equal(read().sourceReadOk['needs:meta'], false);
  dashboard.adSets.activity!.error = null;
  dashboard.adSets.activity!.lastRead = new Date(now.getTime() - 60_000).toISOString();
  assert.equal(read().sourceReadOk['needs:meta'], false, 'An in-flight latest activity read cannot prove the rule cleared');
  dashboard.adSets.activity!.lastRead = now.toISOString();
  dashboard.sourceHealth[1]!.status = 'error'; assert.equal(read().sourceReadOk['needs:meta'], false);
  dashboard.sourceHealth[1]!.status = 'healthy'; coverage.adsets = false;
  assert.equal(read().sourceReadOk['needs:meta'], false);
});
