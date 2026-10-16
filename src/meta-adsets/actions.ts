import {randomUUID} from 'node:crypto';
import type {Database} from '../db.js';
import {readSettings} from '../settings.js';
import {MetaSpend} from '../ad-spend/clients.js';
import {adErrorCode} from '../ad-spend/model.js';
import {MetaActionsClient} from './actions-client.js';
import {AD_SET_FIELDS,adSetOwner,parseAdSet,saveAdSets} from './catalogue.js';
export class AdActionError extends Error {constructor(readonly statusCode:number){super('Ad-set action refused.');}}
export interface MetaAction {id:string;time:string;adSetId:string;action:'pause'|'resume'|'budget';oldValue:string;newValue:string;result:string;undoneAt:string|null;undoOf:string|null;errorCode:string|null}
export async function readMetaActions(db:Database,account?:string):Promise<MetaAction[]> {
 const rows=await db.query<any>(`SELECT * FROM pulse.meta_actions ${account?'WHERE account_id=$1':''} ORDER BY time DESC,id DESC LIMIT 50`,account?[account]:[]);
 return rows.rows.map(r=>({id:r.id,time:new Date(r.time).toISOString(),adSetId:r.ad_set_id,action:r.action,oldValue:r.old_value,newValue:r.new_value,result:r.result,undoneAt:r.undone_at?new Date(r.undone_at).toISOString():null,undoOf:r.undo_of,errorCode:r.error_code}));
}
/** Reserve and commit the audit row before contacting Meta; a pending row excludes concurrent writes. */
export async function actOnAdSet(db:Database,id:string,input:unknown,who:string,now:Date,client:MetaActionsClient,reader:MetaSpend):Promise<{id:string;refreshed:boolean}> {
 if(!/^\d{1,24}$/.test(id)||!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['action','value'].includes(k)))throw new AdActionError(400);
 const body=input as {action:unknown;value?:unknown};
 if(!['pause','resume','budget','undo'].includes(String(body.action)))throw new AdActionError(400);
 const result=await db.transaction(async tx=>{
  // Authorize against the current Settings while reserving this action.
  await tx.query('SELECT singleton FROM pulse.settings WHERE singleton=true FOR UPDATE');
  const settings=(await readSettings(tx)).values,account=settings.metaAdAccountId;
  const set=(await tx.query<any>('SELECT * FROM pulse.meta_ad_sets WHERE account_id=$1 AND ad_set_id=$2 FOR UPDATE',[account,id])).rows[0];
  if(!set||adSetOwner(set.campaign_id,settings)!=='ours')throw new AdActionError(403);
  if(set.currency!=='GBP')throw new AdActionError(400);
  if((await tx.query("SELECT id FROM pulse.meta_actions WHERE account_id=$1 AND ad_set_id=$2 AND result='pending'",[account,id])).rowCount)throw new AdActionError(409);
  let action=body.action as 'pause'|'resume'|'budget',undo:any=null;
  let next=body.action==='pause'?'PAUSED':body.action==='resume'?'ACTIVE':'';
  if(body.action==='undo'){
   if(typeof body.value!=='string')throw new AdActionError(400);
   undo=(await tx.query<any>('SELECT * FROM pulse.meta_actions WHERE id=$1 AND account_id=$2 AND ad_set_id=$3 FOR UPDATE',[body.value,account,id])).rows[0];
   if(!undo||undo.result!=='success'||undo.undone_at||undo.undo_of||now.getTime()-new Date(undo.time).getTime()>86_400_000||now.getTime()<new Date(undo.time).getTime())throw new AdActionError(409);
   action=undo.action==='budget'?'budget':undo.old_value==='ACTIVE'?'resume':'pause';next=undo.old_value;
   if(String(action==='budget'?set.daily_budget:set.status)!==undo.new_value)throw new AdActionError(409);
   const later=await tx.query('SELECT id FROM pulse.meta_actions WHERE account_id=$1 AND ad_set_id=$2 AND result=\'success\' AND time>=$3 AND id<>$4',[account,id,undo.time,undo.id]);if(later.rowCount)throw new AdActionError(409);
  }else if(action==='budget'){
   const value=body.value;
   if(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value*100-Math.round(value*100))>1e-6)throw new AdActionError(400);
   next=String(Math.round(value*100));
  }else if(body.value!==undefined&&body.value!==next)throw new AdActionError(400);
  const old=String(action==='budget'?set.daily_budget??'':set.status);
  if(action==='budget'){
   const base=Number(set.daily_budget),minor=Number(next);
   if(!Number.isSafeInteger(base)||base<100||!Number.isSafeInteger(minor)||minor<100||!undo&&minor>Math.floor(base*13/10))throw new AdActionError(400);
  }else if(!['ACTIVE','PAUSED'].includes(old))throw new AdActionError(400);
  if(old===next)throw new AdActionError(409);
  const actionId=randomUUID();
  await tx.query("INSERT INTO pulse.meta_actions(id,time,account_id,ad_set_id,action,old_value,new_value,who,result,undo_of) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9)",[actionId,now,account,id,action,old,next,who,undo?.id??null]);
  return {id:actionId,action,next,account,settings,currency:set.currency,undoId:undo?.id as string|undefined};
 });
 try{if(result.action==='pause')await client.pause(id);else if(result.action==='resume')await client.resume(id);else await client.setDailyBudget(id,Number(result.next));}
 catch(error){await db.query("UPDATE pulse.meta_actions SET result='failed',error_code=$2 WHERE id=$1",[result.id,adErrorCode(error,'meta')]);throw new AdActionError(502);}
 await db.transaction(async tx=>{
   await tx.query("UPDATE pulse.meta_actions SET result='success' WHERE id=$1",[result.id]);
   if(result.action==='budget')await tx.query('UPDATE pulse.meta_ad_sets SET daily_budget=$3 WHERE account_id=$1 AND ad_set_id=$2',[result.account,id,Number(result.next)]);
   else await tx.query('UPDATE pulse.meta_ad_sets SET status=$3 WHERE account_id=$1 AND ad_set_id=$2',[result.account,id,result.next]);
   if(result.undoId)await tx.query('UPDATE pulse.meta_actions SET undone_at=$2 WHERE id=$1',[result.undoId,now]);
 });
 let refreshed=false;
 try{
   const raw=await reader.readGraph(id,{fields:AD_SET_FIELDS});
   await saveAdSets(db,result.account,[parseAdSet(raw,result.currency,result.settings)],result.settings,now,{id,field:result.action==='budget'?'daily_budget':'status',value:result.next});refreshed=true;
 }catch{console.info('Meta action saved; ad-set refresh pending.');}
 return {id:result.id,refreshed};
}
