import type {Database} from '../db.js';
import type {CreativeReader,MediaGroup} from './model.js';
import {adErrorCode} from '../ad-spend/model.js';
import {scanRetryAt} from './scan.js';
export interface MediaFacts {width:number|null;height:number|null;lengthSeconds:number|null}
export interface MediaFactHealth {filled:number;total:number;lastRun:string|null;reasons:{reason:string;count:number}[]}
export async function mediaFactHealth(db:Database,account:string):Promise<MediaFactHealth>{
 const counts=(await db.query<any>(`SELECT count(*) AS total,
  count(*) FILTER(WHERE width>0 AND height>0 AND (kind='image' OR length_seconds IS NOT NULL)) AS filled,
  count(*) FILTER(WHERE size_unavailable OR length_unavailable) AS unavailable
  FROM pulse.media_groups WHERE mode='live' AND account_id=$1`,[account])).rows[0];
 const errors=await db.query<any>(`SELECT facts_error,count(*) FROM pulse.media_groups WHERE mode='live' AND account_id=$1 AND facts_error IS NOT NULL GROUP BY facts_error ORDER BY count(*) DESC,facts_error`,[account]);
 const run=(await db.query<any>('SELECT media_facts_last_run FROM pulse.creative_jobs WHERE account_id=$1',[account])).rows[0]?.media_facts_last_run;
 return {filled:Number(counts.filled),total:Number(counts.total),lastRun:run?new Date(run).toISOString():null,reasons:[...(Number(counts.unavailable)?[{reason:'unavailable',count:Number(counts.unavailable)}]:[]),...errors.rows.map(r=>({reason:r.facts_error,count:Number(r.count)}))]};
}
export function mediaFactLine(health:MediaFactHealth):string {
 return `Media facts: ${health.filled} of ${health.total} groups filled, last run ${health.lastRun??'not yet'}, ${health.reasons.map(r=>`${r.reason} on ${r.count}`).join('; ')||'no failures on 0'}`;
}
/** Metadata only: a refused creative, vanished ad or failed thumbnail cannot block facts. */
export async function refreshMediaFacts(db:Database,reader:CreativeReader,account:string,now:Date):Promise<void>{
 if(!reader.readMediaFacts)return;
 const due=await db.query<any>(`SELECT id,kind,media_key,width,height,length_seconds,size_unavailable,length_unavailable FROM pulse.media_groups
  WHERE mode='live' AND account_id=$1 AND (((width IS NULL OR height IS NULL) AND NOT size_unavailable)
   OR (kind='video' AND length_seconds IS NULL AND NOT length_unavailable))
  AND (facts_retry_after IS NULL OR facts_retry_after<=$2) ORDER BY facts_retry_after NULLS FIRST,id LIMIT 20`,[account,now]);
 for(const row of due.rows){
  const group:Pick<MediaGroup,'kind'|'key'|'width'|'height'|'lengthSeconds'>={kind:row.kind,key:row.media_key,width:row.width,height:row.height,lengthSeconds:row.length_seconds===null?null:Number(row.length_seconds)};
  try{
   const facts=await reader.readMediaFacts(account,group,{size:!row.size_unavailable&&(row.width===null||row.height===null),length:!row.length_unavailable&&row.kind==='video'&&row.length_seconds===null});
   await db.query(`UPDATE pulse.media_groups SET width=COALESCE(width,$3),height=COALESCE(height,$4),length_seconds=COALESCE(length_seconds,$5),
    size_unavailable=(COALESCE(width,$3) IS NULL OR COALESCE(height,$4) IS NULL),length_unavailable=(kind='video' AND COALESCE(length_seconds,$5) IS NULL),facts_error=NULL,facts_retry_after=NULL
    WHERE account_id=$1 AND id=$2`,[account,row.id,facts.width,facts.height,facts.lengthSeconds]);
  }catch(error){
   await db.query('UPDATE pulse.media_groups SET facts_error=$3,facts_retry_after=$4 WHERE account_id=$1 AND id=$2',[account,row.id,adErrorCode(error,'meta'),scanRetryAt(now)]);
  }
 }
 await db.query('UPDATE pulse.creative_jobs SET media_facts_last_run=$2 WHERE account_id=$1',[account,now]);
 console.info(mediaFactLine(await mediaFactHealth(db,account)));
}
