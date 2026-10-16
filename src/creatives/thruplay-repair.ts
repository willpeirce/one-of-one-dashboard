import type {Database} from '../db.js';
import type {CreativeReader} from './model.js';
import {AdError,adErrorCode} from '../ad-spend/model.js';
import {addDays,ukToday} from '../hero-range.js';
import {scanRetryAt} from './scan.js';
export interface ThruPlayRow {adId:string;day:string;plays:number;thruPlays:number|null}
export interface ThruPlayHealth {completed:number;total:number;failures:{day:string;code:string}[]}
export async function thruPlayHealth(db:Database,account:string):Promise<ThruPlayHealth>{
 const rows=(await db.query<{day:string;completed:boolean;error_code:string|null}>('SELECT day::text,completed,error_code FROM pulse.creative_thruplay_days WHERE account_id=$1 ORDER BY day',[account])).rows;
 return {completed:rows.filter(r=>r.completed).length,total:rows.length,failures:rows.filter(r=>r.error_code).map(r=>({day:r.day,code:r.error_code!}))};
}
/** Only repair video measures; never replace spend/actions or certify full insight coverage. */
export async function repairThruPlays(db:Database,reader:CreativeReader,account:string,now:Date):Promise<void>{
 if(!reader.readThruPlays)return;
 const today=ukToday(now),from=addDays(today,-14),to=addDays(today,-1);
 await db.query(`INSERT INTO pulse.creative_thruplay_days(account_id,day)
  SELECT $1,day FROM generate_series($2::date,$3::date,interval '1 day') day
  WHERE NOT EXISTS(SELECT 1 FROM pulse.creative_thruplay_days WHERE account_id=$1)
   AND EXISTS(SELECT 1 FROM pulse.creative_jobs WHERE account_id=$1 AND thruplays_backfilled_at IS NULL)`,[account,from,to]);
 const due=(await db.query<{day:string}>(`SELECT day::text FROM pulse.creative_thruplay_days WHERE account_id=$1 AND NOT completed
  AND (retry_after IS NULL OR retry_after<=$2) ORDER BY day LIMIT 12`,[account,now])).rows.map(r=>r.day);
 const read=async(days:string[]):Promise<void>=>{
  const start=days[0]!,end=days.at(-1)!;
  let rows:ThruPlayRow[];
  try{rows=await reader.readThruPlays!(account,start,end);}
  catch(error){
   if(days.length>1&&error instanceof AdError&&error.providerSubcode===1504044){
    const size=Math.floor(days.length/2);
    for(let i=0;i<days.length;i+=size)await read(days.slice(i,i+size));
    return;
   }
   const code=`${adErrorCode(error,'meta')} at backfill`;
   await db.query('UPDATE pulse.creative_thruplay_days SET error_code=$3,retry_after=$4 WHERE account_id=$1 AND day=ANY($2::date[])',[account,days,code,scanRetryAt(now)]);
   for(const day of days)console.error(`Meta ThruPlay backfill ${day} failed (${code}).`);
   return;
  }
  await db.transaction(async tx=>{
   await tx.query('SELECT pg_advisory_xact_lock(1668244582,hashtext($1))',[`live:${account}`]);
   await tx.query("UPDATE pulse.ad_insights_daily SET thru_plays=NULL WHERE mode='live' AND account_id=$1 AND day=ANY($2::date[])",[account,days]);
   for(const row of rows){
    if(!days.includes(row.day))throw new AdError('invalid');
    await tx.query("UPDATE pulse.ad_insights_daily SET thru_plays=$4,plays=$5 WHERE mode='live' AND account_id=$1 AND ad_id=$2 AND day=$3",[account,row.adId,row.day,row.thruPlays,row.plays]);
   }
   await tx.query('UPDATE pulse.creative_thruplay_days SET completed=true,error_code=NULL,retry_after=NULL,fetched_at=$3 WHERE account_id=$1 AND day=ANY($2::date[])',[account,days,now]);
  });
 };
 for(let i=0;i<due.length;){
  const days=[due[i++]!];
  while(i<due.length&&days.length<3&&due[i]===addDays(days.at(-1)!,1))days.push(due[i++]!);
  await read(days);
 }
 const health=await thruPlayHealth(db,account);
 if(health.total>0&&health.completed===health.total)await db.query('UPDATE pulse.creative_jobs SET thruplays_backfilled_at=COALESCE(thruplays_backfilled_at,$2) WHERE account_id=$1',[account,now]);
}
