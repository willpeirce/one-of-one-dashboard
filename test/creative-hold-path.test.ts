import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import test from 'node:test';
import {MetaSpend} from '../src/ad-spend/clients.js';
import {MetaCreativeClient} from '../src/creatives/client.js';
import {saveCatalogue,saveInsights,readLiveCreativeData} from '../src/creatives/store.js';
import {aggregateCreativeGroups} from '../src/creatives/ranking.js';
import {computeCreativeLifts} from '../src/creatives/lifts.js';
import {defaultSettings} from '../src/settings.js';
import {creativeAd,creativeGroup} from './helpers/creatives.js';
import {createTestDatabase} from './helpers/database.js';
import {CreativeWorker} from '../src/creatives/worker.js';
import {AdError} from '../src/ad-spend/model.js';
import {creativeHealth} from '../src/creatives/store.js';
import {creativeHealthDetails} from '../src/views.js';
test('a later successful insight backfill clears its stored 1504044 attention error',async t=>{
 const db=await createTestDatabase();t.after(()=>db.close());const account='invented-recovered-backfill',now=new Date('2026-10-16T12:00:00Z');
 const settings={...defaultSettings(),metaAdAccountId:account},env={META_ACCESS_TOKEN:randomBytes(16).toString('hex')};
 await db.query("INSERT INTO pulse.creative_jobs(account_id,backfill_next,nightly_day) VALUES($1,'2026-10-15','2026-10-16')",[account]);
 let fail=true;t.mock.method(console,'error',()=>{});
 const reader:import('../src/creatives/model.js').CreativeReader={readCatalogue:async function*(){yield []},readInsights:async(_,from,to)=>{
  if(from===to&&fail)throw new AdError('http',400,2,1504044);return [];
 },imageBytes:async()=>new Uint8Array(),videoSource:async()=>'',videoFrames:async()=>[]};
 const worker=new CreativeWorker(db,reader);
 await worker.runInsights(account,settings,now);
 assert.match(creativeHealthDetails(await creativeHealth(db,settings,env,now)),/Creative read needs attention \(http 400, meta 2\/1504044 at backfill\)/);
 fail=false;await worker.runInsights(account,settings,now);
 assert.doesNotMatch(creativeHealthDetails(await creativeHealth(db,settings,env,now)),/Creative read needs attention/);
 assert.deepEqual((await db.query('SELECT error_code,insights_error FROM pulse.creative_jobs')).rows,[{error_code:null,insights_error:null}]);
});
test('fixture ThruPlays traverse daily Meta response, parser, database, group totals and lift totals',async t=>{
 const db=await createTestDatabase();t.after(()=>db.close());const account='invented-hold-path',day='2026-10-16',settings={...defaultSettings(),metaAdAccountId:account,creativeLiftMinimumSpendGbp:1};
 const ids=Array.from({length:6},(_,i)=>`invented-hold-${i}`);
 await saveCatalogue(db,account,ids.map((id,i)=>({ad:creativeAd(`${id}-ad`,id,{accountId:account}),media:{...creativeGroup(id,{lengthSeconds:10+i*2,title:`Invented distinct ${i}`}),thumbnail:null,poster:null,frames:[]}})),new Date());
 const options={sleep:async()=>{},fetch:(async url=>{const u=new URL(String(url));if(!u.pathname.endsWith('/insights'))return Response.json({currency:'GBP',timezone_name:'GMT'});
  const hourly=u.searchParams.has('breakdowns'),fields=u.searchParams.get('fields')!.split(',');
  assert.equal(fields.includes('video_thruplay_watched_actions'),!hourly);
  return Response.json({data:ids.map((id,i)=>({ad_id:`${id}-ad`,adset_id:'invented-adset',date_start:day,...(hourly?{hourly_stats_aggregated_by_advertiser_time_zone:'10:00:00 - 10:59:59',spend:'100',impressions:'500',actions:[{action_type:'video_view',value:'200'},{action_type:'omni_purchase',value:i<3?'10':'2'}]}:{actions:[{action_type:'video_view',value:'100'}],video_thruplay_watched_actions:[{action_type:'video_view',value:'20'}],video_play_actions:[{action_type:'video_view',value:'150'}]} )}))});
 }) as typeof fetch};
 const client=new MetaCreativeClient(new MetaSpend(randomBytes(16).toString('hex'),options),options);
 const rows=await client.readInsights(account,day,day);assert.ok(rows.every(r=>r.thruPlays===20&&r.holdThreeSecondPlays===100&&r.threeSecondPlays===200));
 await saveInsights(db,account,day,day,rows,new Date());
 const data=await readLiveCreativeData(db,settings);assert.equal(data.insights.reduce((n,r)=>n+(r.thruPlays??0),0),120);
 const groups=aggregateCreativeGroups(data);assert.equal(groups.length,6);assert.ok(groups.every(g=>g.totals.holdRate===0.2));
 const lifts=computeCreativeLifts(data,ids.map((id,i)=>({groupId:id,key:'hookType',source:'will' as const,value:i<3?'unboxing':'question'})),settings,new Date(`${day}T12:00:00Z`));
 assert.ok(lifts.length);assert.ok(lifts.every(l=>l.metrics.with.holdRate===0.2&&l.metrics.without.holdRate===0.2));
});

test('mixed missing ThruPlay days use matching denominators; all missing is n/a and stays null in storage',async t=>{
 const {creativeInsight,creativeData}=await import('./helpers/creatives.js');
 const {creativeTotals}=await import('../src/creatives/ranking.js');
 const {creativePerformanceTableHtml}=await import('../src/creatives/performance-view.js');
 const rows=[creativeInsight('invented-ad',{day:'2026-10-14',thruPlays:20,holdThreeSecondPlays:100}),creativeInsight('invented-ad',{day:'2026-10-15',thruPlays:null,holdThreeSecondPlays:900})];
 assert.equal(creativeTotals(rows).holdRate,.2);assert.equal(creativeTotals(rows).holdThreeSecondPlays,100);
 const db=await createTestDatabase();t.after(()=>db.close());const account='invented-null-hold';
 await saveInsights(db,account,'2026-10-14','2026-10-15',rows,new Date());
 const stored=await readLiveCreativeData(db,{...defaultSettings(),metaAdAccountId:account});
 assert.equal(stored.insights.find(r=>r.day==='2026-10-15')!.thruPlays,null);assert.equal(creativeTotals(stored.insights).holdRate,.2);
 const data=creativeData(['invented-empty-hold']);data.insights[0]!.thruPlays=null;
 const totals=aggregateCreativeGroups(data)[0]!.totals;assert.equal(totals.holdRate,null);assert.equal(totals.holdDataRows,0);
 assert.equal(creativeTotals([{...data.insights[0]!,thruPlays:undefined} as unknown as import('../src/creatives/model.js').AdInsight]).holdDataRows,0);
 // Only the performance table's documented input fields are used here.
 const sheet={group:aggregateCreativeGroups(data)[0]!,windows:[{window:'lifetime',totals}]} as Parameters<typeof creativePerformanceTableHtml>[0];
 assert.match(creativePerformanceTableHtml(sheet),/n\/a \(no ThruPlay data\)/);
 assert.equal(creativeTotals([creativeInsight('invented-zero',{thruPlays:0,holdThreeSecondPlays:100})]).holdRate,0,'measured zero remains zero');
});

test('a refused three-day ThruPlay report splits into single days with narrow paged fields and preserves spend',async t=>{
 const {repairThruPlays,thruPlayHealth}=await import('../src/creatives/thruplay-repair.js');
 const {creativeInsight}=await import('./helpers/creatives.js');
 const db=await createTestDatabase();t.after(()=>db.close());const account='invented-thruplay-small',now=new Date('2026-10-16T12:00:00Z');
 const days=['2026-10-02','2026-10-03','2026-10-04'];
 await db.query('INSERT INTO pulse.creative_jobs(account_id) VALUES($1)',[account]);
 await db.query("INSERT INTO pulse.creative_thruplay_days(account_id,day) SELECT $1,unnest($2::date[])",[account,days]);
 await saveInsights(db,account,days[0]!,days[2]!,days.map(day=>creativeInsight('invented-repair-ad',{day,spend:77,purchases:4,thruPlays:null,holdThreeSecondPlays:120})),now);
 const calls:string[][]=[];const waits:number[]=[];let limited=true;
 const options={sleep:async(ms:number)=>{waits.push(ms);},fetch:(async input=>{
  const url=new URL(String(input));assert.equal(url.pathname.split('/').at(-1),'insights');
  assert.equal(url.searchParams.get('fields'),'ad_id,date_start,video_play_actions,video_thruplay_watched_actions');
  assert.equal(url.searchParams.get('limit'),'500');assert.equal(url.searchParams.get('time_increment'),'1');assert.equal(url.searchParams.has('breakdowns'),false);
  const {since,until}=JSON.parse(url.searchParams.get('time_range')!);calls.push([since,until]);
  if(since!==until)return Response.json({error:{code:2,error_subcode:1504044}},{status:400});
  if(limited){limited=false;return Response.json({error:{code:80004}},{status:400});}
  const after=url.searchParams.get('after');
  return Response.json({data:[{ad_id:after?'invented-extra-ad':'invented-repair-ad',date_start:since,video_play_actions:[{action_type:'video_view',value:'150'}],video_thruplay_watched_actions:[{action_type:'video_view',value:'30'}]}],...(!after?{paging:{next:'unused',cursors:{after:'invented-next-page'}}}:{})});
 }) as typeof fetch};
 const client=new MetaCreativeClient(new MetaSpend(randomBytes(16).toString('hex'),options),options);
 await repairThruPlays(db,client,account,now);
 assert.deepEqual(calls.filter((r,i)=>i===0||r.join()!==calls[i-1]!.join()),[[days[0],days[2]],...days.map(day=>[day,day])]);
 assert.ok(waits.some(ms=>ms>=15*60000));assert.equal((await thruPlayHealth(db,account)).completed,3);
 const saved=await readLiveCreativeData(db,{...defaultSettings(),metaAdAccountId:account});
 assert.equal(saved.insights.length,3);assert.ok(saved.insights.every(r=>r.spend===77&&r.purchases===4&&r.thruPlays===30&&r.plays===150&&r.holdThreeSecondPlays===120));
 assert.equal(Number((await db.query<any>('SELECT count(*) FROM pulse.creative_insight_days WHERE completed')).rows[0].count),3,'video repair does not replace full-day coverage');
});

test('ThruPlay day progress survives restart, skips a failed day and retries it next UK day',async t=>{
 const {repairThruPlays,thruPlayHealth}=await import('../src/creatives/thruplay-repair.js');
 const {AdError}=await import('../src/ad-spend/model.js');
 const {creativeHealth}=await import('../src/creatives/store.js');
 const {creativeHealthDetails}=await import('../src/views.js');
 const db=await createTestDatabase();t.after(()=>db.close());const account='invented-thruplay-resume',now=new Date('2026-10-16T12:00:00Z');
 await db.query("INSERT INTO pulse.creative_jobs(account_id,backfill_done,insights_error,error_code) VALUES($1,true,$2,$2)",[account,'http 400, meta 2/1504044 at backfill']);
 const calls:string[][]=[],logs:string[]=[];t.mock.method(console,'error',(line:string)=>logs.push(line));let fail=true;
 const reader:import('../src/creatives/model.js').CreativeReader={readCatalogue:async function*(){yield []},readInsights:async()=>[],imageBytes:async()=>new Uint8Array(),videoSource:async()=>'',videoFrames:async()=>[],readThruPlays:async(_,from,to)=>{
  calls.push([from,to]);if(fail&&from<='2026-10-03'&&to>='2026-10-03')throw new AdError('http',400,2,1504044);return [];
 }};
 await repairThruPlays(db,reader,account,now);
 assert.deepEqual(await thruPlayHealth(db,account),{completed:11,total:14,failures:[{day:'2026-10-03',code:'http 400, meta 2/1504044 at backfill'}]});
 assert.deepEqual(logs,['Meta ThruPlay backfill 2026-10-03 failed (http 400, meta 2/1504044 at backfill).']);
 const health=await creativeHealth(db,{...defaultSettings(),metaAdAccountId:account},{META_ACCESS_TOKEN:randomBytes(16).toString('hex')},now);
 assert.match(creativeHealthDetails(health),/ThruPlay backfill: 11 of 14 days complete, 1 day refused \(meta 1504044\), retry next UK day/);
 assert.doesNotMatch(creativeHealthDetails(health),/Creative read needs attention/);
 assert.deepEqual((await db.query('SELECT error_code,insights_error FROM pulse.creative_jobs')).rows,[{error_code:null,insights_error:null}]);
 calls.length=0;await repairThruPlays(db,{...reader},account,new Date('2026-10-16T12:30:00Z'));
 assert.deepEqual(calls,[['2026-10-14','2026-10-15']]);assert.equal((await thruPlayHealth(db,account)).completed,13);
 calls.length=0;fail=false;await repairThruPlays(db,{...reader},account,new Date('2026-10-16T23:01:00Z'));
 assert.deepEqual(calls,[['2026-10-03','2026-10-03']]);assert.equal((await thruPlayHealth(db,account)).completed,14);
 assert.ok((await db.query<any>('SELECT thruplays_backfilled_at FROM pulse.creative_jobs')).rows[0].thruplays_backfilled_at);
 const recovered=await creativeHealth(db,{...defaultSettings(),metaAdAccountId:account},{META_ACCESS_TOKEN:randomBytes(16).toString('hex')},now);
 assert.doesNotMatch(creativeHealthDetails(recovered),/Creative read needs attention|days? refused/);
 calls.length=0;await repairThruPlays(db,reader,account,new Date('2026-10-18T12:00:00Z'));assert.deepEqual(calls,[]);
 await db.query("UPDATE pulse.creative_jobs SET catalogue_error='timeout at catalogue after 0 ads',insights_error='timeout at insights',error_code='timeout at catalogue after 0 ads'");
 await repairThruPlays(db,reader,account,new Date('2026-10-18T12:00:00Z'));
 assert.deepEqual((await db.query('SELECT error_code,insights_error FROM pulse.creative_jobs')).rows,[{error_code:'timeout at catalogue after 0 ads',insights_error:'timeout at insights'}]);
});
