import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import test from 'node:test';
import {AdError} from '../src/ad-spend/model.js';
import type {CreativeReader} from '../src/creatives/model.js';
import {MetaSpend} from '../src/ad-spend/clients.js';
import {MetaCreativeClient} from '../src/creatives/client.js';
import {mediaFactHealth,mediaFactLine,mediaFactPermissionLine,refreshMediaFacts} from '../src/creatives/media-facts.js';
import {saveCatalogue,saveInsights} from '../src/creatives/store.js';
import {createTestDatabase} from './helpers/database.js';
import {creativeAd,creativeGroup,creativeInsight} from './helpers/creatives.js';

// Every account, video, creative, cursor and figure below is invented.
const now=new Date('2026-10-16T12:00:00Z');

test('one account video list fills two groups without video calls and an absent video is recorded only once',async t=>{
 const db=await createTestDatabase();t.after(()=>db.close());
 const account='invented-list-account',keys=['invented-listed-fern','invented-listed-stone','invented-page-owned'];
 await db.query('INSERT INTO pulse.creative_jobs(account_id) VALUES($1)',[account]);
 await saveCatalogue(db,account,keys.map(key=>({ad:creativeAd(`${key}-ad`,`${key}-group`,{accountId:account,creativeId:`${key}-creative`}),
  media:{...creativeGroup(`${key}-group`,{kind:'video',key,width:null,height:null,lengthSeconds:null}),thumbnail:null,poster:null,frames:[]}})),now);
 await saveInsights(db,account,'2026-10-16','2026-10-16',keys.map(key=>creativeInsight(`${key}-ad`,{day:'2026-10-16'})),now);
 const calls:string[]=[];
 const options={sleep:async()=>{},fetch:(async(input,init)=>{
  const url=new URL(String(input)),path=url.pathname.split('/').at(-1)!;calls.push(path);assert.equal(init?.method,'GET');
  if(path==='advideos'){
   assert.equal(url.searchParams.has('ids'),false);assert.equal(url.searchParams.get('limit'),'100');
   assert.equal(url.searchParams.get('fields'),'id,length,thumbnails{uri,width,height,is_preferred}');
   return Response.json({data:keys.slice(0,2).map((key,i)=>({id:key,length:17+i*4,thumbnails:{data:[
    {width:100,height:100,uri:'https://media.fbcdn.net/invented-small.jpg'},
    {width:640+i*160,height:960,is_preferred:true,uri:'https://media.fbcdn.net/invented-preferred.jpg'},
   ]}}))});
  }
  if(path==='invented-page-owned-creative')return Response.json({object_story_spec:{video_data:{video_id:'invented-page-owned'}}});
  assert.ok(path==='invented-page-owned'||path==='thumbnails');
  return Response.json({error:{code:10,message:'Invented Page permission refusal'}},{status:400});
 }) as typeof fetch};
 const client=new MetaCreativeClient(new MetaSpend(randomBytes(16).toString('hex'),options),options);
 await refreshMediaFacts(db,client,account,now);
 assert.deepEqual(calls,['advideos','invented-page-owned-creative','invented-page-owned','thumbnails']);
 const stored=(await db.query<any>('SELECT media_key,width,height,length_seconds,video_owned_elsewhere,facts_error FROM pulse.media_groups ORDER BY media_key')).rows;
 for(const [i,key] of keys.slice(0,2).entries()){
  const row=stored.find(row=>row.media_key===key)!;
  assert.equal(row.width,640+i*160);assert.equal(row.height,960);assert.equal(Number(row.length_seconds),17+i*4);
  assert.equal(row.video_owned_elsewhere,false);
 }
 const absent=stored.find(row=>row.media_key==='invented-page-owned')!;
 assert.equal(absent.video_owned_elsewhere,true);assert.equal(absent.facts_error,'video owned elsewhere');
 const health=await mediaFactHealth(db,account,now);
 assert.equal(health.run?.filled,2);assert.equal(health.run?.ownedElsewhere,1);assert.equal(health.ownedElsewhere,1);
 assert.match(mediaFactLine(health),/1 owned elsewhere/);
 assert.match(mediaFactPermissionLine(health)!,/1 videos are not readable.*pages_read_engagement.*owning Facebook Page.*system user/);
 const cached=JSON.stringify((await db.query('SELECT * FROM pulse.creative_account_videos')).rows);
 assert.doesNotMatch(cached,/https:|uri|thumbnail|token/);
 await refreshMediaFacts(db,new MetaCreativeClient(new MetaSpend(randomBytes(16).toString('hex'),options),options),account,new Date('2026-10-17T12:00:00Z'));
 assert.deepEqual(calls,['advideos','invented-page-owned-creative','invented-page-owned','thumbnails'],'a restart cannot re-read the owned-elsewhere group');
 assert.equal((await mediaFactHealth(db,account,now)).ownedElsewhere,1);
});

test('video listing persists its cursor and waits for every page before deciding an ID is absent',async t=>{
 const db=await createTestDatabase();t.after(()=>db.close());const account='invented-paged-video';
 await db.query('INSERT INTO pulse.creative_jobs(account_id) VALUES($1)',[account]);
 await saveCatalogue(db,account,[{ad:creativeAd('invented-last-ad','invented-last-group',{accountId:account}),
  media:{...creativeGroup('invented-last-group',{kind:'video',key:'invented-last-video',width:null,height:null,lengthSeconds:null}),thumbnail:null,poster:null,frames:[]}}],now);
 const cursors:(string|null)[]=[];
 const options={sleep:async()=>{},fetch:(async input=>{
  const url=new URL(String(input));if(!url.pathname.endsWith('/advideos'))return Response.json({error:{code:10}},{status:400});assert.equal(url.searchParams.has('ids'),false);
  const cursor=url.searchParams.get('after');cursors.push(cursor);
  const page=cursor?Number(cursor.slice('invented-cursor-'.length)):0;
  return Response.json({data:page===4?[{id:'invented-last-video',length:26,thumbnails:{data:[{width:800,height:1000}]}}]:[],
   ...(page<4?{paging:{next:'https://graph.facebook.com/invented-unused',cursors:{after:`invented-cursor-${page+1}`}}}:{})});
 }) as typeof fetch};
 const reader=()=>new MetaCreativeClient(new MetaSpend(randomBytes(16).toString('hex'),options),options);
 await refreshMediaFacts(db,reader(),account,now);
 assert.deepEqual(cursors,[null,'invented-cursor-1','invented-cursor-2','invented-cursor-3']);
 assert.equal((await db.query('SELECT video_owned_elsewhere FROM pulse.media_groups')).rows[0]!.video_owned_elsewhere,false);
 assert.deepEqual((await db.query('SELECT account_video_after,account_video_list_complete FROM pulse.creative_jobs')).rows[0],{account_video_after:'invented-cursor-4',account_video_list_complete:false});
 await refreshMediaFacts(db,reader(),account,new Date('2026-10-16T12:30:00Z'));
 assert.equal(cursors.at(-1),'invented-cursor-4');
 const group=(await db.query<any>('SELECT width,height,length_seconds,video_owned_elsewhere FROM pulse.media_groups')).rows[0];
 assert.deepEqual([group.width,group.height,Number(group.length_seconds),group.video_owned_elsewhere],[800,1000,26,false]);
 assert.equal((await db.query('SELECT account_video_list_complete FROM pulse.creative_jobs')).rows[0]!.account_video_list_complete,true);
});

test('owned-elsewhere videos recover numeric metadata only from their matching creative video entry',async()=>{
 for(const field of ['object_story_spec','asset_feed_spec']){
  const options={fetch:(async input=>{
   assert.ok(new URL(String(input)).pathname.endsWith('/invented-fallback-creative'));
   const video={video_id:'invented-fallback-video',length:23,thumbnail:{width:720,height:960}};
   return Response.json(field==='object_story_spec'?{object_story_spec:{video_data:video}}:{asset_feed_spec:{videos:[
    {video_id:'invented-other-video',length:99,thumbnail:{width:999,height:999}},video,
   ]}});
  }) as typeof fetch};
  const client=new MetaCreativeClient(new MetaSpend(randomBytes(16).toString('hex'),options),options);
  const facts=await client.readMediaFacts('invented-fallback-account',{kind:'video',key:'invented-fallback-video',width:null,height:null,lengthSeconds:null,
   creativeId:'invented-fallback-creative',accountVideo:null,accountVideosComplete:true});
  assert.equal(facts.lengthSeconds,23);assert.equal(facts.width,720);assert.equal(facts.height,960);assert.equal(facts.ownedElsewhere,true);
 }
});

test('a creative-key fallback resolves its video ID before assigning ownership',async()=>{
 const options={fetch:(async()=>Response.json({video_id:'invented-resolved-video'})) as typeof fetch};
 const client=new MetaCreativeClient(new MetaSpend(randomBytes(16).toString('hex'),options),options);
 const facts=await client.readMediaFacts('invented-resolved-account',{kind:'video',key:'creative:invented-resolved-creative',width:null,height:null,lengthSeconds:null,
  accountVideo:null,accountVideosComplete:true,accountVideos:new Map([['invented-resolved-video',{id:'invented-resolved-video',width:640,height:800,lengthSeconds:22}]])});
 assert.deepEqual(facts,{width:640,height:800,lengthSeconds:22});
});

test('a deliberate local reset after a Page permission grant recovers facts and clears ownership',async t=>{
 const db=await createTestDatabase();t.after(()=>db.close());const account='invented-granted-account';
 await db.query('INSERT INTO pulse.creative_jobs(account_id) VALUES($1)',[account]);
 await saveCatalogue(db,account,[{ad:creativeAd('invented-granted-ad','invented-granted-group',{accountId:account,creativeId:'invented-granted-creative'}),
  media:{...creativeGroup('invented-granted-group',{kind:'video',key:'invented-granted-video',width:null,height:null,lengthSeconds:null}),thumbnail:null,poster:null,frames:[]}}],now);
 let granted=false;const calls:string[]=[];
 const options={sleep:async()=>{},fetch:(async input=>{
  const path=new URL(String(input)).pathname.split('/').at(-1)!;calls.push(path);
  if(path==='advideos')return Response.json({data:[]});
  if(path==='invented-granted-creative')return Response.json({object_story_spec:{video_data:{video_id:'invented-granted-video'}}});
  assert.ok(path==='invented-granted-video'||path==='thumbnails');
  return granted?Response.json(path==='thumbnails'?{data:[{width:720,height:960,is_preferred:true}]}:{length:24})
   :Response.json({error:{code:10,message:'Invented Page permission refusal'}},{status:400});
 }) as typeof fetch};
 const reader=()=>new MetaCreativeClient(new MetaSpend(randomBytes(16).toString('hex'),options),options);
 await refreshMediaFacts(db,reader(),account,now);
 assert.equal((await db.query('SELECT video_owned_elsewhere FROM pulse.media_groups')).rows[0]!.video_owned_elsewhere,true);
 granted=true;const before=calls.length;
 await refreshMediaFacts(db,reader(),account,new Date('2026-10-16T12:30:00Z'));
 assert.equal(calls.length,before,'the permission grant alone does not silently reset persisted local state');
 await db.query(`UPDATE pulse.media_groups SET video_owned_elsewhere=false,size_unavailable=false,length_unavailable=false,
  facts_attempts=0,facts_error=NULL,facts_retry_after=NULL
  WHERE mode='live' AND account_id=$1 AND kind='video' AND video_owned_elsewhere`,[account]);
 await refreshMediaFacts(db,reader(),account,new Date('2026-10-16T13:00:00Z'));
 const group=(await db.query<any>('SELECT width,height,length_seconds,video_owned_elsewhere,facts_error FROM pulse.media_groups')).rows[0];
 assert.deepEqual([group.width,group.height,Number(group.length_seconds),group.video_owned_elsewhere,group.facts_error],[720,960,24,false,null]);
 assert.deepEqual(calls.slice(before),['advideos','invented-granted-creative','invented-granted-video','thumbnails']);
});


test('account list retries 100 at 50 in the same run and preserves a failed 25-page cursor as retry',async t=>{
 const db=await createTestDatabase();t.after(()=>db.close());
 for(const failAt25 of [false,true]){
  const account=failAt25?'invented-retry-list':'invented-halved-list',key=`${account}-video`;
  await db.query('INSERT INTO pulse.creative_jobs(account_id) VALUES($1)',[account]);
  await saveCatalogue(db,account,[{ad:creativeAd(`${account}-ad`,`${account}-group`,{accountId:account}),
   media:{...creativeGroup(`${account}-group`,{kind:'video',key,width:null,height:null,lengthSeconds:null}),thumbnail:null,poster:null,frames:[]}}],now);
  const pages:{after:string|null;limit:number}[]=[];let direct=0;
  const reader:CreativeReader={readCatalogue:async function*(){},readInsights:async()=>[],imageBytes:async()=>new Uint8Array(),videoSource:async()=>'',videoFrames:async()=>[],
   readAccountVideoPage:async(_,after=null,limit=100)=>{
    pages.push({after,limit});
    if(failAt25&&!after)return {videos:[],after:'invented-page-two'};
    if(failAt25||limit===100)throw new AdError('http',500,1);
    return {videos:[{id:key,width:640,height:960,lengthSeconds:19}],after:null};
   },readMediaFacts:async(_,group)=>{direct++;return group.accountVideo??{width:null,height:null,lengthSeconds:null};}};
  await refreshMediaFacts(db,reader,account,now);
  const job=(await db.query('SELECT account_video_after,account_video_list_complete FROM pulse.creative_jobs WHERE account_id=$1',[account])).rows[0]!;
  const health=await mediaFactHealth(db,account,now);
  assert.equal(direct,1,'unscored video is tried even when the list is unfinished');
  if(failAt25){
   assert.deepEqual(pages.map(p=>p.limit),[100,100,50,25]);assert.equal(job.account_video_after,'invented-page-two');assert.equal(job.account_video_list_complete,false);
   assert.equal(health.run!.refused,0);assert.equal(health.run!.accountVideo!.retry,true);
   assert.match(mediaFactLine(health),/0 of 0 scored groups filled.*1 unscored video waiting on the account video list \(advideos http 500, retry next run at page 2, next run at 25 a page\)/);
   const group=(await db.query('SELECT facts_retry_after,size_unavailable,video_owned_elsewhere FROM pulse.media_groups WHERE account_id=$1',[account])).rows[0]!;
   assert.equal(group.facts_retry_after,null);assert.equal(group.size_unavailable,false);assert.equal(group.video_owned_elsewhere,false);
  }else{assert.deepEqual(pages.map(p=>p.limit),[100,50]);assert.equal(job.account_video_list_complete,true);assert.equal(health.unscored!.filled,1);}
 }
});

test('unfinished list misses still receive direct reads without declaring ownership',async()=>{
 const calls:string[]=[];
 const options={sleep:async()=>{},fetch:(async input=>{calls.push(new URL(String(input)).pathname.split('/').at(-1)!);return Response.json({error:{code:10}},{status:400});}) as typeof fetch};
 const reader=new MetaCreativeClient(new MetaSpend(randomBytes(16).toString('hex'),options),options);
 const facts=await reader.readMediaFacts('invented-open-list',{kind:'video',key:'invented-open-video',creativeId:'invented-open-creative',width:null,height:null,lengthSeconds:null,accountVideosComplete:false,accountVideo:null});
 assert.ok(calls.includes('invented-open-creative'));assert.ok(calls.includes('invented-open-video'));assert.ok(calls.includes('thumbnails'));assert.equal(facts.ownedElsewhere,undefined);
});
