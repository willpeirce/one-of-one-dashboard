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
 // Only the performance table's documented input fields are used here.
 const sheet={group:aggregateCreativeGroups(data)[0]!,windows:[{window:'lifetime',totals}]} as Parameters<typeof creativePerformanceTableHtml>[0];
 assert.match(creativePerformanceTableHtml(sheet),/n\/a \(no ThruPlay data\)/);
 assert.equal(creativeTotals([creativeInsight('invented-zero',{thruPlays:0,holdThreeSecondPlays:100})]).holdRate,0,'measured zero remains zero');
});

test('next daily pass re-reads fourteen historical days once, repairs old nulls and retries a failed repair',async t=>{
 const {CreativeWorker}=await import('../src/creatives/worker.js');
 const {creativeInsight}=await import('./helpers/creatives.js');
 const {AdError}=await import('../src/ad-spend/model.js');
 const db=await createTestDatabase();t.after(()=>db.close());const account='invented-hold-backfill',now=new Date('2026-10-16T12:00:00Z'),day='2026-10-05';
 await db.query('INSERT INTO pulse.creative_jobs(account_id,backfill_done,nightly_day) VALUES($1,true,$2)',[account,'2026-10-16']);
 await saveInsights(db,account,day,day,[creativeInsight('invented-repair-video',{day,thruPlays:null})],now);
 const ranges:string[][]=[];let fail=true;
 const reader:import('../src/creatives/model.js').CreativeReader={readCatalogue:async function*(){yield []},imageBytes:async()=>new Uint8Array(),videoSource:async()=>'',videoFrames:async()=>[],readInsights:async(_,from,to)=>{
  ranges.push([from,to]);if(from==='2026-10-09'&&fail)throw new AdError('timeout');
  return from<=day&&to>=day?[creativeInsight('invented-repair-video',{day,thruPlays:40,holdThreeSecondPlays:100})]:[];
 }};
 const worker=new CreativeWorker(db,reader);
 await worker.runInsights(account,defaultSettings(),now);
 assert.equal((await db.query<any>('SELECT thruplays_backfilled_at FROM pulse.creative_jobs')).rows[0].thruplays_backfilled_at,null);
 fail=false;await worker.runInsights(account,defaultSettings(),now);
 const stored=await readLiveCreativeData(db,{...defaultSettings(),metaAdAccountId:account});assert.equal(stored.insights[0]!.thruPlays,40);
 assert.ok((await db.query<any>('SELECT thruplays_backfilled_at FROM pulse.creative_jobs')).rows[0].thruplays_backfilled_at);
 assert.deepEqual(ranges.slice(-3),[['2026-10-15','2026-10-16'],['2026-10-02','2026-10-08'],['2026-10-09','2026-10-15']]);
 ranges.length=0;await worker.runInsights(account,defaultSettings(),now);assert.deepEqual(ranges,[['2026-10-15','2026-10-16']]);
 assert.equal(Number((await db.query<any>('SELECT count(*) FROM pulse.creative_insight_days WHERE completed')).rows[0].count),15);
});
