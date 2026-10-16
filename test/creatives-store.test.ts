import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { createTestDatabase } from './helpers/database.js';
import { defaultSettings } from '../src/settings.js';
import type { AdInsight, CatalogueEntry, CreativeReader } from '../src/creatives/model.js';
import { canonicalVideoTitle } from '../src/creatives/model.js';
import { creativeHealth, enforceMediaCap, ensureGroupMedia, mediaBytesUsed, mergeMediaGroups, readCreativeData, readMedia, reconciliationLine, saveCatalogue, saveInsights, splitMediaGroup, undoMediaMerge } from '../src/creatives/store.js';
import { CreativeWorker } from '../src/creatives/worker.js';
import { saveSpend } from '../src/ad-spend/store.js';
import { SpendWorker } from '../src/ad-spend/worker.js';
import { syncSourceHealth } from '../src/sources.js';
const account = 'invented-account';
const now = new Date('2026-10-13T12:00:00Z');
const settings = () => ({ ...defaultSettings(), metaAdAccountId:account });
function entry(id = 'invented-video', title = 'Invented unboxing', length = 18): CatalogueEntry {
  return { ad: { id:`ad-${id}`,accountId:account,name:`Invented ad ${id}`,status:'ACTIVE',effectiveStatus:'ACTIVE',createdAt:now.toISOString(),adSetId:'invented-set',adSetName:'Invented set — UK — Discovery',campaignId:'invented-campaign',campaignName:'Invented campaign',owner:'ours',market:'uk',creativeId:`creative-${id}`,creativeType:'video',body:'Invented ad copy',title,callToAction:'SHOP_NOW',linkUrl:null,utmContent:null,lastSeen:now.toISOString(),facebookUrl:null,instagramUrl:null,objectStoryId:null,instagramMediaId:null }, media:{id,kind:'video',key:id,title,lengthSeconds:length,width:600,height:600,firstSeen:now.toISOString(),alternates:[],thumbnail:new Uint8Array([1,2,3]),poster:null,frames:[]} };
}
function insight(adId:string,day='2026-10-12',spend=100): AdInsight {
  return {adId,adSetId:'invented-set',day,spend,impressions:1000,reach:300,frequency:3.333,linkClicks:50,threeSecondPlays:200,threeSecondSource:'video_view',plays:500,thruPlays:80,plays25:180,plays50:100,plays75:60,plays100:40,averagePlayTime:8,addsToCart:20,purchases:7,purchaseValue:350};
}
const reader = (readInsights:CreativeReader['readInsights']): CreativeReader => ({ readCatalogue:async function*(){yield [];},readInsights,videoSource:async()=>{throw new Error('unused');},imageBytes:async()=>new Uint8Array(),videoFrames:async()=>[] });

test('Auto_Cropped titles and durations merge once; a manual split survives refresh and supports audited undo', async()=>{
  const db=await createTestDatabase();
  try {
    assert.equal(canonicalVideoTitle('Auto_Cropped_AR_4_X_5_DCO_Invented unboxing'),'invented unboxing');
    await saveCatalogue(db,account,[entry(),entry('invented-crop','Auto_Cropped_AR_4_X_5_DCO_Invented unboxing',19),entry('invented-page','Invented page copy',18.09)],now);
    let rows=(await db.query<any>('SELECT id,merged_into_id FROM pulse.media_groups ORDER BY id')).rows;
    assert.equal(rows.find(r=>r.id==='invented-crop')!.merged_into_id,'invented-video');
    assert.equal(rows.find(r=>r.id==='invented-page')!.merged_into_id,'invented-video');
    const split=await splitMediaGroup(db,account,'invented-crop','invented-device',new Date(now.getTime()+1000));
    await saveCatalogue(db,account,[entry('invented-crop','Auto_Cropped_AR_4_X_5_DCO_Invented unboxing',19)],now);
    rows=(await db.query<any>('SELECT id,merged_into_id FROM pulse.media_groups ORDER BY id')).rows;
    assert.equal(rows.find(r=>r.id==='invented-crop')!.merged_into_id,null);
    await undoMediaMerge(db,account,split,'invented-device',new Date(now.getTime()+2000));
    const audit=(await db.query<any>('SELECT who,undone_at,undone_by FROM pulse.media_merges WHERE id=$1',[split])).rows[0];
    assert.equal(audit.who,'invented-device'); assert.ok(audit.undone_at); assert.equal(audit.undone_by,'invented-device');
    await assert.rejects(mergeMediaGroups(db,account,'invented-video','invented-crop','invented-device'));
    await assert.rejects(splitMediaGroup(db,'wrong-account','invented-crop','invented-device'));
    // Identity order, rather than random audit IDs, disambiguates same-clock taps.
    await splitMediaGroup(db,account,'invented-crop','invented-device',now);
    const sameClock = await mergeMediaGroups(db,account,'invented-crop','invented-video','invented-device',now);
    await undoMediaMerge(db,account,sameClock,'invented-device',now);
    assert.equal((await db.query<any>('SELECT merged_into_id FROM pulse.media_groups WHERE id=$1',['invented-crop'])).rows[0]!.merged_into_id,null);
  } finally {await db.close();}
});

test('ad insight chunks replace atomically, preserve first-spend day and compare only days covered at both levels',async()=>{
  const db=await createTestDatabase();
  const env={META_ACCESS_TOKEN:randomBytes(16).toString('hex')};
  try {
    await saveCatalogue(db,account,[entry()],now);
    await saveInsights(db,account,'2026-10-12','2026-10-12',[insight('ad-invented-video','2026-10-12',101.5)],now);
    const spendRow={source:'meta' as const,accountId:account,campaignId:'invented-campaign',campaignName:'Invented campaign',adSetId:'invented-set',adSetName:'Invented UK set',market:'uk' as const,owner:'ours' as const,day:'2026-10-12',amount:'100',currency:'GBP'};
    await saveSpend(db,'meta',account,'2026-10-12','2026-10-12',[spendRow],now);
    let health=await creativeHealth(db,settings(),env,now);
    assert.equal(health.reconciliation,'Meta ad-level spend differs from ad set spend by 1.5% on 1 day');
    await saveInsights(db,account,'2026-10-12','2026-10-12',[insight('ad-invented-video','2026-10-12',100.5)],now);
    health=await creativeHealth(db,settings(),env,now); assert.equal(health.reconciliation,null);
    await saveSpend(db,'meta',account,'2026-10-11','2026-10-11',[{...spendRow,day:'2026-10-11'}],now);
    assert.equal((await creativeHealth(db,settings(),env,now)).reconciliation,'ad-level read incomplete on 1 day','unfinished ad history is named without a fabricated percentage');
    const data=await readCreativeData(db,settings(),env,now);
    assert.equal(data.insights.length,1); assert.equal(data.insights[0]!.spend,100.5);
    assert.equal(data.ads[0]!.firstSpendDay,'2026-10-12');
    await assert.rejects(saveInsights(db,account,'2026-10-12','2026-10-12',[insight('ad-invented-video','2026-10-10',99)],now));
    assert.equal((await readCreativeData(db,settings(),env,now)).insights[0]!.spend,100.5);
    assert.equal(reconciliationLine([{day:'2026-10-11',percent:0.5}]),null);
    assert.match(reconciliationLine([{day:'2026-10-11',percent:1.5}])!,/1.5%/);
  } finally {await db.close();}
});

test('seven-day backfill checkpoints resume after failure; daily and nightly windows are bounded and error logs redact unknown failures',async()=>{
  const db=await createTestDatabase();
  const reads:string[][]=[], logs:string[]=[];
  const token=randomBytes(16).toString('hex');
  const original=console.error;console.error=(...args)=>logs.push(args.join(' '));
  try {
    let fail=true;
    const source=reader(async(_account,from,to)=>{reads.push([from,to]); if(from==='2026-08-14'&&fail)throw new Error(token); return [];});
    const worker=new CreativeWorker(db,source);
    await worker.run(account,settings(),now);
    assert.deepEqual(reads,[['2026-10-12','2026-10-13'],['2026-10-06','2026-10-12'],['2026-08-07','2026-08-13'],['2026-08-14','2026-08-20']]);
    assert.equal((await db.query<any>('SELECT backfill_next::text FROM pulse.creative_jobs')).rows[0]!.backfill_next,'2026-08-14');
    assert.equal((await db.query('SELECT error_code FROM pulse.creative_jobs')).rows[0]!.error_code,'unknown at backfill');
    assert.equal(JSON.stringify(logs).includes(token),false);
    reads.length=0;fail=false;
    await worker.run(account,settings(),new Date(now.getTime()+1800000));
    assert.deepEqual(reads[0],['2026-10-12','2026-10-13']);
    assert.deepEqual(reads[1],['2026-08-14','2026-08-20']);
    assert.equal(reads.some(([from])=>from==='2026-08-07'),false);
    assert.equal(reads.some(([from])=>from==='2026-10-06'),false,'nightly runs once per UK day');
    assert.equal((await db.query<any>('SELECT backfill_next::text FROM pulse.creative_jobs')).rows[0]!.backfill_next,'2026-09-11');
    assert.deepEqual((await db.query('SELECT error_code,insights_error FROM pulse.creative_jobs')).rows,[{error_code:null,insights_error:null}]);
  } finally {console.error=original;await db.close();}
});

test('media cap evicts least recently opened frames before images and scoped media reads serve saved bytes',async()=>{
  const db=await createTestDatabase();
  try {
    const first=entry(), second=entry('invented-other','Invented other',30);
    first.media.frames=[new Uint8Array(40)];second.media.frames=[new Uint8Array(40)];
    await saveCatalogue(db,account,[first,second],now);
    const read=await readMedia(db,account,'invented-other');assert.deepEqual([...read!.bytes],[1,2,3]);
    assert.equal(await readMedia(db,'another-account','invented-other'),null);
    await enforceMediaCap(db,account,50/(1024*1024));
    const frames=(await db.query<any>('SELECT id,cardinality(frames) AS count FROM pulse.media_groups ORDER BY id')).rows;
    assert.equal(frames.find(r=>r.id==='invented-video')!.count,0);
    assert.equal(frames.find(r=>r.id==='invented-other')!.count,1);
    assert.equal(await mediaBytesUsed(db,account),46);
    assert.deepEqual([...(await readMedia(db,account,'invented-video'))!.bytes],[1,2,3]);
  } finally {await db.close();}
});


test('evicted SHARE thumbnails refill through the creative ID and optional frame refusals preserve cached pictures',async()=>{
  const db=await createTestDatabase();
  try {
    const share=entry('invented-share','Invented shared post');
    share.media.kind='image';share.media.key='post:invented-post';share.ad.creativeType='image';
    await saveCatalogue(db,account,[share,entry()],now);
    await db.query('UPDATE pulse.media_groups SET thumbnail=NULL WHERE id=$1',['invented-share']);
    const calls:string[]=[];
    const source=reader(async()=>[]);
    source.imageBytes=async(_account,key)=>{calls.push(key);if(key.startsWith('post:'))throw new Error('refused');return new Uint8Array([0xff,0xd8,1,2]);};
    source.videoFrames=async()=>{throw new Error('refused');};
    const media=await ensureGroupMedia(source,db,account,'invented-share',300);
    assert.deepEqual(calls,['post:invented-post','creative:creative-invented-share']);
    assert.deepEqual([...media!.bytes],[0xff,0xd8,1,2]);
    const cached=await ensureGroupMedia(source,db,account,'invented-video',300);
    assert.deepEqual([...cached!.bytes],[1,2,3]);
  } finally {await db.close();}
});


test('the spend worker refreshes creative status on its existing 30-minute schedule and supplies durable stored media keys',async()=>{
  const db=await createTestDatabase();
  const env={META_ACCESS_TOKEN:randomBytes(16).toString('hex')};
  let clock=now, reads=0;
  const known:string[][]=[];
  try {
    await syncSourceHealth(db,env);
    await db.query('INSERT INTO pulse.settings(values) VALUES($1)',[JSON.stringify({...defaultSettings(),metaAdAccountId:'900000000999'})]);
    const source=reader(async()=>[]);
    source.rememberStoredMedia=keys=>known.push(keys);
    source.readCatalogue=async function*(){reads++;const row=entry();row.ad.effectiveStatus=reads===1?'ACTIVE':'PAUSED';yield [row];};
    const worker=new SpendWorker(db,env,{clock:()=>clock,readers:{meta:{read:async()=>[]}},creativeReader:source});
    await worker.tick('meta');await worker.waitForCreatives();assert.equal(reads,1);assert.deepEqual(known,[[]]);
    clock=new Date(now.getTime()+60_000);await worker.tick('meta');assert.equal(reads,1);
    clock=new Date(now.getTime()+30*60_000);await worker.tick('meta');await worker.waitForCreatives();assert.equal(reads,2);
    assert.deepEqual(known[1],['video:invented-video']);
    assert.equal((await db.query<any>('SELECT effective_status FROM pulse.ads')).rows[0]!.effective_status,'PAUSED');
    assert.equal((await db.query<any>("SELECT status FROM pulse.source_health WHERE source='meta'")).rows[0]!.status,'healthy');
    await worker.stop();
  } finally {await db.close();}
});
