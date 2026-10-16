import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {creativePerformanceTableHtml} from '../src/creatives/performance-view.js';
import {aggregateCreativeGroups,topCreatives} from '../src/creatives/ranking.js';
import {readLiveCreativeData,saveInsights} from '../src/creatives/store.js';
import {defaultSettings} from '../src/settings.js';
import {creativeAd,creativeData,creativeGroup,creativeInsight} from './helpers/creatives.js';
import {createTestDatabase} from './helpers/database.js';

const videoKeys=['plays','thruPlays','plays25','plays50','plays75','plays100'] as const;

test('migration 037 repairs paid zero video counts without impression or average-time guards',async t=>{
 const db=await createTestDatabase();t.after(()=>db.close());
 const account='invented-zero-repair',now=new Date('2026-10-16T12:00:00Z');
 const zero={plays:0,thruPlays:0,plays25:0,plays50:0,plays75:0,plays100:0};
 const rows=[
  creativeInsight('invented-no-impressions',{...zero,day:'2026-10-12',impressions:0,averagePlayTime:5}),
  creativeInsight('invented-null-completions',{...zero,day:'2026-10-12',plays25:null,plays50:null,plays75:null,plays100:null}),
  creativeInsight('invented-no-spend',{...zero,day:'2026-10-13',spend:0}),
  ...videoKeys.map((key,index)=>creativeInsight(`invented-positive-${index}`,{...zero,day:'2026-10-14',[key]:2})),
 ];
 await saveInsights(db,account,'2026-10-12','2026-10-14',rows,now);
 await db.query(`INSERT INTO pulse.creative_thruplay_days(account_id,day,completed,retry_after,fetched_at)
  SELECT $1,day,true,$2,$2 FROM unnest($3::date[]) day`,[account,now,['2026-10-12','2026-10-13','2026-10-14']]);
 await db.query(await readFile(new URL('../migrations/037_creative_zero_video_counts.sql',import.meta.url),'utf8'));
 const saved=(await readLiveCreativeData(db,{...defaultSettings(),metaAdAccountId:account})).insights;
 for(const id of ['invented-no-impressions','invented-null-completions']){
  assert.deepEqual(videoKeys.map(key=>saved.find(row=>row.adId===id)![key]),Array(6).fill(null));
 }
 assert.equal(saved.find(row=>row.adId==='invented-no-impressions')!.averagePlayTime,5);
 assert.deepEqual(videoKeys.map(key=>saved.find(row=>row.adId==='invented-no-spend')![key]),Array(6).fill(0));
 for(const [index,key] of videoKeys.entries()){
  const row=saved.find(row=>row.adId===`invented-positive-${index}`)!;
  assert.equal(row[key],2);assert.equal(row.plays,key==='plays'?2:0);
 }
 const days=(await db.query('SELECT day::text,completed,retry_after FROM pulse.creative_thruplay_days WHERE account_id=$1 ORDER BY day',[account])).rows;
 assert.deepEqual(days[0],{day:'2026-10-12',completed:false,retry_after:null});
 assert.equal(days[1]!.completed,true);assert.equal(days[2]!.completed,true);
});

test('ranked all-zero video parents show missing distinct spend days and preserve measured zero hold',()=>{
 const today='2026-10-16',data=creativeData(['invented-zero-parent']);
 data.groups.push(creativeGroup('invented-zero-child',{mergedIntoId:'invented-zero-parent'}));
 data.ads.push(creativeAd('invented-zero-child','invented-zero-child'));
 data.insights=[
  creativeInsight('invented-zero-parent',{day:'2026-10-14',plays:0,thruPlays:0}),
  creativeInsight('invented-zero-child',{day:'2026-10-14',plays:0,thruPlays:0}),
  creativeInsight('invented-zero-parent',{day:'2026-10-15',plays:0,thruPlays:0}),
  creativeInsight('invented-zero-parent',{day:today,spend:0,plays:150,thruPlays:0}),
 ];
 const settings={creativeDefaultWindow:'3d' as const,creativeSpendFloorGbp:1,creativePurchaseMinimum:1};
 const group=topCreatives(data,settings,{today}).groups[0]!;
 assert.equal(group.group.kind,'video');assert.equal(group.totals.holdRate,null);
 assert.equal(group.totals.holdMissingPlayDays,2);assert.equal(group.totals.holdSpendDays,2);
 const html=creativePerformanceTableHtml({group,windows:[{window:'3d',totals:group.totals}]} as Parameters<typeof creativePerformanceTableHtml>[0]);
 assert.match(html,/n\/a \(no play data for 2 of 2 days\)/);
 data.insights[0]!.plays=150;
 const measured=aggregateCreativeGroups(data)[0]!;
 assert.equal(measured.totals.holdRate,0);assert.equal(measured.totals.holdMissingPlayDays,0,'positive plays with no ThruPlays remain a measured zero');
 data.insights[0]!.plays=0;data.groups[0]!.kind='image';
 assert.equal(aggregateCreativeGroups(data)[0]!.totals.holdMissingPlayDays,0,'video evidence guard does not change image groups');
});
