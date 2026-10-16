import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import test from 'node:test';
import {MetaSpend} from '../src/ad-spend/clients.js';
import {MetaCreativeClient} from '../src/creatives/client.js';
import type {CreativeReader} from '../src/creatives/model.js';
import {aggregateCreativeGroups} from '../src/creatives/ranking.js';
import {readLiveCreativeData,saveCatalogue,saveInsights} from '../src/creatives/store.js';
import {repairThruPlays,thruPlayHealth,thruPlayLine} from '../src/creatives/thruplay-repair.js';
import {defaultSettings} from '../src/settings.js';
import {creativeAd,creativeGroup,creativeInsight} from './helpers/creatives.js';
import {createTestDatabase} from './helpers/database.js';

// These accounts, ads, counts and reports are invented.
test('repair fills an hourly-only row with its matching daily hold denominator',async t=>{
 const db=await createTestDatabase();t.after(()=>db.close());
 const account='invented-daily-denominator',day='2026-10-16',now=new Date(`${day}T12:00:00Z`);
 const settings={...defaultSettings(),metaAdAccountId:account};
 const adId='invented-hourly-ad',groupId='invented-hourly-video';
 await saveCatalogue(db,account,[{ad:creativeAd(adId,groupId,{accountId:account}),media:{...creativeGroup(groupId),thumbnail:null,poster:null,frames:[]}}],now);
 await db.query('INSERT INTO pulse.creative_jobs(account_id) VALUES($1)',[account]);
 const options={sleep:async()=>{},fetch:(async input=>{
  const url=new URL(String(input));
  if(!url.pathname.endsWith('/insights'))return Response.json({currency:'GBP',timezone_name:'GMT'});
  if(url.searchParams.has('breakdowns'))return Response.json({data:[{ad_id:adId,adset_id:'invented-hourly-set',date_start:day,
   hourly_stats_aggregated_by_advertiser_time_zone:'10:00:00 - 10:59:59',spend:'31',impressions:'360',actions:[{action_type:'video_view',value:'120'}]}]});
  if(url.searchParams.get('fields')!.includes('adset_id'))return Response.json({data:[]});
  return Response.json({data:[{ad_id:adId,date_start:day,video_play_actions:[{action_type:'video_view',value:'150'}],
   video_thruplay_watched_actions:[{action_type:'video_view',value:'18'}],actions:[{action_type:'video_view',value:'90'}]}]});
 }) as typeof fetch};
 const reader=new MetaCreativeClient(new MetaSpend(randomBytes(16).toString('hex'),options),options);
 const rows=await reader.readInsights(account,day,day);
 assert.equal(rows[0]!.plays,null);assert.equal(rows[0]!.holdThreeSecondPlays,0);
 await saveInsights(db,account,day,day,rows,now);
 await repairThruPlays(db,reader,account,now);
 const data=await readLiveCreativeData(db,settings);
 assert.equal(data.insights[0]!.spend,31);assert.equal(data.insights[0]!.threeSecondPlays,120);
 assert.equal(data.insights[0]!.holdThreeSecondPlays,90);
 assert.equal(aggregateCreativeGroups(data)[0]!.totals.holdRate,.2,'daily ThruPlays use daily hooks instead of zero or UK-hour hooks');
});

test('a legacy completed empty report reopens and missing fields retry next UK day',async t=>{
 const db=await createTestDatabase();t.after(()=>db.close());
 const account='invented-empty-recovery',day='2026-10-16',now=new Date(`${day}T12:00:00Z`);
 await db.query('INSERT INTO pulse.creative_jobs(account_id,thruplays_backfilled_at) VALUES($1,$2)',[account,now]);
 await saveCatalogue(db,account,[{ad:creativeAd('invented-empty-ad','invented-empty-video',{accountId:account}),
  media:{...creativeGroup('invented-empty-video'),thumbnail:null,poster:null,frames:[]}}],now);
 await saveInsights(db,account,day,day,[creativeInsight('invented-empty-ad',{day,plays:null,thruPlays:null})],now);
 await db.query('INSERT INTO pulse.creative_thruplay_days(account_id,day,completed,fetched_at) VALUES($1,$2,true,$3)',[account,day,new Date(`${day}T12:01:00Z`)]);
 assert.deepEqual(await thruPlayHealth(db,account,now),{completed:0,total:1,failures:[]},'a later read marker cannot certify absent counts');
 let attempts=0;
 const reader:CreativeReader={readCatalogue:async function*(){},readInsights:async()=>[],imageBytes:async()=>new Uint8Array(),videoFrames:async()=>[],videoSource:async()=>'',
  readThruPlays:async()=>{attempts++;return attempts===1?[]:[{adId:'invented-empty-ad',day,plays:160,thruPlays:32}];}};
 await repairThruPlays(db,reader,account,now);
 const pending=await thruPlayHealth(db,account,now);
 assert.deepEqual(pending,{completed:0,total:1,failures:[]});
 assert.match(thruPlayLine(pending),/0 of 1 days complete, 1 day still to read/);
 assert.equal((await db.query('SELECT thruplays_backfilled_at FROM pulse.creative_jobs WHERE account_id=$1',[account])).rows[0]!.thruplays_backfilled_at,null);
 await repairThruPlays(db,reader,account,new Date(`${day}T12:30:00Z`));assert.equal(attempts,1);
 const nextDay=new Date(`${day}T23:01:00Z`);
 await repairThruPlays(db,reader,account,nextDay);assert.equal(attempts,2);
 assert.deepEqual(await thruPlayHealth(db,account,nextDay),{completed:1,total:1,failures:[]});
});
