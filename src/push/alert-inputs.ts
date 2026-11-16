import type {Database} from '../db.js';
import type {SourceMode} from '../sources.js';
import type {Check} from '../shopify/watchdogs.js';
import {addDays,ukToday} from '../hero-range.js';
import {monthlyReminder} from '../fulfilment/model.js';
import {ALERT_CHECK_IDS,type AlertEvaluation} from './alert-types.js';

export interface AlertSourceModes {shopify:SourceMode; hq:SourceMode; anyLive:boolean}
/** Read existing local observations only; a push tick never runs or polls a source. */
export async function readAlertEvaluation(db:Database,modes:AlertSourceModes,now:Date):Promise<AlertEvaluation> {
  const first=ukToday(now).slice(0,7)+'-01',to=addDays(first,-1),from=to.slice(0,7)+'-01';
  const [stored,coverage]=await Promise.all([
    db.query<{data:{checks?:Check[];alertEvaluatedAt?:string}}>('SELECT data FROM pulse.shopify_watchdog_state WHERE mode=$1',[modes.shopify]),
    modes.shopify==='live' ? db.query<{coverageFrom:string;coverageTo:string}>(`SELECT coverage_from::text AS "coverageFrom",coverage_to::text AS "coverageTo"
      FROM pulse.fulfilment_uploads WHERE mode='live' AND coverage_from<=$1 AND coverage_to>=$2`,[to,from]) : {rows:[],rowCount:0},
  ]);
  const data=stored.rows[0]?.data,at=typeof data?.alertEvaluatedAt==='string'?data.alertEvaluatedAt:'';
  const age=now.getTime()-Date.parse(at),fresh=Number.isFinite(age)&&age>=0&&age<=120_000;
  const checks=ALERT_CHECK_IDS.map(id=>{
    const live=id==='ads_check'?modes.hq==='live':id==='self'?modes.anyLive:modes.shopify==='live';
    const check=Array.isArray(data?.checks)?data.checks.find(row=>row?.id===id):undefined;
    return fresh&&live&&check&&['pass','tripped','unknown'].includes(check.status)
      &&typeof check.name==='string'&&typeof check.why==='string'&&typeof check.link==='string'
      ? check : {id,name:id,status:'unknown' as const,why:'No fresh live evaluation.',link:'/sources'};
  });
  return {evaluationId:fresh?at:`stale:${at}`,checks,
    monthlyUploadOpen:modes.shopify==='live'&&monthlyReminder(now,coverage.rows)};
}
