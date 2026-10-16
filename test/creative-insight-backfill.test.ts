import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import test from 'node:test';
import {AdError} from '../src/ad-spend/model.js';
import {MetaSpend} from '../src/ad-spend/clients.js';
import {MetaCreativeClient} from '../src/creatives/client.js';
import {CreativeWorker} from '../src/creatives/worker.js';
import type {CreativeReader} from '../src/creatives/model.js';
import {creativeHealth} from '../src/creatives/store.js';
import {creativeHealthDetails} from '../src/views.js';
import {defaultSettings} from '../src/settings.js';
import {addDays} from '../src/hero-range.js';
import {createTestDatabase} from './helpers/database.js';
import {creativeInsight} from './helpers/creatives.js';

// Every identifier and figure is invented. No live account is read.
const account='invented-backfill-account', now=new Date('2026-10-16T10:00:00Z');
const settings={...defaultSettings(),metaAdAccountId:account};
const tooLarge=()=>new AdError('http',400,100,1504044);
const reader=(readInsights:CreativeReader['readInsights']):CreativeReader=>({
  readCatalogue:async function*(){},readInsights,videoSource:async()=>'',videoFrames:async()=>[],imageBytes:async()=>new Uint8Array(),
});

test('a seven-day backfill halves refusals to daily saves and advances across every day',async t=>{
  const db=await createTestDatabase();t.after(()=>db.close());t.mock.method(console,'error',()=>{});
  await db.query(`INSERT INTO pulse.creative_jobs(account_id,backfill_next,nightly_day)
    VALUES($1,'2026-10-09','2026-10-16')`,[account]);
  const calls:string[]=[];
  await new CreativeWorker(db,reader(async(_account,from,to)=>{
    calls.push(`${from}/${to}`);
    if(to==='2026-10-16')return [];
    if(from!==to)throw tooLarge();
    return [creativeInsight('invented-backfill-ad',{day:from})];
  })).runInsights(account,settings,now);
  assert.ok(calls.includes('2026-10-09/2026-10-15'));
  assert.ok(calls.includes('2026-10-09/2026-10-11'));
  assert.deepEqual((await db.query('SELECT backfill_next::text,backfill_done,error_code FROM pulse.creative_jobs')).rows[0],
    {backfill_next:'2026-10-16',backfill_done:true,error_code:null});
  assert.equal((await db.query('SELECT day FROM pulse.ad_insights_daily')).rows.length,7);
  assert.equal((await db.query(`SELECT day FROM pulse.creative_insight_days WHERE day<'2026-10-16' AND completed`)).rows.length,7);
});

test('a terminal day is marked and skipped; later success retains its day line and next-UK-day retry',async t=>{
  const db=await createTestDatabase();t.after(()=>db.close());t.mock.method(console,'error',()=>{});
  await db.query(`INSERT INTO pulse.creative_jobs(account_id,backfill_next,nightly_day,insights_error,error_code)
    VALUES($1,'2026-10-09','2026-10-16','http 400, meta 100/1504044 at backfill','http 400, meta 100/1504044 at backfill')`,[account]);
  const requests:{from:string;to:string;limit?:number}[]=[];
  let recover=false;
  const worker=new CreativeWorker(db,reader(async(_account,from,to,options)=>{
    requests.push({from,to,limit:options?.hourlyLimit});
    if(from<='2026-10-12'&&to>='2026-10-12'&&!recover)throw tooLarge();
    return [];
  }));
  await worker.runInsights(account,settings,now);
  const marked=(await db.query(`SELECT day::text,completed,error_code,retry_after FROM pulse.creative_insight_days WHERE error_code IS NOT NULL`)).rows;
  assert.equal(marked.length,1);assert.equal(marked[0]!.day,'2026-10-12');assert.equal(marked[0]!.completed,false);
  assert.equal(new Date(String(marked[0]!.retry_after)).toISOString(),'2026-10-16T23:00:00.000Z');
  assert.ok(requests.some(r=>r.from==='2026-10-12'&&r.to===r.from&&r.limit===250));
  const health=await creativeHealth(db,settings,{META_ACCESS_TOKEN:randomBytes(16).toString('hex')},now);
  assert.equal(health.backfillNext,'2026-10-16');assert.equal(health.backfillDone,true);
  const html=creativeHealthDetails(health);
  assert.match(html,/1 day refused \(meta 1504044\), retry next UK day/);
  assert.doesNotMatch(html,/Creative read needs attention/);
  requests.length=0;
  await db.query('UPDATE pulse.creative_jobs SET nightly_day=NULL WHERE account_id=$1',[account]);
  await worker.runInsights(account,settings,new Date('2026-10-16T10:30:00Z'));
  assert.ok(requests.every(r=>r.from>'2026-10-12'||r.to<'2026-10-12'),'nightly reads respect the marked day cooldown');
  requests.length=0;
  await worker.runInsights(account,settings,new Date('2026-10-17T10:00:00Z'));
  assert.deepEqual(requests.filter(r=>r.from<='2026-10-12'&&r.to>='2026-10-12'),[
    {from:'2026-10-12',to:'2026-10-12',limit:undefined},{from:'2026-10-12',to:'2026-10-12',limit:250},
  ],'only the bounded refused-day queue retries a due marked day');
  assert.equal((await db.query('SELECT error_code FROM pulse.creative_jobs')).rows[0]!.error_code,null);
  recover=true;
  await worker.runInsights(account,settings,new Date('2026-10-18T10:00:00Z'));
  assert.deepEqual((await db.query(`SELECT completed,error_code,retry_after FROM pulse.creative_insight_days WHERE day='2026-10-12'`)).rows[0],
    {completed:true,error_code:null,retry_after:null});
});

test('four original chunks bound a pass and an unfinished legacy backfill error remains visible',async t=>{
  const db=await createTestDatabase();t.after(()=>db.close());
  await db.query(`INSERT INTO pulse.creative_jobs(account_id,backfill_next,nightly_day,insights_error,error_code)
    VALUES($1,'2026-08-07','2026-10-16','http 400, meta 100/1504044 at backfill','http 400, meta 100/1504044 at backfill')`,[account]);
  let calls=0;
  await new CreativeWorker(db,reader(async()=>{calls++;return [];})).runInsights(account,settings,now);
  assert.equal(calls,5);
  assert.deepEqual((await db.query('SELECT backfill_next::text,backfill_done,error_code FROM pulse.creative_jobs')).rows[0],
    {backfill_next:addDays('2026-08-07',28),backfill_done:false,error_code:'http 400, meta 100/1504044 at backfill'});
});

test('smaller hourly pages retain paging and UK-day totals without changing the daily video query',async()=>{
  const requests:URL[]=[];
  const client=new MetaCreativeClient(new MetaSpend(randomBytes(16).toString('hex'),{sleep:async()=>{},fetch:async value=>{
    const url=new URL(String(value));requests.push(url);
    const body=url.pathname.endsWith('/insights')
      ?url.searchParams.has('breakdowns')
        ?{data:[{ad_id:'invented-hour-ad',adset_id:'invented-hour-set',date_start:'2026-10-12',hourly_stats_aggregated_by_advertiser_time_zone:'12:00:00 - 12:59:59',spend:'3',impressions:'10'}],
          ...(!url.searchParams.has('after')?{paging:{next:'https://graph.facebook.com/unused',cursors:{after:'invented-second-page'}}}:{})}
        :{data:[]}
      :{currency:'GBP',timezone_name:'Etc/GMT'};
    return new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
  }}));
  const rows=await client.readInsights(account,'2026-10-12','2026-10-12',{hourlyLimit:250});
  const hours=requests.filter(r=>r.searchParams.has('breakdowns'));
  assert.equal(hours.length,2);assert.ok(hours.every(r=>r.searchParams.get('limit')==='250'));
  assert.equal(hours[1]!.searchParams.get('after'),'invented-second-page');
  assert.equal(requests.find(r=>r.pathname.endsWith('/insights')&&!r.searchParams.has('breakdowns'))!.searchParams.get('limit'),'500');
  assert.equal(rows[0]!.spend,6);
});
