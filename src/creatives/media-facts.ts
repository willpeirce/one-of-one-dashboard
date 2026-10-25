import type {Database} from '../db.js';
import type {CreativeReader,MediaGroup} from './model.js';
import {AdError,adErrorCode} from '../ad-spend/model.js';
import {scanRetryAt} from './scan.js';
import {ukToday} from '../hero-range.js';
import {creativeWindowRange,type CreativeWindow} from './ranking.js';
import {scoredMediaCte} from './scored-media.js';
export interface AccountVideoFacts {id:string;width:number|null;height:number|null;lengthSeconds:number|null}
export interface AccountVideoPage {videos:AccountVideoFacts[];after:string|null}
export interface MediaFactGroup extends Pick<MediaGroup,'kind'|'key'|'width'|'height'|'lengthSeconds'> {
 creativeId?:string;bytes?:Uint8Array|null;accountVideo?:AccountVideoFacts|null;accountVideosComplete?:boolean;accountVideos?:ReadonlyMap<string,AccountVideoFacts>;
}
export interface MediaFacts {width:number|null;height:number|null;lengthSeconds:number|null;failures?:string[];ownedElsewhere?:boolean}
export interface AccountVideoRun {page:number;nextLimit:number;retry:boolean;failure:string|null;complete:boolean}
export interface MediaFactRun {accountVideo?:AccountVideoRun;tried:number;filled:number;refused:number;reasons:{reason:string;count:number}[];ownedElsewhere?:number}
export interface MediaFactHealth {unscored?:{filled:number;total:number;waitingVideos:number};filled:number;total:number;lastRun:string|null;run:MediaFactRun|null;reasons:{reason:string;count:number}[];from:string;to:string;ownedElsewhere?:number}
const ACCOUNT_VIDEO_PAGES_PER_RUN=4;

/** Save each page with its next cursor; a later pass resumes after the last saved page. */
async function refreshAccountVideos(db:Database,reader:CreativeReader,account:string,now:Date){
 const job=(await db.query<{account_video_after:string|null;media_facts_report:MediaFactRun|null}>('SELECT account_video_after,media_facts_report FROM pulse.creative_jobs WHERE account_id=$1',[account])).rows[0];
 let after=job?.account_video_after??null,complete=false,failure:string|null=null;
 const previous=job?.media_facts_report?.accountVideo;
 let limit=previous&&!previous.complete?previous.nextLimit:100,number=after?(previous?.page??1):1,retry=false;
 await db.query('UPDATE pulse.creative_jobs SET account_video_list_complete=false WHERE account_id=$1',[account]);
 const seen=new Set<string>();
 if(after)seen.add(after);
 for(let page=0;page<ACCOUNT_VIDEO_PAGES_PER_RUN;page++){
  let result:AccountVideoPage;
  try{
   for(;;){
    try{result=await reader.readAccountVideoPage!(account,after,limit);break;}
    catch(error){
     if(error instanceof AdError&&(error.status===500||error.providerCode===1)){
      if(limit>25){limit=Math.max(25,Math.floor(limit/2));continue;}
      retry=true;failure=`advideos ${error.status===500?'http 500':'meta code 1'}, retry next run`;
     }
     throw error;
    }
   }
   if(result.after&&seen.has(result.after))throw new Error('Repeated account video cursor');
  }catch(error){failure??=`${adErrorCode(error,'meta')} at advideos`;break;}
  await db.transaction(async tx=>{
   for(const video of result.videos)await tx.query(`INSERT INTO pulse.creative_account_videos(account_id,video_id,width,height,length_seconds,fetched_at)
    VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(account_id,video_id) DO UPDATE SET width=EXCLUDED.width,height=EXCLUDED.height,length_seconds=EXCLUDED.length_seconds,fetched_at=EXCLUDED.fetched_at`,
    [account,video.id,video.width,video.height,video.lengthSeconds,now]);
   await tx.query('UPDATE pulse.creative_jobs SET account_video_after=$2,account_video_list_complete=$3 WHERE account_id=$1',[account,result.after,result.after===null]);
  });
  after=result.after;
  if(!after){complete=true;break;}
  seen.add(after);number++;
 }
 const cached=(await db.query<{video_id:string;width:number|null;height:number|null;length_seconds:string|number|null}>('SELECT video_id,width,height,length_seconds FROM pulse.creative_account_videos WHERE account_id=$1',[account])).rows;
 return {complete,failure,run:{page:number,nextLimit:limit,retry,failure,complete} satisfies AccountVideoRun,videos:new Map(cached.map(row=>[row.video_id,{id:row.video_id,width:row.width,height:row.height,lengthSeconds:row.length_seconds===null?null:Number(row.length_seconds)}]))};
}
export async function mediaFactHealth(db:Database,account:string,now=new Date(),window:CreativeWindow='7d'):Promise<MediaFactHealth>{
 const {from,to}=creativeWindowRange(window,ukToday(now));
 // Match scoring's parent groups with spend in the selected window, across the account.
 const groups=(await db.query<any>(`${scoredMediaCte} SELECT width,height,kind,length_seconds,size_unavailable,length_unavailable,facts_error,video_owned_elsewhere FROM pulse.media_groups WHERE id IN(SELECT parent FROM scored)`,[account,from,to])).rows;
 const unscored=(await db.query<any>(`${scoredMediaCte} SELECT g.width,g.height,g.length_seconds,g.kind,g.video_owned_elsewhere
  FROM pulse.media_groups g WHERE g.mode='live' AND g.account_id=$1 AND g.merged_into_id IS NULL AND NOT EXISTS(SELECT 1 FROM scored s WHERE s.parent=g.id)`,[account,from,to])).rows;
 const reasons=new Map<string,number>();
 for(const row of groups){const reason=row.size_unavailable||row.length_unavailable?'unavailable':row.facts_error;if(reason)reasons.set(reason,(reasons.get(reason)??0)+1);}
 const job=(await db.query<any>('SELECT media_facts_last_run,media_facts_report FROM pulse.creative_jobs WHERE account_id=$1',[account])).rows[0];
 return {filled:groups.filter(r=>r.width>0&&r.height>0&&(r.kind==='image'||r.length_seconds!==null)).length,total:groups.length,lastRun:job?.media_facts_last_run?new Date(job.media_facts_last_run).toISOString():null,run:job?.media_facts_report??null,
  reasons:[...reasons].map(([reason,count])=>({reason,count})).sort((a,b)=>b.count-a.count||a.reason.localeCompare(b.reason)),from,to,
  unscored:{filled:unscored.filter(r=>r.width>0&&r.height>0&&(r.kind==='image'||r.length_seconds!==null)).length,total:unscored.length,
   waitingVideos:unscored.filter(r=>r.kind==='video'&&!r.video_owned_elsewhere&&(r.width===null||r.height===null||r.length_seconds===null)).length},
  ownedElsewhere:groups.filter(row=>row.video_owned_elsewhere).length};
}
export function mediaFactLine(health:MediaFactHealth):string {
 const run=health.run,unscored=health.unscored,list=run?.accountVideo;
 const extra=unscored?.total?`; ${unscored.filled} of ${unscored.total} unscored groups filled${unscored.waitingVideos&&list&&!list.complete?`; ${unscored.waitingVideos} unscored video${unscored.waitingVideos===1?'':'s'} waiting on the account video list (${list.failure??'more pages'} at page ${list.page}, next run at ${list.nextLimit} a page)`:''}`:'';
 return `Media facts: ${health.filled} of ${health.total} scored groups filled (${health.from}–${health.to}, whole account), last run ${health.lastRun??'not yet'}${run?`: ${run.tried} tried, ${run.filled} filled, ${run.refused} refused${run.ownedElsewhere?`, ${run.ownedElsewhere} owned elsewhere`:''}${run.reasons.length?` (${run.reasons.map(r=>`${r.reason} on ${r.count}`).join('; ')})`:''}`:': run report pending'}${extra}`;
}
export function mediaFactPermissionLine(health:MediaFactHealth):string|null {
 return health.ownedElsewhere?`${health.ownedElsewhere} videos are not readable with the current token: grant pages_read_engagement on the owning Facebook Page and assign that Page to the system user`:null;
}
/** Bounded daily recovery; stored bytes and a representative creative are fallback inputs. */
export async function refreshMediaFacts(db:Database,reader:CreativeReader,account:string,now:Date,window:CreativeWindow='7d'):Promise<void>{
 if(!reader.readMediaFacts)return;
 const {from,to}=creativeWindowRange(window,ukToday(now));
 const due=await db.query<any>(`${scoredMediaCte} SELECT g.id,g.kind,g.media_key,g.width,g.height,g.length_seconds,g.size_unavailable,g.length_unavailable,g.facts_attempts,
  COALESCE(g.full_image,g.frames[1],g.thumbnail) AS bytes,
  (SELECT creative_id FROM pulse.ads a WHERE a.mode=g.mode AND a.account_id=g.account_id AND a.media_group_id=g.id ORDER BY last_seen DESC,ad_id LIMIT 1) AS creative_id
  FROM pulse.media_groups g LEFT JOIN scored s ON s.parent=g.id WHERE g.mode='live' AND g.account_id=$1 AND NOT g.video_owned_elsewhere AND (((g.width IS NULL OR g.height IS NULL) AND NOT g.size_unavailable)
   OR (g.kind='video' AND g.length_seconds IS NULL AND NOT g.length_unavailable))
  AND (g.facts_retry_after IS NULL OR g.facts_retry_after<=$4) ORDER BY s.spend DESC NULLS LAST,g.facts_retry_after NULLS FIRST,g.id LIMIT 40`,[account,from,to,now]);
 const report:MediaFactRun={tried:0,filled:0,refused:0,reasons:[]},reasons=new Map<string,number>();
 const accountVideos=reader.readAccountVideoPage&&due.rows.some(row=>row.kind==='video')?await refreshAccountVideos(db,reader,account,now):null;
 if(accountVideos){report.accountVideo=accountVideos.run;if(accountVideos.failure)reasons.set(accountVideos.failure,1);}
 for(const row of due.rows){
  const waitingForList=row.kind==='video'&&accountVideos&&!accountVideos.complete&&!accountVideos.videos.has(row.media_key);
  const group:MediaFactGroup={kind:row.kind,key:row.media_key,width:row.width,height:row.height,lengthSeconds:row.length_seconds===null?null:Number(row.length_seconds),creativeId:row.creative_id,bytes:row.bytes,
   ...(row.kind==='video'&&accountVideos?{accountVideo:accountVideos.videos.get(row.media_key)??null,accountVideosComplete:accountVideos.complete,accountVideos:accountVideos.videos}:{})};
  let facts:MediaFacts;
  try {facts=await reader.readMediaFacts(account,group,{size:!row.size_unavailable&&(row.width===null||row.height===null),length:!row.length_unavailable&&row.kind==='video'&&row.length_seconds===null});}
  catch(error){facts={width:null,height:null,lengthSeconds:null,failures:[adErrorCode(error,'meta')]};}
  const width=row.width??facts.width,height=row.height??facts.height,length=row.length_seconds??facts.lengthSeconds;
  const missingSize=width===null||height===null,missingLength=row.kind==='video'&&length===null;
  const incomplete=missingSize||missingLength,attempts=incomplete?row.facts_attempts+(waitingForList?0:1):0,unavailable=!waitingForList&&attempts>=3;
  await db.query(`UPDATE pulse.media_groups SET width=$3,height=$4,length_seconds=$5,
   size_unavailable=$6,length_unavailable=$7,facts_attempts=$8,facts_error=$9,facts_retry_after=$10,video_owned_elsewhere=$11 WHERE account_id=$1 AND id=$2`,
   [account,row.id,width,height,length,missingSize&&(row.size_unavailable||unavailable||facts.ownedElsewhere===true),missingLength&&(row.length_unavailable||unavailable||facts.ownedElsewhere===true),attempts,
    facts.ownedElsewhere?'video owned elsewhere':incomplete?(facts.failures?.join('; ')||'metadata missing'):null,incomplete&&!unavailable&&!facts.ownedElsewhere&&!waitingForList?scanRetryAt(now):null,facts.ownedElsewhere===true]);
  if(facts.ownedElsewhere)report.ownedElsewhere=(report.ownedElsewhere??0)+1;
  report.tried++;
  if(!incomplete)report.filled++;
  // A refused direct read can still recover via a fallback: both outcomes matter.
  if(facts.failures?.length)report.refused++;
  for(const reason of new Set(facts.failures??[]))reasons.set(reason,(reasons.get(reason)??0)+1);
 }
 report.reasons=[...reasons].map(([reason,count])=>({reason,count})).sort((a,b)=>b.count-a.count||a.reason.localeCompare(b.reason));
 await db.query('UPDATE pulse.creative_jobs SET media_facts_last_run=$2,media_facts_report=$3 WHERE account_id=$1',[account,now,JSON.stringify(report)]);
 console.info(mediaFactLine(await mediaFactHealth(db,account,now,window)));
}
