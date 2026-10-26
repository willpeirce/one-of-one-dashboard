import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createTestDatabase } from './helpers/database.js';
import { defaultSettings } from '../src/settings.js';
import { AdError, type SpendRow } from '../src/ad-spend/model.js';
import { MetaSpend, type SpendReader } from '../src/ad-spend/clients.js';
import { AdTransport } from '../src/ad-spend/http.js';
import { backfillMetaSpend } from '../src/ad-spend/backfill.js';
import { readJobs, saveSpend, spendFacts, spendHealth } from '../src/ad-spend/store.js';
import { SpendWorker, SPEND_POLL_INTERVAL_MS } from '../src/ad-spend/worker.js';
import { addDays, buildHeroRange, dayCount } from '../src/hero-range.js';
import { applySpend, spendNeeds } from '../src/ad-spend/metrics.js';
import { syncSourceHealth } from '../src/sources.js';
import { sourceHealthPage } from '../src/views.js';

// Invented account identifier; Settings accepts numeric account IDs.
const account='990888001', now=new Date('2026-10-26T12:00:00Z');
const settings={...defaultSettings(),metaAdAccountId:account};
const env={META_ACCESS_TOKEN:randomBytes(16).toString('hex')};
const row:SpendRow={source:'meta',accountId:account,campaignId:'invented-history-campaign',campaignName:'Invented UK history',
  adSetId:'invented-history-set',adSetName:'Invented UK history set',market:'uk',owner:'ours',day:'2026-09-01',amount:'4.250000',currency:'GBP'};
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};};

test('041 resets only Meta spend to 400 UK days ago and leaves other jobs untouched',async t=>{
  const db=await createTestDatabase({migrate:false});t.after(()=>db.close());
  await db.query('CREATE SCHEMA pulse_private');
  const directory=new URL('../migrations/',import.meta.url);
  for(const file of (await readdir(directory)).filter(file=>file.endsWith('.sql')&&file<'041').sort()) await db.query(await readFile(new URL(file,directory),'utf8'));
  for(const source of ['meta','google-ads','tiktok'])await db.query("INSERT INTO pulse.ad_spend_jobs(source,account_id,backfill_next,backfill_done) VALUES($1,$2,'2026-10-01',true)",[source,account]);
  await db.query("INSERT INTO pulse.creative_jobs(account_id,backfill_next,backfill_done) VALUES($1,'2026-10-02',true)",[account]);
  const before=(await db.query("SELECT source,to_jsonb(j) AS job FROM pulse.ad_spend_jobs j WHERE source<>'meta' ORDER BY source")).rows;
  const creative=(await db.query('SELECT to_jsonb(j) AS job FROM pulse.creative_jobs j')).rows;
  await db.query(await readFile(new URL('041_meta_spend_backfill.sql',directory),'utf8'));
  const meta=(await db.query("SELECT backfill_next=(CURRENT_TIMESTAMP AT TIME ZONE 'Europe/London')::date-400 AS correct,backfill_first=backfill_next AS first,backfill_done FROM pulse.ad_spend_jobs WHERE source='meta'")).rows[0]!;
  assert.deepEqual(meta,{correct:true,first:true,backfill_done:false});
  const others=(await db.query("SELECT source,to_jsonb(j)-'backfill_first'-'backfill_window_days'-'backfill_next_run_at'-'backfill_error' AS job FROM pulse.ad_spend_jobs j WHERE source<>'meta' ORDER BY source")).rows;
  assert.deepEqual(others,before);assert.deepEqual((await db.query('SELECT to_jsonb(j) AS job FROM pulse.creative_jobs j')).rows,creative);
});

test('backfill halves to one day, keeps its cursor on failure and resumes after restart',async t=>{
  const db=await createTestDatabase();t.after(()=>db.close());
  await db.query("INSERT INTO pulse.ad_spend_jobs(source,account_id,backfill_first,backfill_next) VALUES('meta',$1,$2,$2)",[account,row.day]);
  assert.match((await spendHealth(db,env,settings,now))[0]!.backfill!,/Meta spend backfill: starting from 2026-09-01, 54 days left, next run 26 Oct 12:00 UK/);
  const spans:number[]=[],starts:string[]=[];let refusing=true;
  const reader:SpendReader={read:async(_,from,to)=>{spans.push(dayCount(from,to));starts.push(from);if(refusing)throw new AdError('http',400,1);return [{...row,day:from}];}};
  t.mock.method(console,'error',()=>{});
  await backfillMetaSpend(db,reader,account,settings,now,SPEND_POLL_INTERVAL_MS,()=>now,()=>false);
  assert.deepEqual(spans,[14,7,3,1]);
  const failed=(await readJobs(db))[0]!;
  assert.equal(failed.backfill_next,row.day);assert.equal(failed.backfill_window_days,1);assert.equal(failed.backfill_error,'http 400, meta 1');
  refusing=false;spans.length=0;starts.length=0;
  await backfillMetaSpend(db,reader,account,settings,now,SPEND_POLL_INTERVAL_MS,()=>now,()=>false);
  assert.deepEqual(spans,[1,14,14,14]);assert.equal(starts[0],row.day);
  assert.equal((await readJobs(db))[0]!.backfill_next,addDays(row.day,43));
  assert.equal((await readJobs(db))[0]!.backfill_error,null);
  const progress=(await spendHealth(db,env,settings,now))[0]!.backfill!;
  assert.match(progress,/Meta spend backfill: read from 2026-09-01 to 2026-10-13, 11 days left, next run 26 Oct 12:30 UK/);
  assert.ok(sourceHealthPage([],undefined,undefined,await spendHealth(db,env,settings,now)).includes(progress));
  await backfillMetaSpend(db,reader,account,settings,now,SPEND_POLL_INTERVAL_MS,()=>now,()=>false);
  assert.equal((await spendHealth(db,env,settings,now))[0]!.backfill,'Meta spend history back to 2026-09-01');
});

test('HTTP 500 halving yields when live polling is due; a running history read cannot block the next live poll',async t=>{
  const db=await createTestDatabase();let worker:SpendWorker|undefined;
  const started=deferred(),release=deferred();
  t.after(async()=>{release.resolve();await worker?.stop();await db.close();});
  await syncSourceHealth(db,env);await db.query('INSERT INTO pulse.settings(values) VALUES($1)',[JSON.stringify(settings)]);
  await db.query("INSERT INTO pulse.ad_spend_jobs(source,account_id,backfill_first,backfill_next,actions_backfilled_at) VALUES('meta',$1,$2,$2,$3)",[account,row.day,now]);
  let clock=now,live=0,history=0;
  const reader:SpendReader={read:async(_,from,to)=>{
    if(to>='2026-10-25'){live++;return [];}
    history++;started.resolve();await release.promise;throw new AdError('http',500);
  }};
  worker=new SpendWorker(db,env,{clock:()=>clock,readers:{meta:reader}});
  await worker.tick('meta');await started.promise;assert.equal(live,1);
  clock=new Date(now.getTime()+SPEND_POLL_INTERVAL_MS);
  await worker.tick('meta');assert.equal(live,2);
  release.resolve();await worker.waitForSpendBackfill();
  assert.equal(history,1,'the smaller retry yields to the live poll');
  assert.match((await spendHealth(db,env,settings,clock))[0]!.backfill!,/next run 26 Oct 13:00 UK/);
  assert.equal((await readJobs(db))[0]!.backfill_window_days,7);
  assert.equal((await readJobs(db))[0]!.failures,0);
  assert.equal((await db.query("SELECT status FROM pulse.source_health WHERE source='meta'")).rows[0]!.status,'healthy');
});

test('an explicit old hourly refusal falls back to flagged GMT days, replaces them and explains the period',async t=>{
  const db=await createTestDatabase();t.after(()=>db.close());const methods:string[]=[],queries:URL[]=[];
  const reader=new MetaSpend(randomBytes(16).toString('hex'),{sleep:async()=>{},fetch:(async(input,init)=>{
    methods.push(init?.method??'');const url=new URL(String(input));queries.push(url);
    if(!url.pathname.endsWith('/insights'))return Response.json({currency:'GBP',timezone_name:'GMT'});
    if(url.searchParams.has('breakdowns'))return Response.json({error:{code:100,message:'Hourly breakdown is not available for this old time range'}},{status:400});
    return Response.json({data:[{campaign_id:row.campaignId,campaign_name:row.campaignName,adset_id:row.adSetId,adset_name:row.adSetName,date_start:row.day,spend:row.amount}]});
  }) as typeof fetch});
  const rows=await reader.read(account,row.day,row.day,settings,now);assert.equal(rows[0]!.dayBasis,'gmt');assert.ok(methods.every(method=>method==='GET'));
  assert.deepEqual(JSON.parse(queries.at(-1)!.searchParams.get('time_range')!),{since:row.day,until:row.day});
  await db.query("INSERT INTO pulse.ad_spend_jobs(source,account_id,last_success_at,backfill_done) VALUES('meta',$1,$2,true)",[account,now]);
  await saveSpend(db,'meta',account,row.day,row.day,rows,now);await saveSpend(db,'meta',account,row.day,row.day,rows,now);
  const facts=await spendFacts(db,settings,env,'live',row.day,row.day,now);assert.equal(facts.rows.length,1);assert.equal(facts.rows[0]!.dayBasis,'gmt');
  const hero=buildHeroRange([{date:row.day,net:1,o:1,uk:1,us:0,sess:1,ukS:1,ukM:0,usM:0,g:0,ours:0}],row.day,row.day,{today:'2026-10-26'});
  applySpend(hero,[],settings,'2026-10-26',{spend:facts,costs:[],estimates:[],now});assert.match(JSON.stringify(hero.spend.d),/reported as GMT days/);
  await assert.rejects(reader.read(account,'2026-10-25','2026-10-26',settings,now),error=>error instanceof AdError&&error.code==='hourly_unavailable');
  await saveSpend(db,'meta',account,row.day,row.day,[row],now);
  const replaced=await spendFacts(db,settings,env,'live',row.day,row.day,now);assert.equal(replaced.rows[0]!.dayBasis,'uk');
});

test('unknown-market and currency notices count only the last fourteen UK days',()=>{
  const facts={mode:'live' as const,rows:[{...row,market:'unknown' as const,currency:'USD'}],days:[],sources:[]};
  assert.equal(spendNeeds(facts,settings,'2026-10-26',now).length,0);
  facts.rows[0]!.day='2026-10-13';assert.equal(spendNeeds(facts,settings,'2026-10-26',now).length,2);
  facts.rows[0]!.day='2026-10-12';assert.equal(spendNeeds(facts,settings,'2026-10-26',now).length,0);
});


test('Meta code 1 uses the existing three transport retries before the window halves',async()=>{
  let calls=0;const waits:number[]=[];
  const http=new AdTransport('meta',{now:()=>0,sleep:async ms=>{waits.push(ms);},fetch:(async()=>{
    calls++;return Response.json({error:{code:1}},{status:400});
  }) as typeof fetch});
  await assert.rejects(http.request('https://example.test/insights',{method:'GET'}),error=>error instanceof AdError&&error.providerCode===1);
  assert.equal(calls,4);assert.ok(waits.includes(250)&&waits.includes(500)&&waits.includes(1000));
});


test('two failed backfill runs stay silent, three raise a card and success clears it',async t=>{
 const db=await createTestDatabase();t.after(()=>db.close());t.mock.method(console,'error',()=>{});
 await db.query("INSERT INTO pulse.ad_spend_jobs(source,account_id,backfill_first,backfill_next) VALUES('meta',$1,$2,$2)",[account,row.day]);
 let fails=true;const reader:SpendReader={read:async()=>{if(fails)throw new AdError('http',400,100);return [];}};
 const cards=async()=>spendNeeds(await spendFacts(db,settings,env,'live',row.day,'2026-10-26',now),settings,'2026-10-26',now).filter(c=>c.id==='meta-backfill-stuck');
 for(let i=1;i<=3;i++){
  await backfillMetaSpend(db,reader,account,settings,now,SPEND_POLL_INTERVAL_MS,()=>now,()=>false);
  assert.equal((await readJobs(db))[0]!.backfill_failures,i);
  assert.equal((await cards()).length,i===3?1:0);
 }
 assert.match((await cards())[0]!.title,/stuck at 2026-09-01: http 400, meta 100/);
 fails=false;await backfillMetaSpend(db,reader,account,settings,now,SPEND_POLL_INTERVAL_MS,()=>now,()=>false);
 assert.equal((await readJobs(db))[0]!.backfill_failures,0);assert.equal((await cards()).length,0);
});
