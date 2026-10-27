import type {Database} from '../db.js';
import type {ShopifyReader} from './client.js';
import {ShopifyError} from './http.js';
export type FirstOrder = 'first'|'repeat'|'unknown';
export const firstOrderFlag=(index:unknown):FirstOrder=>Number.isSafeInteger(index)&&Number(index)>0 ? index===1?'first':'repeat':'unknown';

/** Narrow projections, persisted by page; no order or customer details are re-saved. */
export async function backfillFirstOrders(db:Database,reader:ShopifyReader,clock:()=>Date,closing:()=>boolean):Promise<void> {
  // The previous release can still write its old projection until deployment swaps over.
  await db.query(`UPDATE pulse.shopify_records SET data=(data-'customerId') || jsonb_build_object('firstOrder',COALESCE(data->>'firstOrder','unknown'))
    WHERE mode='live' AND kind='order' AND (data ? 'customerId' OR NOT (data ? 'firstOrder'))`);
  if(!reader.firstOrderFlags)return;
  const now=clock();
  await db.query("INSERT INTO pulse.shopify_first_order_backfill(mode,next_run_at) VALUES('live',$1) ON CONFLICT DO NOTHING",[now]);
  const job=(await db.query<{cursor:string;next_run_at:Date}>("SELECT cursor,next_run_at FROM pulse.shopify_first_order_backfill WHERE mode='live'")).rows[0]!;
  if(new Date(job.next_run_at)>now)return;
  let cursor=job.cursor;
  try {
    for(let batch=0;batch<4&&!closing();batch++) {
      const poll=(await db.query<{next_run_at:Date}>("SELECT next_run_at FROM pulse.shopify_jobs WHERE mode='live' AND name='poll'")).rows[0];
      if(poll&&new Date(poll.next_run_at)<=clock())return;
      const rows=await db.query<{source_id:string;source_updated_at:Date}>(`SELECT source_id,source_updated_at FROM pulse.shopify_records
        WHERE mode='live' AND kind='order' AND source_id>$1 AND COALESCE(data->>'firstOrder','unknown')='unknown'
        ORDER BY source_id LIMIT 25`,[cursor]);
      if(!rows.rows.length){
        await db.query("UPDATE pulse.shopify_first_order_backfill SET cursor='',next_run_at=$1,error=NULL WHERE mode='live'",[new Date(clock().getTime()+86_400_000)]);return;
      }
      const flags=await reader.firstOrderFlags(rows.rows.map(r=>r.source_id));
      const next=rows.rows.at(-1)!.source_id;
      await db.transaction(async tx=>{
        for(const row of rows.rows){
          const flag=flags.find(f=>f.id===row.source_id)?.firstOrder;
          if(flag==='first'||flag==='repeat')await tx.query(`UPDATE pulse.shopify_records SET data=jsonb_set(data,'{firstOrder}',to_jsonb($2::text))
            WHERE mode='live' AND kind='order' AND source_id=$1 AND source_updated_at=$3`,[row.source_id,flag,row.source_updated_at]);
        }
        await tx.query("UPDATE pulse.shopify_first_order_backfill SET cursor=$1,last_success_at=$2,error=NULL,next_run_at=$2 WHERE mode='live'",[next,clock()]);
      });
      cursor=next;
    }
  } catch(error){
    const code=error instanceof ShopifyError?error.code:'unknown';
    await db.query("UPDATE pulse.shopify_first_order_backfill SET error=$1,next_run_at=$2 WHERE mode='live'",[code,new Date(clock().getTime()+60_000)]);
    console.error(`Shopify first-order flags failed (${code}).`);
  }
}
