import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import test from 'node:test';
import {MetaSpend} from '../src/ad-spend/clients.js';
import {MetaCreativeClient} from '../src/creatives/client.js';
import {CreativeWorker} from '../src/creatives/worker.js';
import {defaultSettings} from '../src/settings.js';
import {createTestDatabase} from './helpers/database.js';
import {saveCatalogue} from '../src/creatives/store.js';
import {creativeAd,creativeGroup} from './helpers/creatives.js';
import type {CatalogueRead,CreativeReader,StoredCatalogueAd} from '../src/creatives/model.js';
const now=new Date('2026-10-16T12:00:00Z');
test('Meta image size and video length survive catalogue storage and become Aspect and Length facts',async t=>{
 const db=await createTestDatabase();t.after(()=>db.close());const account='invented-facts';
 const options={sleep:async()=>{},fetch:(async(url)=>{const u=new URL(String(url)),path=u.pathname.split('/').at(-1)!;
  if(u.hostname!=='graph.facebook.com')return new Response(new Uint8Array([255,216,255]),{headers:{'content-type':'image/jpeg'}});
  if(path===`act_${account}`)return Response.json({currency:'GBP',timezone_name:'GMT'});
  if(path==='ads')return Response.json({data:['image','video','unknown'].map(kind=>({id:`invented-${kind}`,name:`Invented ${kind}`,created_time:now.toISOString(),status:'ACTIVE',effective_status:'ACTIVE',campaign:{id:'invented-campaign',name:'Invented UK'},adset:{id:'invented-set',name:'Invented UK Fern'},creative:{id:`creative-${kind}`,thumbnail_url:'https://media.fbcdn.net/invented.jpg',...(kind==='video'?{video_id:'invented-video-key'}:{image_hash:`invented-${kind}-hash`})}}))});
  if(path==='adimages'){assert.match(u.searchParams.get('fields')!,/width,height/);return Response.json({data:u.searchParams.get('hashes')!.includes('unknown')?[]:[{hash:'invented-image-hash',width:600,height:800,url:'https://media.fbcdn.net/invented.jpg'}]});}
  if(path==='invented-video-key'){assert.ok(u.searchParams.get('fields')!.split(',').includes('length'));assert.ok(!u.searchParams.get('fields')!.split(',').includes('format'));return Response.json({length:16});}
  if(path==='thumbnails'||path==='insights')return Response.json({data:[]});
  return Response.json({});
 }) as typeof fetch};
 const reader=new MetaCreativeClient(new MetaSpend(randomBytes(16).toString('hex'),options),options);
 await db.query('INSERT INTO pulse.creative_jobs(account_id,backfill_done,nightly_day) VALUES($1,true,$2)',[account,'2026-10-16']);
 await new CreativeWorker(db,reader).run(account,{...defaultSettings(),metaAdAccountId:account},now);
 const facts=await db.query<any>('SELECT g.media_key,a.attribute_key,a.value FROM pulse.media_attributes a JOIN pulse.media_groups g ON g.id=a.media_group_id');
 assert.ok(facts.rows.some(r=>r.media_key==='invented-image-hash'&&r.attribute_key==='aspect'&&r.value.value==='portrait'));
 assert.ok(facts.rows.some(r=>r.media_key==='invented-video-key'&&r.attribute_key==='lengthBand'&&r.value.value==='10-20'));
 assert.ok(!facts.rows.some(r=>r.media_key==='invented-unknown-hash'&&r.attribute_key==='aspect'));
 let retry:StoredCatalogueAd[]=[];
 const fake:CreativeReader={readCatalogue:async function*(){yield []},readInsights:async()=>[],imageBytes:async()=>new Uint8Array(),videoFrames:async()=>[],videoSource:async()=>'',rememberDetailRetries:ads=>{retry=ads;}};
 await new CreativeWorker(db,fake).run(account,defaultSettings(),now);
 assert.deepEqual(retry.map(r=>r.id),['invented-unknown']);
});
test('missing-fact retries select at most twenty distinct media groups a pass',async t=>{
 const db=await createTestDatabase();t.after(()=>db.close());const account='invented-bounded-facts';
 const entries:CatalogueRead[]=Array.from({length:25},(_,i)=>({ad:creativeAd(`invented-ad-${i}`,`invented-group-${i}`,{accountId:account}),media:{...creativeGroup(`invented-group-${i}`,{kind:'image',width:null,height:null}),thumbnail:null,poster:null,frames:[]}}));
 await saveCatalogue(db,account,entries,now);let retries:StoredCatalogueAd[]=[];
 const reader:CreativeReader={readCatalogue:async function*(){yield []},readInsights:async()=>[],imageBytes:async()=>new Uint8Array(),videoFrames:async()=>[],videoSource:async()=>'',rememberDetailRetries:rows=>{retries=rows;}};
 await new CreativeWorker(db,reader).run(account,defaultSettings(),now);
 assert.equal(new Set(retries.map(r=>r.mediaGroupId)).size,20);
});
