import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {MetaSpend} from '../src/ad-spend/clients.js';
import {MetaCreativeClient} from '../src/creatives/client.js';
import type {CreativeReader} from '../src/creatives/model.js';
import {aggregateCreativeGroups,creativeTotals} from '../src/creatives/ranking.js';
import {creativePerformanceTableHtml} from '../src/creatives/performance-view.js';
import {readLiveCreativeData,saveCatalogue,saveInsights} from '../src/creatives/store.js';
import {repairThruPlays,thruPlayHealth,thruPlayLine} from '../src/creatives/thruplay-repair.js';
import {defaultSettings} from '../src/settings.js';
import {creativeAd,creativeGroup,creativeInsight} from './helpers/creatives.js';
import {createTestDatabase} from './helpers/database.js';

const now=new Date('2026-10-16T12:00:00Z'),day='2026-10-15';
const videoKeys=['plays','thruPlays','plays25','plays50','plays75','plays100'] as const;

test('absent daily and hourly video fields persist as null while explicit empty counts remain zero',async t=>{
 const db=await createTestDatabase();t.after(()=>db.close());const account='invented-null-video';
 const ids=['invented-daily-missing','invented-hourly-only','invented-measured-zero'];
 const options={sleep:async()=>{},fetch:(async input=>{
  const url=new URL(String(input));if(!url.pathname.endsWith('/insights'))return Response.json({currency:'GBP',timezone_name:'GMT'});
  const base={adset_id:'invented-video-set',date_start:day};
  if(url.searchParams.has('breakdowns'))return Response.json({data:ids.map(ad_id=>({...base,ad_id,spend:'42',impressions:'800',hourly_stats_aggregated_by_advertiser_time_zone:'10:00:00 - 10:59:59',actions:[{action_type:'video_view',value:'100'}],video_play_actions:[{action_type:'video_view',value:'999'}]}))});
  return Response.json({data:[{...base,ad_id:ids[0]},{...base,ad_id:ids[2],video_play_actions:[],video_thruplay_watched_actions:[],video_p25_watched_actions:[],video_p50_watched_actions:[],video_p75_watched_actions:[],video_p100_watched_actions:[]}]});
 }) as typeof fetch};
 const client=new MetaCreativeClient(new MetaSpend(randomBytes(16).toString('hex'),options),options);
 const rows=await client.readInsights(account,day,day);
 await saveInsights(db,account,day,day,rows,now);
 const stored=await readLiveCreativeData(db,{...defaultSettings(),metaAdAccountId:account});
 for(const id of ids){const row=stored.insights.find(r=>r.adId===id)!;
  assert.equal(row.spend,42);assert.deepEqual(videoKeys.map(key=>row[key]),Array(6).fill(id===ids[2]?0:null));
 }
});

test('migration 035 repairs paid all-zero legacy video rows and preserves zero-spend or measured rows',async t=>{
 const db=await createTestDatabase();t.after(()=>db.close());const account='invented-video-migration';
 const zero={day,plays:0,thruPlays:0,plays25:0,plays50:0,plays75:0,plays100:0,averagePlayTime:0};
 await saveInsights(db,account,day,day,[
  creativeInsight('invented-legacy',zero),creativeInsight('invented-free',{...zero,spend:0}),
  creativeInsight('invented-measured',{...zero,plays:9,thruPlays:2}),
  creativeInsight('invented-completion',{...zero,plays25:1}),creativeInsight('invented-no-impressions',{...zero,impressions:0}),
 ],now);
 await db.query('INSERT INTO pulse.creative_thruplay_days(account_id,day,completed,fetched_at) VALUES($1,$2,true,$3)',[account,day,now]);
 await db.query(await readFile(new URL('../migrations/035_nullable_video_counts.sql',import.meta.url),'utf8'));
 const rows=(await readLiveCreativeData(db,{...defaultSettings(),metaAdAccountId:account})).insights;
 assert.deepEqual(videoKeys.map(key=>rows.find(r=>r.adId==='invented-legacy')![key]),Array(6).fill(null));
 for(const id of ['invented-free','invented-no-impressions','invented-completion'])assert.equal(rows.find(r=>r.adId===id)!.plays,0);
 assert.equal(rows.find(r=>r.adId==='invented-measured')!.plays,9);
 assert.equal(rows.find(r=>r.adId==='invented-measured')!.thruPlays,2);
 assert.equal((await db.query('SELECT completed FROM pulse.creative_thruplay_days')).rows[0]!.completed,false);
});

test('hold waits for every spend day and repair follows scored video windows, merged ads and new imports',async t=>{
 const db=await createTestDatabase();t.after(()=>db.close());const account='invented-window-repair';
 const settings={...defaultSettings(),metaAdAccountId:account};
 const old='2026-09-10';
 const entries=['parent','child','image'].map(label=>({ad:creativeAd(`invented-${label}`,`invented-${label}-group`,{accountId:account}),media:{...creativeGroup(`invented-${label}-group`,{kind:label==='image'?'image' as const:'video' as const}),thumbnail:null,poster:null,frames:[]}}));
 await saveCatalogue(db,account,entries,now);
 await db.query("UPDATE pulse.media_groups SET merged_into_id='invented-parent-group' WHERE id='invented-child-group'");
 const rows=[creativeInsight('invented-parent',{day:old,plays:null,thruPlays:null,holdThreeSecondPlays:100}),
  creativeInsight('invented-parent',{day,plays:null,thruPlays:null,holdThreeSecondPlays:100}),
  creativeInsight('invented-child',{day,plays:null,thruPlays:null,holdThreeSecondPlays:100}),
  creativeInsight('invented-parent',{day:'2026-10-14',spend:0,plays:null,thruPlays:null}),
  creativeInsight('invented-image',{day:'2026-10-13',plays:null,thruPlays:null})];
 await saveInsights(db,account,old,day,rows,now);
 await db.query('INSERT INTO pulse.creative_jobs(account_id,backfill_done) VALUES($1,true)',[account]);
 const group=async()=>aggregateCreativeGroups(await readLiveCreativeData(db,settings)).find(g=>g.group.id==='invented-parent-group')!;
 const html=async()=>{const g=await group();return creativePerformanceTableHtml({group:g,windows:[{window:'lifetime',totals:g.totals}]} as Parameters<typeof creativePerformanceTableHtml>[0]);};
 assert.equal((await group()).totals.holdRate,null);assert.match(await html(),/n\/a \(no play data for 2 of 2 days\)/);
 const calls:string[][]=[];
 const reader:CreativeReader={readCatalogue:async function*(){yield []},readInsights:async()=>[],imageBytes:async()=>new Uint8Array(),videoFrames:async()=>[],videoSource:async()=>'',readThruPlays:async(_,from,to)=>{
  calls.push([from,to]);return rows.filter(r=>r.spend>0&&r.day>=from&&r.day<=to).map(r=>({adId:r.adId,day:r.day,plays:150,thruPlays:30}));
 }};
 await repairThruPlays(db,reader,account,now,'7d');assert.deepEqual(calls,[[day,day]]);
 assert.match(await html(),/n\/a \(no play data for 1 of 2 days\)/);
 assert.match(thruPlayLine(await thruPlayHealth(db,account,now,'lifetime')),/1 of 2 days complete; 1 day wait for the next run/);
 await repairThruPlays(db,reader,account,now,'lifetime');assert.deepEqual(calls,[[day,day],[old,old]]);
 assert.equal((await group()).totals.holdRate,.3);assert.match(await html(),/30\.0%/);assert.doesNotMatch(await html(),/no play data/);
 assert.deepEqual(await thruPlayHealth(db,account,now,'lifetime'),{completed:2,total:2,givenUp:0,waiting:[],failures:[],lastRunAt:now.toISOString(),lastRunReport:{tried:1,filled:1,refused:0,waiting:0,codes:[]}});
 await repairThruPlays(db,reader,account,now,'lifetime');assert.equal(calls.length,2,'completed days resume without rereads');
 const later=new Date(now.getTime()+1800000);
 await saveInsights(db,account,day,day,rows.filter(r=>r.day===day),later);
 assert.equal((await thruPlayHealth(db,account,later,'lifetime')).completed,1);
 await repairThruPlays(db,reader,account,later,'lifetime');assert.deepEqual(calls.at(-1),[day,day]);assert.equal(calls.length,3);
 assert.equal((await group()).totals.holdRate,.3);
 assert.equal(creativeTotals([creativeInsight('invented-zero-spend',{spend:0,plays:null})]).holdMissingPlayDays,0);
 const paired=creativeTotals([
  creativeInsight('invented-counted',{plays:150,thruPlays:20,holdThreeSecondPlays:100}),
  creativeInsight('invented-zero-spend',{spend:0,plays:null,thruPlays:10,holdThreeSecondPlays:50}),
 ]);
 assert.equal(paired.holdRate,.2,'every counted ThruPlay retains its matching denominator');
});
