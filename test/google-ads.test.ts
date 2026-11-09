import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { defaultSettings } from '../src/settings.js';
import { GoogleSpend } from '../src/ad-spend/clients.js';
import { SpendWorker } from '../src/ad-spend/worker.js';
import { GoogleWorker } from '../src/google-ads/worker.js';
import { beginGoogleRead, emptyGoogleFacts, readGoogleFacts, saveGoogleRead } from '../src/google-ads/store.js';
import { googleConversionDays, googleReservedOperations, googleWindow, GoogleQuotaError } from '../src/google-ads/model.js';
import { consumeGoogleOperation } from '../src/google-ads/quota.js';
import { parseGoogleCampaigns, parseGoogleHours, parseGoogleNetworks, parseGoogleDaily } from '../src/google-ads/parsers.js';
import { syncSourceHealth } from '../src/sources.js';
import { spendFacts, saveSpend } from '../src/ad-spend/store.js';
import { createTestDatabase } from './helpers/database.js';
const fixture = async (name: string) => JSON.parse(await readFile(new URL(`fixtures/google-ads/${name}.json`, import.meta.url), 'utf8'));
const flat = (value: any) => value.flatMap((chunk: any) => chunk.results ?? []);
const settings = () => ({ ...defaultSettings(), googleCustomerId: '9000000000', googleLoginCustomerId: '9000000001' });
const env = () => Object.fromEntries(['GOOGLE_ADS_CLIENT_ID','GOOGLE_ADS_CLIENT_SECRET','GOOGLE_ADS_REFRESH_TOKEN'].map(key => [key, randomBytes(16).toString('hex')]));
const at = new Date('2026-11-08T00:00:00Z');
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'request-id': 'invented-request' } });
async function fixtureFetcher(queries: string[], failing: () => string = () => ''): Promise<typeof fetch> {
  const fixtures = Object.fromEntries(await Promise.all(['customer','campaigns','locations','geo','networks','conversions','changes','daily'].map(async name => [name, await fixture(name)])));
  return async (input, init) => {
    const url = new URL(String(input));
    assert.equal(init?.method, 'POST');
    if (url.hostname === 'oauth2.googleapis.com') return response({ access_token: randomBytes(16).toString('hex'), expires_in: 3600 });
    assert.match(url.pathname, /^\/v24\/customers\/9000000000\/googleAds:searchStream$/);
    assert.equal(new Headers(init?.headers).has('developer-token'), false);
    const query = JSON.parse(String(init?.body)).query as string;
    assert.match(query, /^SELECT /);
    assert.doesNotMatch(query, /user_email|user_name|old_resource|new_resource|customer\.email|mutate|;/i);
    queries.push(query);
    const name = query.includes('customer.currency_code') ? 'customer' : query.includes('FROM campaign_criterion') ? 'locations'
      : query.includes('FROM geo_target_constant') ? 'geo' : query.includes('campaign.status') ? 'campaigns'
        : query.includes('ad_network_type') ? 'networks' : query.includes('FROM change_event') ? 'changes'
          : query.includes('FROM customer') ? 'daily' : query.includes('metrics.conversions') ? 'conversions' : 'spend';
    if (name === failing()) return response({ error: { code: 400 } }, 400);
    return response(fixtures[name] ?? [{ results: [] }]);
  };
}

test('fixed Google reads use invented searchStream shapes, positive location country codes, fractional conversions and no personal fields', async () => {
  const queries: string[] = [], reader = new GoogleSpend(env(), { now: () => at.getTime(), sleep: async () => {}, fetch: await fixtureFetcher(queries) }), s = settings();
  const campaigns = await reader.readGoogleCampaigns(s.googleCustomerId, s);
  assert.deepEqual(campaigns.rows[1]?.targetCountries, ['US']);
  assert.equal(campaigns.rows[1]?.targetRoas, 1.6);
  assert.equal(campaigns.rows[1]?.budgetMicros, '35000000');
  const networks = await reader.readGoogleNetworks(s.googleCustomerId, '2026-11-01', '2026-11-07', s);
  assert.deepEqual(networks.rows.map(row => row.network), ['SEARCH','YOUTUBE_WATCH','MIXED','INVENTED_NEW_NETWORK']);
  const conversions = await reader.readGoogleConversions(s.googleCustomerId, '2026-10-31', '2026-11-08', s);
  assert.equal(conversions.rows.reduce((sum, row) => sum + row.conversions, 0), 3);
  const changes = await reader.readGoogleChanges(s.googleCustomerId, '2026-11-06T00:00:00Z', at.toISOString(), s);
  assert.deepEqual(Object.keys(changes.rows[0]!).sort(), ['at','campaignId','id','operation','resourceType']);
  assert.match(queries.find(query => query.includes('FROM change_event'))!, /change_date_time >= .*change_date_time <= .*LIMIT 10000$/);
  const daily = await reader.readGoogleDaily(s.googleCustomerId, '2026-11-01', '2026-11-07', s);
  assert.equal(daily.rows.length, 7); assert.equal(daily.rows[0]?.spendMicros, '0');
  assert.equal(daily.rows.at(-1)?.spendMicros, '40000000');
  assert.equal(queries.length, 8, 'currency plus seven fixed report queries');
  assert.equal(queries.filter(query => query.includes('customer.currency_code')).length, 1);
  assert.doesNotMatch(Object.getOwnPropertyNames(Object.getPrototypeOf(reader)).join(' '), /mutate|delete|update|write/i);
});

test('Google preserves GMT buckets and converts fractional counts across summer and the 25 October clock change', () => {
  const rows = [
    { campaign: {id:'90001'}, segments:{date:'2026-07-01',hour:23}, metrics:{costMicros:'10001',conversions:0.25,conversionsValue:0.5} },
    { campaign: {id:'90001'}, segments:{date:'2026-10-24',hour:23}, metrics:{costMicros:'20002',conversions:0.5} },
    { campaign: {id:'90001'}, segments:{date:'2026-10-25',hour:1}, metrics:{costMicros:'30003',conversions:1.25} },
  ];
  const hours = parseGoogleHours(rows), days = googleConversionDays(hours);
  assert.equal(hours[0]?.day, '2026-07-01'); assert.equal(hours[0]?.hour, 23);
  assert.equal(days[0]?.day, '2026-07-02');
  assert.equal(days[1]?.day, '2026-10-25'); assert.equal(days[1]?.conversions, 1.75);
  assert.equal(days[1]?.spendMicros, '50005');
  const networks = parseGoogleNetworks(rows.map(row => ({...row,segments:{...row.segments,adNetworkType:'MIXED'}})), '2026-07-02', '2026-07-02');
  assert.equal(networks[0]?.day, '2026-07-02'); assert.equal(networks[0]?.network, 'MIXED');
  const window = googleWindow(new Date('2026-07-07T23:30:00Z'));
  assert.equal(window.ukTo, '2026-07-07'); assert.equal(window.gmtTo, '2026-07-06');
  assert.equal(window.hoursFrom, '2026-06-30'); assert.equal(window.hoursTo, '2026-07-07');
});

test('unresolved locations stay unknown instead of falsely narrowing a campaign to one market', () => {
  const campaigns = [{campaign:{id:'90001',name:'Invented Broad',status:'ENABLED'}}];
  const locations = ['900001','900002'].map(id => ({campaign:{id:'90001'},campaignCriterion:{location:{geoTargetConstant:`geoTargetConstants/${id}`}}}));
  const geo = [{geoTargetConstant:{id:'900001',countryCode:'US'}}];
  assert.deepEqual(parseGoogleCampaigns(campaigns,locations,geo)[0]?.targetCountries,['US','ZZ']);
  assert.equal(parseGoogleDaily([], '2026-11-01', '2026-11-07').length,7);
});

test('full UTC day shares one cached Google reader: 121 scheduled reads plus at most 16 history attempts', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const s = settings(), environment = env(), queries: string[] = []; let now = at;
  await syncSourceHealth(db, environment); await db.query('INSERT INTO pulse.settings(values) VALUES($1)',[JSON.stringify(s)]);
  await db.query("INSERT INTO pulse.ad_spend_jobs(source,account_id,backfill_next) VALUES('google-ads',$1,'2024-01-01')",[s.googleCustomerId]);
  t.mock.method(console,'error',()=>{});
  const spend = new SpendWorker(db, environment, {clock:()=>now,fetch:await fixtureFetcher(queries),sleep:async()=>{},log:()=>{}});
  const reports = new GoogleWorker(db, environment, values => spend.googleReader(values), {clock:()=>now});
  t.after(async()=>{await reports.stop();await spend.stop();});
  assert.equal(await spend.googleReader(s), await spend.googleReader(s));
  for (let poll=0;poll<48;poll++) {
    now = new Date(at.getTime()+poll*30*60_000);
    await spend.tick('google-ads'); await reports.tick();
  }
  const facts = await readGoogleFacts(db,s,environment,now);
  assert.equal(queries.length,137); assert.equal(facts.quota.operations,137); assert.equal(facts.quota.historyOperations,16);
  assert.equal(queries.filter(q=>q.includes('FROM change_event')).length,24);
  assert.equal(queries.filter(q=>q.includes('ad_network_type')).length,8);
  assert.equal(queries.filter(q=>q.includes('FROM customer')&&!q.includes('currency_code')).length,8);
  assert.equal(facts.quota.error,'history_allowance');
  assert.equal(facts.jobs.length,5); assert.ok(facts.jobs.every(job=>job.failures===0));
  const restarted = new GoogleWorker(db,environment,values=>spend.googleReader(values),{clock:()=>now});
  await restarted.tick(); await restarted.stop(); assert.equal(queries.length,137,'restart respects persisted due times');
  assert.equal(googleReservedOperations(at),121);
});

test('retry/history allowance cannot consume remaining scheduled first attempts and resets on next UTC day', async t => {
  const db=await createTestDatabase();t.after(()=>db.close());const account=settings().googleCustomerId;
  await db.query("INSERT INTO pulse.ad_spend_jobs(source,account_id,operations_day,operations) VALUES('google-ads',$1,'2026-11-08',79)",[account]);
  await assert.rejects(consumeGoogleOperation(db,account,at,{retry:true}), error=>error instanceof GoogleQuotaError&&error.reason==='reserved');
  await consumeGoogleOperation(db,account,at);
  await db.query("UPDATE pulse.ad_spend_jobs SET operations=199 WHERE source='google-ads' AND account_id=$1",[account]);
  await consumeGoogleOperation(db,account,at);
  await assert.rejects(consumeGoogleOperation(db,account,at),error=>error instanceof GoogleQuotaError&&error.reason==='daily_cap');
  await consumeGoogleOperation(db,account,new Date('2026-11-09T00:00:00Z'),{history:true});
  const row=(await db.query<any>("SELECT operations,google_history_operations,google_quota_error FROM pulse.ad_spend_jobs WHERE source='google-ads' AND account_id=$1",[account])).rows[0];
  assert.deepEqual(row,{operations:1,google_history_operations:1,google_quota_error:null});
});

test('transport retries and a 401 refresh share the durable attempt counter; cap stays non-fatal and visible',async t=>{
  const db=await createTestDatabase();t.after(()=>db.close());const s=settings(),environment=env();
  await db.query('INSERT INTO pulse.settings(values) VALUES($1)',[JSON.stringify(s)]);await syncSourceHealth(db,environment);
  let calls=0;
  const spend=new SpendWorker(db,environment,{clock:()=>at,sleep:async()=>{},log:()=>{},fetch:async input=>{
    if(String(input).includes('oauth2'))return response({access_token:randomBytes(16).toString('hex'),expires_in:3600});
    calls++;if(calls===1)return response({error:{code:401}},401);if(calls===2)return response({error:{code:500}},500);
    return response(await fixture('customer'));
  }});t.after(()=>spend.stop());
  const reader=await spend.googleReader(s);assert.ok(reader);
  await db.query("UPDATE pulse.ad_spend_jobs SET operations_day='2026-11-08',operations=197,backfill_done=true WHERE source='google-ads'");
  // At this usage retries are reserved; the original 401 is followed by no external request.
  await assert.rejects(reader.readGoogleDaily(s.googleCustomerId,'2026-11-01','2026-11-07',s),GoogleQuotaError);
  assert.equal(calls,1);
  await db.query("UPDATE pulse.ad_spend_jobs SET operations=199 WHERE source='google-ads'");
  t.mock.method(console,'error',()=>{});
  const reports=new GoogleWorker(db,environment,values=>spend.googleReader(values),{clock:()=>at});await reports.tick();await reports.stop();
  const facts=await readGoogleFacts(db,s,environment,at);
  assert.equal(facts.quota.operations,200);assert.equal(facts.quota.error,'daily_cap');assert.ok(facts.jobs.every(job=>job.error));
});

test('report failures preserve cached facts and do not block another job or current spend; old spend gains stored countries',async t=>{
  const db=await createTestDatabase();t.after(()=>db.close());const s=settings(),environment=env(),queries:string[]=[];let now=at,failed='';
  await db.query('INSERT INTO pulse.settings(values) VALUES($1)',[JSON.stringify(s)]);await syncSourceHealth(db,environment);
  t.mock.method(console,'error',()=>{});
  const spend=new SpendWorker(db,environment,{clock:()=>now,fetch:await fixtureFetcher(queries,()=>failed),sleep:async()=>{},log:()=>{}});
  const reports=new GoogleWorker(db,environment,values=>spend.googleReader(values),{clock:()=>now});t.after(async()=>{await reports.stop();await spend.stop();});
  await reports.tick();const before=await readGoogleFacts(db,s,environment,now);
  now=new Date(at.getTime()+3*3600000);failed='networks';await reports.tick();const after=await readGoogleFacts(db,s,environment,now);
  assert.deepEqual(after.networks,before.networks);assert.equal(after.jobs.find(j=>j.kind==='networks')?.failures,1);
  assert.equal(after.jobs.find(j=>j.kind==='daily')?.lastSuccessAt,now.toISOString());
  await saveSpend(db,'google-ads',s.googleCustomerId,'2026-11-07','2026-11-07',[{source:'google-ads',accountId:s.googleCustomerId,campaignId:'900000000202',campaignName:'Invented Broad Campaign',adSetId:null,adSetName:null,market:'unknown',owner:'freelancer',day:'2026-11-07',amount:'15.000000',currency:'GBP'}],now);
  const stored=await spendFacts(db,s,environment,'live','2026-11-07','2026-11-07',now);
  assert.deepEqual(stored.rows[0]?.targetCountries,['US']);assert.equal(stored.rows[0]?.market,'us');
  assert.equal(after.jobs.find(j=>j.kind==='conversions')?.coverage?.completeUkTo,'2026-11-07');
});

test('successful empty reports establish coverage and campaign retirement; transaction failure keeps the prior complete snapshot',async t=>{
  const db=await createTestDatabase();t.after(()=>db.close());const s=settings(),environment=env();
  const campaigns=parseGoogleCampaigns(flat(await fixture('campaigns')),flat(await fixture('locations')),flat(await fixture('geo')));
  await beginGoogleRead(db,s.googleCustomerId,'campaigns',at);await saveGoogleRead(db,s.googleCustomerId,'campaigns',campaigns,'GBP',null,at);
  const broken={...db,transaction:<T>(fn:Parameters<typeof db.transaction<T>>[0])=>db.transaction(tx=>fn({...tx,query:async(query,values)=>{if(query.includes('UPDATE pulse.google_sync'))throw new Error('invented database failure');return tx.query(query,values);}}))};
  await assert.rejects(saveGoogleRead(broken,s.googleCustomerId,'campaigns',[],'GBP',null,at));
  assert.equal((await readGoogleFacts(db,s,environment,at)).campaigns.length,2);
  await saveGoogleRead(db,s.googleCustomerId,'campaigns',[],'GBP',null,at);
  assert.equal((await readGoogleFacts(db,s,environment,at)).campaigns.length,0);
  await beginGoogleRead(db,s.googleCustomerId,'conversions',at);
  await saveGoogleRead(db,s.googleCustomerId,'conversions',[],'GBP',{from:'2026-10-31',to:'2026-11-08',basis:'gmt',ukFrom:'2026-11-01',ukTo:'2026-11-08',completeUkTo:'2026-11-07'},at);
  const facts=await readGoogleFacts(db,s,environment,at);assert.deepEqual(facts.hours,[]);assert.equal(facts.jobs.find(j=>j.kind==='conversions')?.lastSuccessAt,at.toISOString());
});

test('disconnected Google worker does no I/O and sample facts never read the live cache',async()=>{
  const db={query:async()=>{throw new Error('unexpected sample query');},transaction:async()=>{throw new Error('unexpected sample transaction');},close:async()=>{}};
  const worker=new GoogleWorker(db,{},async()=>{throw new Error('unexpected sample reader');});worker.start();await worker.tick();await worker.stop();
  assert.deepEqual(await readGoogleFacts(db,settings(),{},at),emptyGoogleFacts());
});

test('successful 500 retry and single 401 refresh count every searchStream attempt once',async t=>{
  const db=await createTestDatabase();t.after(()=>db.close());const s=settings();
  await db.query("INSERT INTO pulse.ad_spend_jobs(source,account_id) VALUES('google-ads',$1)",[s.googleCustomerId]);
  let calls=0,authCalls=0;
  const reader=new GoogleSpend(env(),{now:()=>at.getTime(),sleep:async()=>{},beforeGoogleRead:context=>consumeGoogleOperation(db,s.googleCustomerId,at,context),fetch:async(input,init)=>{
    if(String(input).includes('oauth2')){authCalls++;return response({access_token:randomBytes(16).toString('hex'),expires_in:3600});}
    calls++;if(calls===1)return response({error:{code:500}},500);if(calls===2)return response({error:{code:401}},401);
    const query=JSON.parse(String(init?.body)).query as string;
    return response(query.includes('currency_code')?await fixture('customer'):[{results:[]}]);
  }});
  assert.equal((await reader.readGoogleDaily(s.googleCustomerId,'2026-11-01','2026-11-07',s)).rows.length,7);
  assert.equal(calls,4);assert.equal(authCalls,2);
  assert.equal((await db.query<{operations:number}>("SELECT operations FROM pulse.ad_spend_jobs WHERE source='google-ads' AND account_id=$1",[s.googleCustomerId])).rows[0]?.operations,4);
});

test('standalone Google client caps actual retry attempts as well as logical queries',async()=>{
  let calls=0;const s=settings();
  const reader=new GoogleSpend(env(),{now:()=>at.getTime(),sleep:async()=>{},fetch:async input=>{
    if(String(input).includes('oauth2'))return response({access_token:randomBytes(16).toString('hex'),expires_in:3600});
    calls++;return response({error:{code:500}},500);
  }});
  for(let index=0;index<50;index++)await assert.rejects(reader.readGoogleDaily(s.googleCustomerId,'2026-11-01','2026-11-07',s));
  assert.equal(calls,200);
  await assert.rejects(reader.readGoogleDaily(s.googleCustomerId,'2026-11-01','2026-11-07',s));
  assert.equal(calls,200,'cap denial makes no external attempt');
});

test('failed historical persistence leaves current Google spend healthy and history cursor unchanged',async t=>{
  const db=await createTestDatabase();t.after(()=>db.close());const s=settings(),environment=env();
  await syncSourceHealth(db,environment);await db.query('INSERT INTO pulse.settings(values) VALUES($1)',[JSON.stringify(s)]);
  await db.query("INSERT INTO pulse.ad_spend_jobs(source,account_id,backfill_next) VALUES('google-ads',$1,'2024-01-01')",[s.googleCustomerId]);
  const wrapped={...db,transaction:<T>(fn:Parameters<typeof db.transaction<T>>[0])=>db.transaction(tx=>fn({...tx,query:async(query,values)=>{
    if(query.startsWith('DELETE FROM pulse.ad_spend WHERE')&&values?.[3]==='2024-01-01')throw new Error('invented historical storage failure');
    return tx.query(query,values);
  }}))};
  t.mock.method(console,'error',()=>{});
  const spend=new SpendWorker(wrapped,environment,{clock:()=>at,sleep:async()=>{},log:()=>{},fetch:await fixtureFetcher([])});t.after(()=>spend.stop());
  await spend.tick('google-ads');
  const health=(await db.query<{status:string}>("SELECT status FROM pulse.source_health WHERE source='google-ads'")).rows[0];
  assert.equal(health?.status,'healthy');
  const job=(await db.query<any>("SELECT failures,backfill_next::text FROM pulse.ad_spend_jobs WHERE source='google-ads'")).rows[0];
  assert.deepEqual(job,{failures:0,backfill_next:'2024-01-01'});
  assert.equal((await db.query("SELECT uk_day FROM pulse.ad_spend_days WHERE source='google-ads'")).rows.length,3);
});
