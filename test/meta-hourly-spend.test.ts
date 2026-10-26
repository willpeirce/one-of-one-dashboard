import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { MetaSpend } from '../src/ad-spend/clients.js';
import { aggregateSpendHours, ukHourBucket, type SpendRead, type SpendHourRow } from '../src/ad-spend/model.js';
import { saveSpend, spendFacts } from '../src/ad-spend/store.js';
import { applySpend } from '../src/ad-spend/metrics.js';
import { defaultSettings } from '../src/settings.js';
import { addDays, buildHeroRange } from '../src/hero-range.js';
import { createTestDatabase } from './helpers/database.js';

const settings = { ...defaultSettings(), metaAdAccountId: 'invented-hourly-account' };
const raw = (day: string, hour: number) => ({ campaign_id: 'invented-hourly-campaign', campaign_name: 'Invented UK report',
  adset_id: 'invented-hourly-set', adset_name: 'Invented UK set', date_start: day, spend: '1.25',
  hourly_stats_aggregated_by_advertiser_time_zone: `${String(hour).padStart(2, '0')}:00:00 - ${String(hour).padStart(2, '0')}:59:59` });

test('GMT Meta reports retain UK hours across autumn and spring and London also requests recent hours', async () => {
  for (const [day, expected] of [['2026-10-25', [1, 1, 2]], ['2027-03-28', [0, 2, 3]]] as const) {
    for (const [index, hour] of [0, 1, 2].entries()) assert.deepEqual(ukHourBucket(day, hour, 'GMT'), { day, hour: expected[index] });
    const now = new Date(`${day}T12:00:00Z`), queries: URL[] = [];
    const reader = new MetaSpend(randomBytes(16).toString('hex'), { sleep: async () => {}, fetch: (async (input, init) => {
      assert.equal(init?.method, 'GET'); const url = new URL(String(input)); queries.push(url);
      return Response.json(url.pathname.endsWith('/insights') ? { data: [raw(day, 0), raw(day, 1), raw(day, 2)] } : { currency: 'GBP', timezone_name: 'GMT' });
    }) as typeof fetch });
    const rows = await reader.read(settings.metaAdAccountId, day, day, settings, now);
    assert.equal(rows[0]!.amount, '3.750000');
    assert.deepEqual(rows.hourly!.map(row => [row.hour, row.amount]), day === '2026-10-25' ? [[1, '2.500000'], [2, '1.250000']] : [[0, '1.250000'], [2, '1.250000'], [3, '1.250000']]);
    assert.equal(queries[1]!.searchParams.get('breakdowns'), 'hourly_stats_aggregated_by_advertiser_time_zone');
  }
  assert.deepEqual(ukHourBucket('2026-10-24', 23, 'GMT'), { day: '2026-10-25', hour: 0 });
  assert.deepEqual(ukHourBucket('2027-03-28', 23, 'GMT'), { day: '2027-03-29', hour: 0 });
  const reads: URL[] = [];
  const reader = new MetaSpend(randomBytes(16).toString('hex'), { sleep: async () => {}, fetch: (async input => {
    const url = new URL(String(input)); reads.push(url);
    return Response.json(url.pathname.endsWith('/insights') ? { data: [] } : { currency: 'GBP', timezone_name: 'Europe/London' });
  }) as typeof fetch });
  const result = await reader.read(settings.metaAdAccountId, '2026-10-24', '2026-10-26', settings, new Date('2026-10-26T12:00:00Z'));
  assert.deepEqual(result.hourly, []);
  assert.equal(reads[1]!.searchParams.has('breakdowns'), false);
  assert.equal(reads[2]!.searchParams.get('breakdowns'), 'hourly_stats_aggregated_by_advertiser_time_zone');
  assert.deepEqual(JSON.parse(reads[2]!.searchParams.get('time_range')!), { since: '2026-10-25', until: '2026-10-26' });
});

test('hourly storage replaces, prunes and pro-rates the poll hour at 14:30 for All, UK and US', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const today = '2026-10-26', yesterday = addDays(today, -1), now = new Date(`${today}T14:30:00Z`);
  const hourly: SpendHourRow[] = [];
  for (const day of [yesterday, today]) for (const market of ['uk', 'us', 'unknown'] as const) for (const hour of [0, 1, 14, 15, 23]) {
    if (day === today && hour > 14) continue;
    hourly.push({ source: 'meta', accountId: settings.metaAdAccountId, campaignId: `invented-${market}`, campaignName: `Invented ${market.toUpperCase()}`,
      adSetId: `invented-${market}-set`, adSetName: `Invented ${market.toUpperCase()} set`, market, owner: 'ours', day, hour, amount: market === 'us' ? '2.000000' : '1.000000', currency: 'GBP' });
  }
  const rows: SpendRead = []; rows.hourly = aggregateSpendHours(hourly, yesterday, today);
  await db.query("INSERT INTO pulse.ad_spend_jobs(source,account_id,last_success_at,last_poll_at,backfill_done) VALUES('meta',$1,$2,$2,true)", [settings.metaAdAccountId, now]);
  await saveSpend(db, 'meta', settings.metaAdAccountId, yesterday, today, rows, now);
  await saveSpend(db, 'meta', settings.metaAdAccountId, yesterday, today, rows, now);
  const env = { META_ACCESS_TOKEN: randomBytes(16).toString('hex') };
  const facts = await spendFacts(db, settings, env, 'live', yesterday, today, now);
  assert.equal(facts.metaHourly!.rows.length, 24, 'rereads replace the same hours');
  for (const [market, expected] of [['all', '10.00'], ['uk', '2.50'], ['us', '5.00']] as const) {
    const hero = buildHeroRange([{ date: today, net: 1, o: 1, uk: 1, us: 0, sess: 1, ukS: 1, ukM: 0, usM: 0, g: 0, ours: 0 }], today, today, { today });
    applySpend(hero, [], settings, today, { spend: facts, costs: [], estimates: [], now, market });
    assert.ok(hero.spend.ss.includes(`Meta £${expected} by this time yesterday`));
    hero.from = yesterday; applySpend(hero, [], settings, today, { spend: facts, costs: [], estimates: [], now, market });
    assert.doesNotMatch(hero.spend.ss, /by this time yesterday/);
  }
  await saveSpend(db, 'meta', settings.metaAdAccountId, '2026-10-27', '2026-10-27', [], new Date('2026-10-27T14:30:00Z'));
  assert.equal((await db.query('SELECT DISTINCT uk_day FROM pulse.meta_spend_hours')).rows.length, 2, 'two days old is retained');
  await saveSpend(db, 'meta', settings.metaAdAccountId, '2026-10-28', '2026-10-28', [], new Date('2026-10-28T14:30:00Z'));
  assert.equal((await db.query('SELECT DISTINCT uk_day::text AS day FROM pulse.meta_spend_hours')).rows[0]!.day, today);
  const empty: SpendRead = []; empty.hourly = [];
  await saveSpend(db, 'meta', settings.metaAdAccountId, yesterday, today, empty, now);
  const zeros = await spendFacts(db, settings, env, 'live', yesterday, today, now);
  assert.deepEqual(zeros.metaHourly!.rows, [], 'successful quiet hours remain measured zero');
});


test('historical foreign repeated hours retain their known UK day without inventing a UK-hour allocation',async()=>{
  const reader = new MetaSpend(randomBytes(16).toString('hex'), { sleep: async () => {}, fetch: (async input => {
    const url = new URL(String(input));
    return Response.json(url.pathname.endsWith('/insights') ? { data: [raw('2026-11-01',1)] } : { currency: 'GBP', timezone_name: 'America/New_York' });
  }) as typeof fetch });
  const rows=await reader.read(settings.metaAdAccountId,'2026-11-01','2026-11-01',settings,new Date('2026-11-10T12:00:00Z'));
  assert.equal(rows[0]!.day,'2026-11-01');assert.equal(rows[0]!.amount,'1.250000');assert.equal(rows.hourly,undefined);
});
