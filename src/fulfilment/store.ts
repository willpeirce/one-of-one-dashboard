import { ukToday, addDays } from '../hero-range.js';
import { randomUUID } from 'node:crypto';
import type { Database } from '../db.js';
import type { SourceMode } from '../sources.js';
import { readSettings, type Settings } from '../settings.js';
import type { Order } from '../shopify/model.js';
import { type ParcelRow, ImportError } from './parser.js';
import { type Parcel, type Model, type Estimate, emptyModel, learn, quantities, mixKey, estimateOrder, actualPence, gbpMinor, parcelFlags, weeklyReminder, despatchDay } from './model.js';

export interface Upload {
  id: string; fileName:string; rowCount:number; savedCount:number; despatchFrom:string; despatchTo:string;
  uploadedAt:string; gbpPerUsd:number; errorPence:number|null; errorCount:number; changes:string[]; coverageWeek:string|null;
}
const localTime = (value: Date | string) => value instanceof Date ? value.toISOString().slice(0,19).replace('T',' ') : value.slice(0,19).replace('T',' ');
export async function fulfilmentOrders(db:Database,mode:SourceMode):Promise<Order[]> {
  return (await db.query<{data:Order}>("SELECT data FROM pulse.shopify_records WHERE mode=$1 AND kind='order'",[mode])).rows.map(r=>r.data);
}
export async function readParcels(db:Database,mode:SourceMode):Promise<Parcel[]> {
  return (await db.query<any>('SELECT * FROM pulse.fulfilment_parcels WHERE mode=$1 ORDER BY despatched_at,id',[mode])).rows.map(r=>({id:String(r.id),orderNumber:r.order_number,orderId:r.order_id,despatchedAt:localTime(r.despatched_at),warehouse:r.warehouse,centre:r.centre,service:r.service,carrier:r.carrier,country:r.country,boxedGrams:r.boxed_grams,currency:r.currency,postageMinor:Number(r.postage_minor),pickPackMinor:Number(r.pick_pack_minor),customerPaidPence:Number(r.customer_paid_pence),gbpPerUsd:Number(r.gbp_per_usd),uploadId:r.upload_id,replacedEstimatePence:r.replaced_estimate_pence===null?null:Number(r.replaced_estimate_pence),rateBaselinePence:r.rate_baseline_pence===null?null:Number(r.rate_baseline_pence),flags:r.flags}));
}
export async function readUploads(db:Database,mode:SourceMode):Promise<Upload[]> {
  return (await db.query<any>('SELECT * FROM pulse.fulfilment_uploads WHERE mode=$1 ORDER BY uploaded_at DESC,id',[mode])).rows.map(r=>({id:r.id,fileName:r.file_name,rowCount:r.row_count,savedCount:r.saved_count,despatchFrom:localTime(r.despatch_from),despatchTo:localTime(r.despatch_to),uploadedAt:new Date(r.uploaded_at).toISOString(),gbpPerUsd:Number(r.gbp_per_usd),errorPence:r.error_pence===null?null:Number(r.error_pence),errorCount:r.error_count,changes:r.changes,coverageWeek:r.coverage_week?localTime(r.coverage_week).slice(0,10):null}));
}
export async function readModel(db:Database,mode:SourceMode):Promise<Model> {
  return (await db.query<{data:Model}>('SELECT data FROM pulse.fulfilment_models WHERE mode=$1',[mode])).rows[0]?.data as Model ?? emptyModel();
}
async function lock(db:Database,mode:SourceMode) {
  await db.query("INSERT INTO pulse.fulfilment_models (mode,data) VALUES ($1,$2) ON CONFLICT DO NOTHING",[mode,JSON.stringify(emptyModel())]);
  await db.query('SELECT mode FROM pulse.fulfilment_models WHERE mode=$1 FOR UPDATE',[mode]);
}
export function matchOrder(number:string,orders:readonly Order[]):Order|undefined {
  const matches=orders.filter(o=>o.orderNumber===number);
  return matches.length===1?matches[0]:undefined;
}
function previewRows(rows:ParcelRow[],orders:Order[],stored:Parcel[]) {
  const seen=new Set(stored.map(p=>JSON.stringify([p.orderNumber,p.despatchedAt])));
  return rows.map(r=>{const identity=JSON.stringify([r.orderNumber,r.despatchedAt]),duplicate=seen.has(identity);seen.add(identity);return {...r,orderId:matchOrder(r.orderNumber,orders)?.id??null,duplicate};});
}
export async function previewImport(db:Database,mode:SourceMode,rows:ParcelRow[],rate:number) {
  const [orders,stored]=await Promise.all([fulfilmentOrders(db,mode),readParcels(db,mode)]);
  const projected=previewRows(rows,orders,stored);
  const sum=(subset:ParcelRow[])=>({postage:subset.reduce((s,r)=>s+r.postageMinor,0),pickPack:subset.reduce((s,r)=>s+r.pickPackMinor,0),customerPaidPence:subset.reduce((s,r)=>s+r.customerPaidPence,0),gbpPence:subset.some(r=>r.currency===null)?null:subset.reduce((s,r)=>s+gbpMinor(r.postageMinor+r.pickPackMinor,r.currency,rate)!,0)});
  return {rows:projected,warehouses:Object.fromEntries(['uk','us','unknown'].map(w=>[w,{rows:rows.filter(r=>r.warehouse===w).length,...sum(rows.filter(r=>r.warehouse===w))}])),matched:[...new Set(projected.filter(r=>r.orderId).map(r=>r.orderNumber))],unmatched:[...new Set(projected.filter(r=>!r.orderId).map(r=>r.orderNumber))],duplicates:projected.filter(r=>r.duplicate).length};
}
async function saveEstimates(db:Database,mode:SourceMode,orders:Order[],parcels:Parcel[],model:Model,settings:Settings,now:Date) {
  const rows = orders.map(o => { const e = estimateOrder(o, parcels, model, settings); return { order_id: o.id, cost_pence: e.costPence, source: e.source, warehouse: e.warehouse, service: e.service, guess: e.guess }; });
  // A full backfill can contain tens of thousands of orders; use bounded bulk writes.
  for (let i = 0; i < rows.length; i += 1000) {
    await db.query(`INSERT INTO pulse.fulfilment_estimates (mode,order_id,cost_pence,source,warehouse,service,guess,updated_at)
      SELECT $1,r.order_id,r.cost_pence,r.source,r.warehouse,r.service,r.guess,$3
      FROM jsonb_to_recordset($2::jsonb) AS r(order_id text,cost_pence bigint,source text,warehouse text,service text,guess boolean)
      ON CONFLICT (mode,order_id) DO UPDATE SET cost_pence=EXCLUDED.cost_pence,source=EXCLUDED.source,warehouse=EXCLUDED.warehouse,service=EXCLUDED.service,guess=EXCLUDED.guess,updated_at=EXCLUDED.updated_at`,[mode,JSON.stringify(rows.slice(i,i+1000)),now]);
  }
}
async function rebuild(db:Database,mode:SourceMode,orders:Order[],parcels:Parcel[],settings:Settings,now:Date):Promise<Model> {
  const newlyMatched: Parcel[] = [];
  for (const p of parcels) {
    const order=matchOrder(p.orderNumber,orders);
    if (order&&p.orderId!==order.id) {p.orderId=order.id;newlyMatched.push(p);await db.query('UPDATE pulse.fulfilment_parcels SET order_id=$1 WHERE id=$2',[order.id,p.id]);}
  }
  const model=learn(parcels,orders);
  for (const p of newlyMatched) {
    const order = orders.find(o => o.id === p.orderId)!;
    const peers = learn(parcels.filter(other => other.id !== p.id), orders);
    const q = quantities(order);
    const rate = q && peers.rates.find(r => r.warehouse === p.warehouse && r.service === p.service && r.mix === mixKey(q) && r.state === (p.warehouse === 'us' ? order.region : ''));
    if (rate && p.rateBaselinePence === null) p.rateBaselinePence = gbpMinor(rate.postage + rate.pickPack, p.currency, p.gbpPerUsd);
    p.flags = parcelFlags(p, order, peers);
    await db.query('UPDATE pulse.fulfilment_parcels SET flags=$2,rate_baseline_pence=$3 WHERE id=$1', [p.id, JSON.stringify(p.flags), p.rateBaselinePence]);
  }
  await db.query('DELETE FROM pulse.fulfilment_rates WHERE mode=$1',[mode]);
  const rates = model.rates.map(r => ({ warehouse:r.warehouse,service:r.service,sku_mix:r.mix,state:r.state,mean_postage_minor:r.postage,mean_pick_pack_minor:r.pickPack,count:r.count,last_seen:r.lastSeen }));
  for (let i = 0; i < rates.length; i += 1000) await db.query(`INSERT INTO pulse.fulfilment_rates (mode,warehouse,service,sku_mix,state,mean_postage_minor,mean_pick_pack_minor,count,last_seen)
    SELECT $1,r.* FROM jsonb_to_recordset($2::jsonb) AS r(warehouse text,service text,sku_mix text,state text,mean_postage_minor numeric,mean_pick_pack_minor numeric,count integer,last_seen timestamp)`, [mode,JSON.stringify(rates.slice(i,i+1000))]);
  await db.query('UPDATE pulse.fulfilment_models SET data=$2,updated_at=$3 WHERE mode=$1',[mode,JSON.stringify(model),now]);
  await saveEstimates(db,mode,orders,parcels,model,settings,now);
  return model;
}
export async function refreshFulfilment(db:Database,mode:SourceMode,now=new Date()) {
  await db.transaction(async tx=>{
    await lock(tx,mode);
    const [orders,parcels,settings]=await Promise.all([fulfilmentOrders(tx,mode),readParcels(tx,mode),readSettings(tx)]);
    await rebuild(tx,mode,orders,parcels,settings.values,now);
  });
}
export async function confirmImport(db:Database,mode:SourceMode,rows:ParcelRow[],fileName:string,rate:number,now:Date,credentialId?:string,coverageWeek?:string) {
  return db.transaction(async tx=>{
    await lock(tx,mode);
    await readSettings(tx);
    // Read under the held lock so a simultaneous edit cannot change the invoice stamp.
    await tx.query('SELECT singleton FROM pulse.settings WHERE singleton=true FOR SHARE');
    const settings=await readSettings(tx);
    if (settings.values.jjGbpPerUsd!==rate) throw new ImportError('The invoice rate changed. Preview the file again.');
    const [orders,stored,oldModel]=await Promise.all([fulfilmentOrders(tx,mode),readParcels(tx,mode),readModel(tx,mode)]);
    const preview=previewRows(rows,orders,stored), fresh=preview.filter(r=>!r.duplicate);
    const dates=rows.map(r=>r.despatchedAt).sort();
    if (coverageWeek && (dates.at(-1)!.slice(0,10) < coverageWeek || dates[0]!.slice(0,10) > addDays(coverageWeek,6))) throw new ImportError('This file has no despatches in the week you are confirming.');
    const alreadyCovered = coverageWeek && (await readUploads(tx,mode)).some(u=>u.coverageWeek===coverageWeek);
    if (!fresh.length && (!coverageWeek || alreadyCovered)) return {saved:0,skipped:rows.length,uploadId:null};
    const id=randomUUID();
    await tx.query(`INSERT INTO pulse.fulfilment_uploads (id,mode,source_id,file_name,row_count,saved_count,despatch_from,despatch_to,uploaded_at,gbp_per_usd,coverage_week) VALUES ($1::text::uuid,$2,$1::text,$3,$4,$5,$6,$7,$8,$9,$10)`,[id,mode,fileName,rows.length,fresh.length,dates[0],dates.at(-1),now,rate,coverageWeek??null]);
    const pending:Parcel[]=fresh.map(r=>{const o=r.orderId?orders.find(o=>o.id===r.orderId):undefined;const before = o ? estimateOrder(o,stored,oldModel,settings.values) : null; return {...r,id:'',gbpPerUsd:rate,uploadId:id,replacedEstimatePence:before && before.source !== 'actual' ? before.costPence : null,rateBaselinePence:null,flags:[]};});
    // Evaluate same-file anomalies against peers with the parcel itself left out.
    for (const p of pending) {
      const o=p.orderId?orders.find(o=>o.id===p.orderId):undefined;
      const baselineModel=oldModel.warehouses[p.warehouse as 'uk'|'us']?oldModel:learn([...stored,...pending.filter(r=>r!==p)],orders);
      const q=o&&quantities(o);
      const rateRow=q&&baselineModel.rates.find(r=>r.warehouse===p.warehouse&&r.service===p.service&&r.mix===mixKey(q)&&r.state===(p.warehouse==='us'?o!.region:''));
      const fallback = o ? estimateOrder({ ...o, fulfillments: [], fulfillmentStatus: 'UNFULFILLED', country: p.warehouse === 'uk' ? 'GB' : p.warehouse === 'us' ? 'US' : null, market: p.warehouse === 'uk' ? 'UK' : p.warehouse === 'us' ? 'US' : 'unknown' }, [], baselineModel, settings.values) : null;
      p.rateBaselinePence=rateRow?gbpMinor(rateRow.postage+rateRow.pickPack,p.currency,p.gbpPerUsd):fallback && ['exact','ladder'].includes(fallback.source) ? fallback.costPence : null;
      p.flags=parcelFlags(p,o,baselineModel);
      const added=await tx.query<{id:string}>(`INSERT INTO pulse.fulfilment_parcels (mode,source_id,fetched_at,order_number,order_id,despatched_at,warehouse,centre,service,carrier,country,boxed_grams,currency,postage_minor,pick_pack_minor,customer_paid_pence,gbp_per_usd,upload_id,replaced_estimate_pence,rate_baseline_pence,flags)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING id::text`,[mode,`${p.orderNumber}:${p.despatchedAt}`,now,p.orderNumber,p.orderId,p.despatchedAt,p.warehouse,p.centre,p.service,p.carrier,p.country,p.boxedGrams,p.currency,p.postageMinor,p.pickPackMinor,p.customerPaidPence,rate,id,p.replacedEstimatePence,p.rateBaselinePence,JSON.stringify(p.flags)]);
      p.id=added.rows[0]!.id;
    }
    const model=await rebuild(tx,mode,orders,[...stored,...pending],settings.values,now);
    // One comparison per newly invoiced order, summing all its additional parcels.
    const errors=[...new Set(pending.filter(p=>p.orderId).map(p=>p.orderId!))].flatMap(orderId=>{
      const group=pending.filter(p=>p.orderId===orderId),previous=group[0]!.replacedEstimatePence;
      const costs=[...stored,...pending].filter(p=>p.orderId===orderId).map(actualPence);
      return previous===null||costs.some(c=>c===null)?[]:[Math.abs(costs.reduce<number>((s,c)=>s+c!,0)-previous)];
    });
    const changes=model.rates.map(r=>{const before=oldModel.rates.find(b=>b.warehouse===r.warehouse&&b.service===r.service&&b.mix===r.mix&&b.state===r.state);return {r,before,delta:before?Math.abs(r.postage+r.pickPack-before.postage-before.pickPack):r.postage+r.pickPack};}).filter(r=>!r.before || r.delta>1e-6).sort((a,b)=>b.delta-a.delta).slice(0,3).map(({r,before})=>`${r.warehouse.toUpperCase()} · ${r.service} · ${(JSON.parse(r.mix) as [string,number][]).map(([sku,n])=>`${sku} × ${n}`).join(', ')}${r.state?' · '+r.state:''}: ${before?((before.postage+before.pickPack)/100).toFixed(2):'new'} → ${((r.postage+r.pickPack)/100).toFixed(2)} ${r.warehouse==='us'?'USD':'GBP'} (${r.count} parcels)`);
    await tx.query('UPDATE pulse.fulfilment_uploads SET error_pence=$2,error_count=$3,changes=$4 WHERE id=$1',[id,errors.length?errors.reduce((s,n)=>s+n,0)/errors.length:null,errors.length,JSON.stringify(changes)]);
    if (credentialId) await tx.query("INSERT INTO pulse.audit_log (event,credential_id) VALUES ('fulfilment_upload_confirmed',$1)",[credentialId]);
    return {saved:pending.length,skipped:rows.length-pending.length,uploadId:id};
  });
}
export async function fulfilmentSummary(db:Database,mode:SourceMode,now:Date) {
  const [parcels,uploads,orders,model]=await Promise.all([readParcels(db,mode),readUploads(db,mode),fulfilmentOrders(db,mode),readModel(db,mode)]);
  const month=ukToday(now).slice(0,7);
  const averages=(['uk','us'] as const).map(w=>{
    const rows=parcels.filter(p=>p.warehouse===w&&despatchDay(p).startsWith(month));
    return {warehouse:w,count:rows.length,currency:w==='uk'?'GBP':'USD',exportedMinor:rows.length?rows.reduce((s,p)=>s+p.postageMinor+p.pickPackMinor,0)/rows.length:null,gbpPence:rows.length?rows.reduce((s,p)=>s+actualPence(p)!,0)/rows.length:null};
  });
  const needs=parcels.flatMap(p=>p.flags.map(flag=>({id:`parcel:${p.id}:${flag}`,title:flag,why:`Order #${p.orderNumber} · ${p.centre} · ${p.service}`,link:'/fulfilment'})));
  if (weeklyReminder(now,uploads)) needs.unshift({id:'jj-weekly',title:"Upload last week's J&J export",why:'Monday 09:00 UK: confirm a complete export for the previous Monday–Sunday.',link:'/fulfilment'});
  return {mode,averages,lastUpload:uploads[0]??null,unmatched:parcels.filter(p=>!p.orderId),needs,model,recent:parcels.slice(-20).reverse().map(p=>({...p,actualPence:actualPence(p)})),orderCount:orders.length};
}
export async function readEstimates(db:Database,mode:SourceMode):Promise<(Estimate&{orderId:string})[]> {
  return (await db.query<any>('SELECT * FROM pulse.fulfilment_estimates WHERE mode=$1',[mode])).rows.map(r=>({orderId:r.order_id,costPence:r.cost_pence===null?null:Number(r.cost_pence),source:r.source,warehouse:r.warehouse,service:r.service,guess:r.guess}));
}
