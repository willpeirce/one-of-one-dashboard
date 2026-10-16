import type {Database} from '../db.js';
import {readSettings} from '../settings.js';
import {adSetOwner} from './catalogue.js';
import {AdActionError} from './actions.js';
/** A local planning preference, independent of the Meta action flag and source client. */
export async function saveAdSetFlags(db:Database,id:string,input:unknown,who:string,now:Date):Promise<void> {
 if(!/^\d{1,24}$/.test(id)||!input||typeof input!=='object'||Array.isArray(input))throw new AdActionError(400);
 const body=input as Record<string,unknown>;
 if(Object.keys(body).length!==1||!('flatBudget' in body)||typeof body.flatBudget!=='boolean'&&body.flatBudget!==null)throw new AdActionError(400);
 await db.transaction(async tx=>{
  await tx.query('SELECT singleton FROM pulse.settings WHERE singleton=true FOR UPDATE');
  const settings=(await readSettings(tx)).values,account=settings.metaAdAccountId;
  const set=(await tx.query<any>('SELECT campaign_id,flat_budget FROM pulse.meta_ad_sets WHERE account_id=$1 AND ad_set_id=$2 FOR UPDATE',[account,id])).rows[0];
  if(!set||adSetOwner(set.campaign_id,settings)!=='ours')throw new AdActionError(403);
  if(set.flat_budget===body.flatBudget)return;
  await tx.query('UPDATE pulse.meta_ad_sets SET flat_budget=$3 WHERE account_id=$1 AND ad_set_id=$2',[account,id,body.flatBudget]);
  await tx.query('INSERT INTO pulse.audit_log(event,credential_id,occurred_at) VALUES($1,$2,$3)',[`ad set flat budget ${id}: ${set.flat_budget} → ${body.flatBudget}`,who,now]);
 });
}
