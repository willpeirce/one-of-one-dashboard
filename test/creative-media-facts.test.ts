import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import test from 'node:test';
import {MetaSpend} from '../src/ad-spend/clients.js';
import {MetaCreativeClient} from '../src/creatives/client.js';
import {CreativeWorker} from '../src/creatives/worker.js';
import {defaultSettings} from '../src/settings.js';
import {createTestDatabase} from './helpers/database.js';
import {saveCatalogue,saveInsights} from '../src/creatives/store.js';
import {creativeAd,creativeGroup,creativeInsight} from './helpers/creatives.js';
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
test('media facts try forty groups, scored parents first by spend, and persist the run report',async t=>{
 const {refreshMediaFacts,mediaFactHealth,mediaFactLine}=await import('../src/creatives/media-facts.js');
 const db=await createTestDatabase();t.after(()=>db.close());const account='invented-bounded-facts';
 const entries:CatalogueRead[]=Array.from({length:60},(_,i)=>({ad:creativeAd(`invented-ad-${i}`,`invented-group-${i}`,{accountId:account}),media:{...creativeGroup(`invented-group-${i}`,{key:`invented-key-${i}`,kind:'image',width:null,height:null}),thumbnail:null,poster:null,frames:[]}}));
 await saveCatalogue(db,account,entries,now);
 await saveInsights(db,account,'2026-10-16','2026-10-16',[57,58,59].map((i,n)=>creativeInsight(`invented-ad-${i}`,{day:'2026-10-16',spend:[48,72,24][n]!})),now);
 await db.query('INSERT INTO pulse.creative_jobs(account_id) VALUES($1)',[account]);
 const reads:string[]=[],logs:string[]=[];t.mock.method(console,'info',(line:string)=>logs.push(line));
 const reader:CreativeReader={readCatalogue:async function*(){yield []},readInsights:async()=>[],imageBytes:async()=>new Uint8Array(),videoFrames:async()=>[],videoSource:async()=>'',readMediaFacts:async(_account,group)=>{
  reads.push(group.key);const refused=['invented-key-58','invented-key-59'].includes(group.key),missing=group.key==='invented-key-59';
  return {width:missing?null:600,height:missing?null:800,lengthSeconds:null,...(refused?{failures:['http 400, meta 10 at adimages']}:{})};
 }};
 await refreshMediaFacts(db,reader,account,now);
 assert.equal(reads.length,40);assert.equal(new Set(reads).size,40);
 assert.deepEqual(reads.slice(0,3),['invented-key-58','invented-key-57','invented-key-59']);
 const report=await mediaFactHealth(db,account,now);
 assert.deepEqual(report.run,{tried:40,filled:39,refused:2,reasons:[{reason:'http 400, meta 10 at adimages',count:2}]});
 assert.equal(report.filled,2);assert.equal(report.total,3);
 assert.match(mediaFactLine(report),/last run 2026-10-16T12:00:00.000Z: 40 tried, 39 filled, 2 refused \(http 400, meta 10 at adimages on 2\)/);
 assert.deepEqual(logs,[mediaFactLine(report)]);
 assert.equal((await mediaFactHealth(db,account,now,'lifetime')).total,3);
});

test('facts retry once daily, stop after three failures, and count only scored parents in the window',async t=>{
 const {refreshMediaFacts,mediaFactHealth,mediaFactLine}=await import('../src/creatives/media-facts.js');
 const {readGroupAttributes}=await import('../src/creatives/attribute-store.js');
 const {AdError}=await import('../src/ad-spend/model.js');
 const db=await createTestDatabase();t.after(()=>db.close());const account='invented-fact-recovery';
 const entries:CatalogueRead[]=['filled','missing','failed','old','merged'].map(label=>({ad:creativeAd(`invented-${label}`,`group-${label}`,{accountId:account}),media:{...creativeGroup(`group-${label}`,{key:`hash-${label}`,kind:'image',width:null,height:null}),thumbnail:null,poster:null,frames:[]}}));
 await saveCatalogue(db,account,entries,now);
 await saveInsights(db,account,'2026-10-01','2026-10-16',entries.map((r,i)=>creativeInsight(r.ad.id,{day:i===3?'2026-10-01':'2026-10-16'})),now);
 await db.query("UPDATE pulse.media_groups SET merged_into_id='group-filled' WHERE id='group-merged'");
 await db.query('INSERT INTO pulse.creative_jobs(account_id) VALUES($1)',[account]);
 const calls:string[]=[],logs:string[]=[];t.mock.method(console,'info',(line:string)=>logs.push(line));
 const reader:CreativeReader={readCatalogue:async function*(){yield []},readInsights:async()=>[],imageBytes:async()=>new Uint8Array(),videoFrames:async()=>[],videoSource:async()=>'',readMediaFacts:async(_account,group)=>{
  calls.push(group.key);if(group.key==='hash-failed')throw new AdError('http',400,10);
  return group.key==='hash-missing'?{width:null,height:null,lengthSeconds:null}:{width:600,height:800,lengthSeconds:null};
 }};
 await refreshMediaFacts(db,reader,account,now);
 const report=await mediaFactHealth(db,account,now);assert.equal(report.filled,1);assert.equal(report.total,3);assert.ok(report.reasons.some(r=>r.reason.includes('meta 10')));
 assert.ok(logs.includes(mediaFactLine(report)));assert.match(mediaFactLine(report),/scored groups filled.*whole account/);
 const requests=calls.length;await refreshMediaFacts(db,reader,account,new Date('2026-10-16T12:30:00Z'));assert.equal(calls.length,requests);
 for(const day of [17,18])await refreshMediaFacts(db,reader,account,new Date(`2026-10-${day}T12:00:00Z`));
 for(const key of ['missing','failed']){
  assert.equal(calls.filter(c=>c===`hash-${key}`).length,3);
  assert.equal((await readGroupAttributes(db,'live',account,`group-${key}`)).find(r=>r.key==='aspect')!.valueLabel,'n/a');
 }
 const end=calls.length;await refreshMediaFacts(db,reader,account,new Date('2026-10-19T12:00:00Z'));assert.equal(calls.length,end);
 assert.ok((await mediaFactHealth(db,account,now)).reasons.some(r=>r.reason==='unavailable'&&r.count===2));
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


test('permission-refused direct reads recover through creatives, image bytes and the account video edge',async t=>{
 const {refreshMediaFacts}=await import('../src/creatives/media-facts.js');
 const db=await createTestDatabase();t.after(()=>db.close());const account='invented-fallback-account';
 const png=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.write('IHDR',12);png.writeUInt32BE(640,16);png.writeUInt32BE(960,20);
 const entries:CatalogueRead[]=['image','video'].map(kind=>({ad:creativeAd(`invented-${kind}`,`group-${kind}`,{accountId:account,creativeId:`creative-${kind}`}),media:{...creativeGroup(`group-${kind}`,{key:`key-${kind}`,kind:kind as 'image'|'video',width:null,height:null,lengthSeconds:null}),thumbnail:null,poster:null,frames:[]}}));
 await saveCatalogue(db,account,entries,now);await db.query('INSERT INTO pulse.creative_jobs(account_id) VALUES($1)',[account]);
 const paths:string[]=[];
 const options={sleep:async()=>{},fetch:(async input=>{
  const url=new URL(String(input)),path=url.pathname.split('/').at(-1)!;paths.push(path);
  if(url.hostname==='media.fbcdn.net')return new Response(png,{headers:{'content-type':'image/png'}});
  if(['adimages','key-video','thumbnails'].includes(path))return Response.json({error:{code:10,message:'Invented permission refusal'}},{status:400});
  if(path==='creative-image')return Response.json({image_hash:'key-image',image_url:'https://media.fbcdn.net/invented.png'});
  if(path==='creative-video')return Response.json({video_id:'key-video',thumbnail_url:'https://media.fbcdn.net/invented.png'});
  assert.equal(path,'advideos');assert.deepEqual(JSON.parse(url.searchParams.get('ids')!),['key-video']);
  return Response.json({data:[{id:'key-video',length:19,format:[{width:640,height:960}]}]});
 }) as typeof fetch};
 const client=new MetaCreativeClient(new MetaSpend(randomBytes(16).toString('hex'),options),options);
 await refreshMediaFacts(db,client,account,now);
 const facts=(await db.query<any>('SELECT kind,width,height,length_seconds,facts_error,facts_attempts FROM pulse.media_groups ORDER BY kind')).rows;
 assert.deepEqual(facts.map(r=>[r.kind,r.width,r.height,r.length_seconds===null?null:Number(r.length_seconds),r.facts_error,r.facts_attempts]),[['image',640,960,null,null,0],['video',640,960,19,null,0]]);
 for(const path of ['adimages','key-video','thumbnails','creative-image','creative-video','advideos'])assert.ok(paths.includes(path));
 const before=paths.length;await refreshMediaFacts(db,client,account,new Date('2026-10-17T12:00:00Z'));assert.equal(paths.length,before);
});

test('stored image headers supply size without another media download, and errors name the refused step',async()=>{
 const {imageSize}=await import('../src/creatives/image-size.js');
 const jpeg=Buffer.from([255,216,255,192,0,11,8,3,32,2,88,1,1,17,0,255,217]);
 assert.deepEqual(imageSize(jpeg),{width:600,height:800});assert.equal(imageSize(jpeg.subarray(0,10)),null);
 const paths:string[]=[];
 const options={sleep:async()=>{},fetch:(async input=>{const path=new URL(String(input)).pathname.split('/').at(-1)!;paths.push(path);return path==='adimages'?Response.json({error:{code:10}},{status:400}):Response.json({image_hash:'invented-hash'});}) as typeof fetch};
 const client=new MetaCreativeClient(new MetaSpend(randomBytes(16).toString('hex'),options),options);
 const facts=await client.readMediaFacts('invented-account',{kind:'image',key:'invented-hash',width:null,height:null,lengthSeconds:null,creativeId:'invented-creative',bytes:jpeg});
 assert.equal(facts.width,600);assert.equal(facts.height,800);assert.deepEqual(paths,['adimages','invented-creative']);assert.deepEqual(facts.failures,['http 400, meta 10 at adimages']);
});
