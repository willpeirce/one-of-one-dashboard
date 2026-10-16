import type {Database} from '../db.js';
import type {CreativeReader,MediaGroup} from './model.js';
import {adErrorCode} from '../ad-spend/model.js';
import {scanRetryAt} from './scan.js';
import {ukToday} from '../hero-range.js';
import {creativeWindowRange,type CreativeWindow} from './ranking.js';
import {scoredMediaCte} from './scored-media.js';
export interface MediaFactGroup extends Pick<MediaGroup,'kind'|'key'|'width'|'height'|'lengthSeconds'> {creativeId?:string;bytes?:Uint8Array|null}
export interface MediaFacts {width:number|null;height:number|null;lengthSeconds:number|null;failures?:string[]}
export interface MediaFactRun {tried:number;filled:number;refused:number;reasons:{reason:string;count:number}[]}
export interface MediaFactHealth {filled:number;total:number;lastRun:string|null;run:MediaFactRun|null;reasons:{reason:string;count:number}[];from:string;to:string}
export async function mediaFactHealth(db:Database,account:string,now=new Date(),window:CreativeWindow='7d'):Promise<MediaFactHealth>{
 const {from,to}=creativeWindowRange(window,ukToday(now));
 // Match scoring's parent groups with spend in the selected window, across the account.
 const groups=(await db.query<any>(`${scoredMediaCte} SELECT width,height,kind,length_seconds,size_unavailable,length_unavailable,facts_error FROM pulse.media_groups WHERE id IN(SELECT parent FROM scored)`,[account,from,to])).rows;
 const reasons=new Map<string,number>();
 for(const row of groups){const reason=row.size_unavailable||row.length_unavailable?'unavailable':row.facts_error;if(reason)reasons.set(reason,(reasons.get(reason)??0)+1);}
 const job=(await db.query<any>('SELECT media_facts_last_run,media_facts_report FROM pulse.creative_jobs WHERE account_id=$1',[account])).rows[0];
 return {filled:groups.filter(r=>r.width>0&&r.height>0&&(r.kind==='image'||r.length_seconds!==null)).length,total:groups.length,lastRun:job?.media_facts_last_run?new Date(job.media_facts_last_run).toISOString():null,run:job?.media_facts_report??null,
  reasons:[...reasons].map(([reason,count])=>({reason,count})).sort((a,b)=>b.count-a.count||a.reason.localeCompare(b.reason)),from,to};
}
export function mediaFactLine(health:MediaFactHealth):string {
 const run=health.run;
 return `Media facts: ${health.filled} of ${health.total} scored groups filled (${health.from}–${health.to}, whole account), last run ${health.lastRun??'not yet'}${run?`: ${run.tried} tried, ${run.filled} filled, ${run.refused} refused${run.reasons.length?` (${run.reasons.map(r=>`${r.reason} on ${r.count}`).join('; ')})`:''}`:': run report pending'}`;
}
/** Bounded daily recovery; stored bytes and a representative creative are fallback inputs. */
export async function refreshMediaFacts(db:Database,reader:CreativeReader,account:string,now:Date,window:CreativeWindow='7d'):Promise<void>{
 if(!reader.readMediaFacts)return;
 const {from,to}=creativeWindowRange(window,ukToday(now));
 const due=await db.query<any>(`${scoredMediaCte} SELECT g.id,g.kind,g.media_key,g.width,g.height,g.length_seconds,g.size_unavailable,g.length_unavailable,g.facts_attempts,
  COALESCE(g.full_image,g.frames[1],g.thumbnail) AS bytes,
  (SELECT creative_id FROM pulse.ads a WHERE a.mode=g.mode AND a.account_id=g.account_id AND a.media_group_id=g.id ORDER BY last_seen DESC,ad_id LIMIT 1) AS creative_id
  FROM pulse.media_groups g LEFT JOIN scored s ON s.parent=g.id WHERE g.mode='live' AND g.account_id=$1 AND (((g.width IS NULL OR g.height IS NULL) AND NOT g.size_unavailable)
   OR (g.kind='video' AND g.length_seconds IS NULL AND NOT g.length_unavailable))
  AND (g.facts_retry_after IS NULL OR g.facts_retry_after<=$4) ORDER BY s.spend DESC NULLS LAST,g.facts_retry_after NULLS FIRST,g.id LIMIT 40`,[account,from,to,now]);
 const report:MediaFactRun={tried:0,filled:0,refused:0,reasons:[]},reasons=new Map<string,number>();
 for(const row of due.rows){
  const group:MediaFactGroup={kind:row.kind,key:row.media_key,width:row.width,height:row.height,lengthSeconds:row.length_seconds===null?null:Number(row.length_seconds),creativeId:row.creative_id,bytes:row.bytes};
  let facts:MediaFacts;
  try {facts=await reader.readMediaFacts(account,group,{size:!row.size_unavailable&&(row.width===null||row.height===null),length:!row.length_unavailable&&row.kind==='video'&&row.length_seconds===null});}
  catch(error){facts={width:null,height:null,lengthSeconds:null,failures:[adErrorCode(error,'meta')]};}
  const width=row.width??facts.width,height=row.height??facts.height,length=row.length_seconds??facts.lengthSeconds;
  const missingSize=width===null||height===null,missingLength=row.kind==='video'&&length===null;
  const incomplete=missingSize||missingLength,attempts=incomplete?row.facts_attempts+1:0,unavailable=attempts>=3;
  await db.query(`UPDATE pulse.media_groups SET width=$3,height=$4,length_seconds=$5,
   size_unavailable=$6,length_unavailable=$7,facts_attempts=$8,facts_error=$9,facts_retry_after=$10 WHERE account_id=$1 AND id=$2`,
   [account,row.id,width,height,length,missingSize&&(row.size_unavailable||unavailable),missingLength&&(row.length_unavailable||unavailable),attempts,
    incomplete?(facts.failures?.join('; ')||'metadata missing'):null,incomplete&&!unavailable?scanRetryAt(now):null]);
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
