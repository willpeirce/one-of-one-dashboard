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
 assert.deepEqual(retry,[],'missing facts no longer force creative expansion');
});
test('missing-fact retries select at most twenty distinct media groups a pass',async t=>{
 const db=await createTestDatabase();t.after(()=>db.close());const account='invented-bounded-facts';
 const entries:CatalogueRead[]=Array.from({length:25},(_,i)=>({ad:creativeAd(`invented-ad-${i}`,`invented-group-${i}`,{accountId:account}),media:{...creativeGroup(`invented-group-${i}`,{kind:'image',width:null,height:null}),thumbnail:null,poster:null,frames:[]}}));
 await saveCatalogue(db,account,entries,now);let reads=0;
 const reader:CreativeReader={readCatalogue:async function*(){yield []},readInsights:async()=>[],imageBytes:async()=>new Uint8Array(),videoFrames:async()=>[],videoSource:async()=>'',readMediaFacts:async()=>{reads++;return {width:600,height:800,lengthSeconds:null};}};
 await new CreativeWorker(db,reader).run(account,defaultSettings(),now);
 assert.equal(reads,20);
});

test('facts recover without creative or thumbnail reads, report failures, retry daily and retain unavailable results',async t=>{
 const {mediaFactHealth,mediaFactLine}=await import('../src/creatives/media-facts.js');
 const {readGroupAttributes}=await import('../src/creatives/attribute-store.js');
 const {creativeHealth}=await import('../src/creatives/store.js');
 const {creativeHealthDetails}=await import('../src/views.js');
 const db=await createTestDatabase();t.after(()=>db.close());const account='invented-fact-recovery';
 const entries:CatalogueRead[]=['filled','unavailable','failed'].map(label=>({ad:creativeAd(`invented-${label}`,`group-${label}`,{accountId:account}),media:{...creativeGroup(`group-${label}`,{key:`hash-${label}`,kind:'image',width:null,height:null}),thumbnail:null,poster:null,frames:[]}}));
 await saveCatalogue(db,account,entries,now);
 const calls:string[]=[],logs:string[]=[];let failing=true;
 t.mock.method(console,'info',(line:string)=>logs.push(line));
 const client=new MetaCreativeClient(new MetaSpend(randomBytes(16).toString('hex'),{sleep:async()=>{},fetch:async input=>{
  const url=new URL(String(input));calls.push(url.pathname);
  if(url.pathname.endsWith(`/act_${account}`))return Response.json({currency:'GBP',timezone_name:'Europe/London'});
  if(url.pathname.endsWith('/ads'))return Response.json({data:[]});
  assert.ok(url.pathname.endsWith('/adimages'),'facts bypass creative expansion, post, thumbnail and media download');
  const key=JSON.parse(url.searchParams.get('hashes')!)[0];
  if(key==='hash-failed'&&failing)return Response.json({error:{code:100}},{status:400});
  return Response.json({data:key==='hash-unavailable'?[]:[{hash:key,width:600,height:800}]});
 }}));
 const settings={...defaultSettings(),metaAdAccountId:account};
 await new CreativeWorker(db,client).run(account,settings,now,false);
 const report=await mediaFactHealth(db,account);
 assert.equal(report.filled,1);assert.equal(report.total,3);assert.ok(report.reasons.some(r=>r.reason==='unavailable'&&r.count===1));assert.ok(report.reasons.some(r=>r.reason.includes('http 400')&&r.count===1));
 assert.ok(logs.includes(mediaFactLine(report)));
 const health=await creativeHealth(db,settings,{META_ACCESS_TOKEN:randomBytes(16).toString('hex')},now);
 assert.ok(creativeHealthDetails(health).includes(mediaFactLine(report)));
 assert.equal((await readGroupAttributes(db,'live',account,'group-unavailable')).find(r=>r.key==='aspect')!.valueLabel,'n/a');
 const requests=calls.length;await new CreativeWorker(db,client).run(account,settings,new Date('2026-10-16T12:30:00Z'),false);
 assert.equal(calls.length-requests,1,'only the list (account cached), no same-day fact retry');
 failing=false;await new CreativeWorker(db,client).run(account,settings,new Date('2026-10-16T23:01:00Z'),false);
 assert.equal((await mediaFactHealth(db,account)).filled,2,'retry at the next UK midnight');
 assert.equal((await db.query<any>("SELECT size_unavailable FROM pulse.media_groups WHERE id='group-unavailable'")).rows[0].size_unavailable,true);
});

test('video fact recovery reads length and sized thumbnails, retaining metadata rate-limit backoff',async()=>{
 const calls:string[]=[],waits:number[]=[];let limited=true;
 const client=new MetaCreativeClient(new MetaSpend(randomBytes(16).toString('hex'),{sleep:async ms=>{waits.push(ms);},fetch:async input=>{
  const url=new URL(String(input));calls.push(url.pathname);
  if(limited){limited=false;return Response.json({error:{code:80004}},{status:400});}
  return Response.json(url.pathname.endsWith('/thumbnails')?{data:[{width:600,height:800,is_preferred:true}]}:{length:18});
 }}));
 const facts=await client.readMediaFacts('invented-account',{kind:'video',key:'invented-video',width:null,height:null,lengthSeconds:null});
 assert.deepEqual(facts,{width:600,height:800,lengthSeconds:18});assert.ok(waits.some(ms=>ms>=15*60000));assert.equal(calls.length,3);
});
