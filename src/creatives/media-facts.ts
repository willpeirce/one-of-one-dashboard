import type {Database} from '../db.js';
import type {CreativeReader,MediaGroup} from './model.js';
import {adErrorCode} from '../ad-spend/model.js';
import {scanRetryAt} from './scan.js';
import {ukToday} from '../hero-range.js';
import {creativeWindowRange,type CreativeWindow} from './ranking.js';
export interface MediaFactGroup extends Pick<MediaGroup,'kind'|'key'|'width'|'height'|'lengthSeconds'> {creativeId?:string;bytes?:Uint8Array|null}
export interface MediaFacts {width:number|null;height:number|null;lengthSeconds:number|null;failures?:string[]}
export interface MediaFactHealth {filled:number;total:number;lastRun:string|null;reasons:{reason:string;count:number}[];from:string;to:string}
export async function mediaFactHealth(db:Database,account:string,now=new Date(),window:CreativeWindow='7d'):Promise<MediaFactHealth>{
 const {from,to}=creativeWindowRange(window,ukToday(now));
 // Match scoring's parent groups with spend in the selected window, across the account.
 const groups=(await db.query<any>(`WITH RECURSIVE family AS (
  SELECT id AS member,id AS parent,merged_into_id,ARRAY[id] AS seen FROM pulse.media_groups WHERE mode='live' AND account_id=$1
  UNION ALL SELECT f.member,g.id,g.merged_into_id,f.seen||g.id FROM family f JOIN pulse.media_groups g ON g.id=f.merged_into_id
   WHERE g.mode='live' AND g.account_id=$1 AND NOT g.id=ANY(f.seen)
 ), scored AS (
  SELECT DISTINCT f.parent FROM family f JOIN pulse.ads a ON a.media_group_id=f.member AND a.mode='live' AND a.account_id=$1
   JOIN pulse.ad_insights_daily i ON i.ad_id=a.ad_id AND i.mode=a.mode AND i.account_id=a.account_id
   WHERE f.merged_into_id IS NULL AND i.day BETWEEN $2 AND $3 AND i.spend>0
 ) SELECT width,height,kind,length_seconds,size_unavailable,length_unavailable,facts_error FROM pulse.media_groups WHERE id IN(SELECT parent FROM scored)`,[account,from,to])).rows;
 const reasons=new Map<string,number>();
 for(const row of groups){const reason=row.size_unavailable||row.length_unavailable?'unavailable':row.facts_error;if(reason)reasons.set(reason,(reasons.get(reason)??0)+1);}
 const run=(await db.query<any>('SELECT media_facts_last_run FROM pulse.creative_jobs WHERE account_id=$1',[account])).rows[0]?.media_facts_last_run;
 return {filled:groups.filter(r=>r.width>0&&r.height>0&&(r.kind==='image'||r.length_seconds!==null)).length,total:groups.length,lastRun:run?new Date(run).toISOString():null,
  reasons:[...reasons].map(([reason,count])=>({reason,count})).sort((a,b)=>b.count-a.count||a.reason.localeCompare(b.reason)),from,to};
}
export function mediaFactLine(health:MediaFactHealth):string {
 return `Media facts: ${health.filled} of ${health.total} scored groups filled (${health.from}–${health.to}, whole account), last run ${health.lastRun??'not yet'}, ${health.reasons.map(r=>`${r.reason} on ${r.count}`).join('; ')||'no failures on 0'}`;
}
/** Bounded daily recovery; stored bytes and a representative creative are fallback inputs. */
export async function refreshMediaFacts(db:Database,reader:CreativeReader,account:string,now:Date,window:CreativeWindow='7d'):Promise<void>{
 if(!reader.readMediaFacts)return;
 const due=await db.query<any>(`SELECT g.id,g.kind,g.media_key,g.width,g.height,g.length_seconds,g.size_unavailable,g.length_unavailable,g.facts_attempts,
  COALESCE(g.full_image,g.frames[1],g.thumbnail) AS bytes,
  (SELECT creative_id FROM pulse.ads a WHERE a.mode=g.mode AND a.account_id=g.account_id AND a.media_group_id=g.id ORDER BY last_seen DESC,ad_id LIMIT 1) AS creative_id
  FROM pulse.media_groups g WHERE g.mode='live' AND g.account_id=$1 AND (((g.width IS NULL OR g.height IS NULL) AND NOT g.size_unavailable)
   OR (g.kind='video' AND g.length_seconds IS NULL AND NOT g.length_unavailable))
  AND (g.facts_retry_after IS NULL OR g.facts_retry_after<=$2) ORDER BY g.facts_retry_after NULLS FIRST,g.id LIMIT 20`,[account,now]);
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
 }
 await db.query('UPDATE pulse.creative_jobs SET media_facts_last_run=$2 WHERE account_id=$1',[account,now]);
 console.info(mediaFactLine(await mediaFactHealth(db,account,now,window)));
}
