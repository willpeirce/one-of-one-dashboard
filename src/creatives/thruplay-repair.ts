import type {Database} from '../db.js';
import type {CreativeReader} from './model.js';
import {AdError,adErrorCode} from '../ad-spend/model.js';
import {addDays,ukToday} from '../hero-range.js';
import {scanRetryAt} from './scan.js';
import {creativeWindowRange,type CreativeWindow} from './ranking.js';
import {scoredMediaCte} from './scored-media.js';
export interface ThruPlayRow {adId:string;day:string;plays:number|null;thruPlays:number|null;holdThreeSecondPlays?:number}
export interface ThruPlayRunReport {tried:number;filled:number;refused:number;codes:{code:string;count:number}[]}
export interface ThruPlayHealth {completed:number;total:number;failures:{day:string;code:string}[];lastRunAt:string|null;lastRunReport:ThruPlayRunReport|null}
const videoDaysCte=`${scoredMediaCte}, video_days AS (
 SELECT i.day,bool_or(i.plays IS NULL OR i.thru_plays IS NULL) AS missing_video
 FROM family f JOIN scored s ON s.parent=f.parent
 JOIN pulse.media_groups g ON g.id=f.parent AND g.kind='video'
 JOIN pulse.ads a ON a.media_group_id=f.member AND a.mode='live' AND a.account_id=$1
 JOIN pulse.ad_insights_daily i ON i.ad_id=a.ad_id AND i.mode=a.mode AND i.account_id=a.account_id
 WHERE f.merged_into_id IS NULL AND i.spend>0
  AND i.day BETWEEN COALESCE(NULLIF($2::text,'0000-01-01')::date,'-infinity'::date) AND $3::date
 GROUP BY i.day
)`;
export async function thruPlayHealth(db:Database,account:string,now=new Date(),window:CreativeWindow='7d'):Promise<ThruPlayHealth>{
 const {from,to}=creativeWindowRange(window,ukToday(now));
 const rows=(await db.query<{day:string;completed:boolean;error_code:string|null}>(`${videoDaysCte}
 SELECT v.day::text,COALESCE(d.completed AND NOT v.missing_video,false) AS completed,d.error_code
 FROM video_days v LEFT JOIN pulse.creative_thruplay_days d ON d.account_id=$1 AND d.day=v.day ORDER BY v.day`,[account,from,to])).rows;
 const job=(await db.query<{thruplay_last_run_at:Date|string|null;thruplay_run_report:ThruPlayRunReport|null}>(
  'SELECT thruplay_last_run_at,thruplay_run_report FROM pulse.creative_jobs WHERE account_id=$1',[account])).rows[0];
 return {completed:rows.filter(r=>r.completed).length,total:rows.length,failures:rows.filter(r=>r.error_code).map(r=>({day:r.day,code:r.error_code!})),
  lastRunAt:job?.thruplay_last_run_at?new Date(job.thruplay_last_run_at).toISOString():null,lastRunReport:job?.thruplay_run_report??null};
}
function refusalCode(code:string):string {
 const meta=/meta (\d+)(?:\/(\d+))?/.exec(code);
 return meta?`meta ${meta[2]??meta[1]}`:code.replace(/ at backfill$/,'');
}
export function thruPlayLine(health:ThruPlayHealth):string {
 const reasons=[...new Set(health.failures.map(f=>refusalCode(f.code)))].sort();
 const remaining=health.total-health.completed;
 const run=health.lastRunReport,runCodes=run?[...new Set(run.codes.map(row=>refusalCode(row.code)))].sort():[];
 const report=`, last run ${health.lastRunAt??'not yet'}${run?`: ${run.tried} days read, ${run.filled} filled, ${run.refused} refused${runCodes.length?` (${runCodes.join('; ')})`:''}`:''}`;
 return `ThruPlay backfill: ${health.completed} of ${health.total} days complete, ${remaining} ${remaining===1?'day':'days'} still to read${report}${health.failures.length?`, ${health.failures.length} ${health.failures.length===1?'day':'days'} refused (${reasons.join('; ')}), retry next UK day`:''}`;
}
/** Only repair video measures; never replace spend/actions or certify full insight coverage. */
export async function repairThruPlays(db:Database,reader:CreativeReader,account:string,now:Date,window:CreativeWindow='7d',options:{onlyDue?:boolean}={}):Promise<ThruPlayRunReport|null>{
 if(!reader.readThruPlays)return null;
 const tried=new Set<string>(),filled=new Set<string>(),refused=new Map<string,string>();
 let recordRun=!options.onlyDue,report:ThruPlayRunReport|null=null;
 try{
 const {from,to}=creativeWindowRange(window,ukToday(now));
 await db.query(`${videoDaysCte} INSERT INTO pulse.creative_thruplay_days(account_id,day)
  SELECT $1,day FROM video_days ON CONFLICT DO NOTHING`,[account,from,to]);
 // Old successful-but-empty reports and subsequent imports can leave missing
 // plays behind a completed marker. Re-open only those days.
 await db.query(`${videoDaysCte} UPDATE pulse.creative_thruplay_days d SET completed=false,retry_after=NULL,error_code=NULL
  FROM video_days v WHERE d.account_id=$1 AND d.day=v.day AND d.completed AND v.missing_video`,[account,from,to]);
 const due=(await db.query<{day:string}>(`${videoDaysCte} SELECT d.day::text FROM pulse.creative_thruplay_days d
  JOIN video_days v ON v.day=d.day WHERE d.account_id=$1 AND NOT d.completed
  AND (d.retry_after IS NULL OR d.retry_after<=$4) ORDER BY d.day LIMIT 12`,[account,from,to,now])).rows.map(r=>r.day);
 if(!due.length&&options.onlyDue)return null;
 recordRun=true;
 const read=async(days:string[]):Promise<void>=>{
  const start=days[0]!,end=days.at(-1)!;
  let rows:ThruPlayRow[];
  for(const day of days)tried.add(day);
  try{rows=await reader.readThruPlays!(account,start,end);}
  catch(error){
   if(days.length>1&&error instanceof AdError&&error.providerSubcode===1504044){
    const size=Math.floor(days.length/2);
    for(let i=0;i<days.length;i+=size)await read(days.slice(i,i+size));
    return;
   }
   const code=`${adErrorCode(error,'meta')} at backfill`;
   for(const day of days)refused.set(day,code);
   await db.query('UPDATE pulse.creative_thruplay_days SET error_code=$3,retry_after=$4 WHERE account_id=$1 AND day=ANY($2::date[])',[account,days,code,scanRetryAt(now)]);
   for(const day of days)console.error(`Meta ThruPlay backfill ${day} failed (${code}).`);
   return;
  }
  const completedDays=await db.transaction(async tx=>{
   await tx.query('SELECT pg_advisory_xact_lock(1668244582,hashtext($1))',[`live:${account}`]);
   await tx.query("UPDATE pulse.ad_insights_daily SET plays=NULL,thru_plays=NULL WHERE mode='live' AND account_id=$1 AND day=ANY($2::date[])",[account,days]);
   for(const row of rows){
    if(!days.includes(row.day))throw new AdError('invalid');
    await tx.query("UPDATE pulse.ad_insights_daily SET thru_plays=$4,plays=$5,hold_three_second_plays=COALESCE($6,hold_three_second_plays) WHERE mode='live' AND account_id=$1 AND ad_id=$2 AND day=$3",[account,row.adId,row.day,row.thruPlays,row.plays,row.holdThreeSecondPlays??null]);
   }
   const completed=await tx.query<{day:string;completed:boolean}>(`${videoDaysCte} UPDATE pulse.creative_thruplay_days d SET
    completed=NOT v.missing_video,error_code=NULL,retry_after=CASE WHEN v.missing_video THEN $5::timestamptz ELSE NULL END,fetched_at=$6
    FROM video_days v WHERE d.account_id=$1 AND d.day=v.day AND d.day=ANY($4::date[]) RETURNING d.day::text,d.completed`,[account,from,to,days,scanRetryAt(now),now]);
   return completed.rows.filter(day=>day.completed).map(day=>day.day);
  });
  for(const day of completedDays)filled.add(day);
 };
 for(let i=0;i<due.length;){
  const days=[due[i++]!];
  while(i<due.length&&days.length<3&&due[i]===addDays(days.at(-1)!,1))days.push(due[i++]!);
  await read(days);
 }
 const health=await thruPlayHealth(db,account,now,window);
 if(health.total>0&&health.completed===health.total)await db.query('UPDATE pulse.creative_jobs SET thruplays_backfilled_at=COALESCE(thruplays_backfilled_at,$2) WHERE account_id=$1',[account,now]);
 else if(health.total>0)await db.query('UPDATE pulse.creative_jobs SET thruplays_backfilled_at=NULL WHERE account_id=$1',[account]);
 }finally{
  const codes=new Map<string,number>();
  for(const code of refused.values())codes.set(code,(codes.get(code)??0)+1);
  report={tried:tried.size,filled:filled.size,refused:refused.size,
   codes:[...codes].map(([code,count])=>({code,count})).sort((a,b)=>b.count-a.count||a.code.localeCompare(b.code))};
  if(recordRun)await db.query(`INSERT INTO pulse.creative_jobs(account_id,thruplay_last_run_at,thruplay_run_report) VALUES($1,$2,$3)
   ON CONFLICT(account_id) DO UPDATE SET thruplay_last_run_at=EXCLUDED.thruplay_last_run_at,thruplay_run_report=EXCLUDED.thruplay_run_report`,[account,now,JSON.stringify(report)]);
 }
 return report;
}
