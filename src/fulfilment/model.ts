import { appConfig } from '../config.js';
import type { Settings } from '../settings.js';
import type { Order } from '../shopify/model.js';
import { addDays, ukToday } from '../hero-range.js';
import type { ParcelRow, Warehouse } from './parser.js';

export interface Parcel extends ParcelRow {
  id: string; orderId: string | null; gbpPerUsd: number; uploadId: string;
  replacedEstimatePence: number | null; rateBaselinePence: number | null; flags: string[];
}
export interface Rate {
  warehouse: Warehouse; service: string; mix: string; state: string;
  postage: number; pickPack: number; count: number; lastSeen: string;
}
export interface Fit { base: number; coefficients: Record<string,number>; count: number }
export interface WarehouseModel {
  service: string; ladder: Fit; weight: Fit; flatPostage: number;
  bands: { band: number; postage: number; count: number }[];
}
export interface Model { rates: Rate[]; warehouses: Partial<Record<'uk'|'us', WarehouseModel>> }
export interface Estimate {
  costPence: number | null; source: 'actual'|'exact'|'ladder'|'flat'|'unknown';
  warehouse: Warehouse; service: string | null; guess: boolean;
}
export const emptyModel = (): Model => ({ rates: [], warehouses: {} });
export function destination(country: string | null): Warehouse {
  const value = country?.trim().toUpperCase() ?? '';
  if (['GB','UK','JE','GG','IM','UNITED KINGDOM','JERSEY','GUERNSEY','ISLE OF MAN'].includes(value)) return 'uk';
  return ['US','UNITED STATES','UNITED STATES OF AMERICA'].includes(value) ? 'us' : 'unknown';
}
export function warehouseFor(order: Order): Warehouse {
  const locations = [...new Set(order.fulfillments.filter(f => f.status === 'SUCCESS').map(f => f.locationId))];
  if (locations.length) return locations.length === 1 ? locations[0] === appConfig.shopify.locations.uk.id ? 'uk' : locations[0] === appConfig.shopify.locations.us.id ? 'us' : 'unknown' : 'unknown';
  if (['FULFILLED','PARTIALLY_FULFILLED'].includes(order.fulfillmentStatus)) return 'unknown';
  return destination(order.country) !== 'unknown' ? destination(order.country) : order.country ? 'unknown' : order.market === 'UK' ? 'uk' : order.market === 'US' ? 'us' : 'unknown';
}
export function quantities(order: Order): Record<string,number> | null {
  if (!order.lines.length || order.lines.some(l => !l.sku || !Number.isInteger(l.quantity) || l.quantity <= 0)) return null;
  const counts: Record<string,number> = Object.create(null);
  for (const line of order.lines) counts[line.sku!] = (counts[line.sku!] ?? 0) + line.quantity;
  return counts;
}
export const mixKey = (q: Record<string,number>) => JSON.stringify(Object.entries(q).sort(([a],[b]) => a.localeCompare(b,'en')));
export const gbpMinor = (value: number, currency: ParcelRow['currency'], rate: number): number | null => currency === 'GBP' ? Math.round(value) : currency === 'USD' ? Math.round(value * rate) : null;
export const actualPence = (p: Parcel) => gbpMinor(p.postageMinor + p.pickPackMinor, p.currency, p.gbpPerUsd);
/** Export timestamps are warehouse wall times; dashboard month boundaries are UK days. */
export function despatchDay(p: ParcelRow): string {
  const target = Date.parse(p.despatchedAt.replace(' ', 'T') + 'Z');
  const zone = p.warehouse === 'us' ? appConfig.fulfilment.us.timezone : appConfig.fulfilment.uk.timezone;
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  let instant = target;
  for (let i = 0; i < 3; i++) {
    const parts = formatter.formatToParts(new Date(instant));
    const part = (key: string) => Number(parts.find(p => p.type === key)!.value);
    const local = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
    instant += target - local;
  }
  return ukToday(new Date(instant));
}

export function knownService(_warehouse: Warehouse, service: string): boolean {
  return Object.values(appConfig.fulfilment.knownServices).flat().some(s => s.toLowerCase() === service.toLowerCase()) || /^FedEx\b.*\bIOSS\b/i.test(service);
}
// Pivoted normal equations; dependent SKU columns get a deterministic zero coefficient.
// This is ordinary least squares, with no invented product weights or ridge prior.
export function leastSquares(rows: { x: Record<string,number>; y: number }[]): Fit {
  if (!rows.length) return { base:0, coefficients:{}, count:0 };
  const keys = [...new Set(rows.flatMap(r => Object.keys(r.x)))].sort();
  const vectors = rows.map(r => [1,...keys.map(k => r.x[k] ?? 0)]), n = keys.length + 1;
  const a = Array.from({length:n},(_,i) => [...Array.from({length:n},(_,j) => vectors.reduce((s,x) => s+x[i]!*x[j]!,0)), rows.reduce((s,r,k) => s+vectors[k]![i]!*r.y,0)]);
  let pivot = 0; const pivots: number[] = [];
  for (let col=0; col<n && pivot<n; col++) {
    let best=pivot;
    for (let i=pivot+1;i<n;i++) if (Math.abs(a[i]![col]!)>Math.abs(a[best]![col]!)) best=i;
    if (Math.abs(a[best]![col]!)<1e-8) continue;
    [a[pivot],a[best]]=[a[best]!,a[pivot]!];
    const scale=a[pivot]![col]!;
    for (let j=col;j<=n;j++) a[pivot]![j]!/=scale;
    for (let i=0;i<n;i++) if (i!==pivot) { const factor=a[i]![col]!; for (let j=col;j<=n;j++) a[i]![j]!-=factor*a[pivot]![j]!; }
    pivots.push(col); pivot++;
  }
  const b=Array<number>(n).fill(0);
  pivots.forEach((col,i) => b[col]=a[i]![n]!);
  return { base:b[0]!, coefficients:Object.fromEntries(keys.map((k,i)=>[k,b[i+1]!])), count:rows.length };
}
export const predict = (fit: Fit, q: Record<string,number>) => fit.base + Object.entries(q).reduce((s,[k,v]) => s+v*(fit.coefficients[k] ?? 0),0);
const mean = (a: number[]) => a.reduce((s,n)=>s+n,0)/a.length;
const bandFor = (grams: number) => Math.ceil(Math.max(1,grams)/500)*500;
export function learn(parcels: readonly Parcel[], orders: readonly Order[]): Model {
  const byId = new Map(orders.map(o=>[o.id,o]));
  const usable = parcels.flatMap(p => {
    const o = p.orderId ? byId.get(p.orderId) : undefined, q=o && quantities(o);
    return o && q && p.warehouse !== 'unknown' && knownService(p.warehouse,p.service) && (p.warehouse !== 'us' || o.region) ? [{p,o,q,items:Object.values(q).reduce((a,b)=>a+b,0)}] : [];
  });
  const groups = new Map<string,typeof usable>();
  for (const row of usable) {
    const key=JSON.stringify([row.p.warehouse,row.p.service,mixKey(row.q),row.p.warehouse==='us'?row.o.region:'']);
    groups.set(key,[...(groups.get(key)??[]),row]);
  }
  const rates: Rate[] = [...groups.values()].map(rows=>({warehouse:rows[0]!.p.warehouse,service:rows[0]!.p.service,mix:mixKey(rows[0]!.q),state:rows[0]!.p.warehouse==='us'?rows[0]!.o.region!:'',postage:mean(rows.map(r=>r.p.postageMinor)),pickPack:mean(rows.map(r=>r.p.pickPackMinor)),count:rows.length,lastSeen:rows.map(r=>r.p.despatchedAt).sort().at(-1)!}));
  const warehouses: Model['warehouses'] = {};
  for (const w of ['uk','us'] as const) {
    const all=usable.filter(r=>r.p.warehouse===w);
    if (!all.length) continue;
    const counts=new Map<string,number>(); all.forEach(r=>counts.set(r.p.service,(counts.get(r.p.service)??0)+1));
    const service=[...counts].sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0]))[0]![0];
    const usual=all.filter(r=>r.p.service===service), bands=new Map<number,typeof usual>();
    usual.forEach(r=>{const b=bandFor(r.p.boxedGrams);bands.set(b,[...(bands.get(b)??[]),r]);});
    warehouses[w]={service,ladder:leastSquares(all.map(r=>({x:{items:r.items},y:r.p.pickPackMinor}))),weight:leastSquares(all.map(r=>({x:r.q,y:r.p.boxedGrams/1000}))),flatPostage:mean(usual.map(r=>r.p.postageMinor)),bands:[...bands].map(([band,rows])=>({band,postage:mean(rows.map(r=>r.p.postageMinor)),count:rows.length}))};
  }
  return {rates,warehouses};
}
export function estimateOrder(order: Order, parcels: readonly Parcel[], model: Model, settings: Settings): Estimate {
  const actuals=parcels.filter(p=>p.orderId===order.id);
  const warehouse=warehouseFor(order);
  const result=(source: Estimate['source'],costPence:number|null,service:string|null=null,guess=true): Estimate=>({source,costPence,warehouse,service,guess});
  if (actuals.length) {
    const costs=actuals.map(actualPence);
    return result(costs.some(c=>c===null)?'unknown':'actual',costs.some(c=>c===null)?null:costs.reduce<number>((s,n)=>s+n!,0),null,false);
  }
  if (warehouse==='unknown') return result('unknown',null);
  const m=model.warehouses[warehouse];
  if (!m) { const flat=warehouse==='uk'?settings.flatFulfilmentUkGbp:settings.flatFulfilmentUsGbp; return result(flat===null?'unknown':'flat',flat===null?null:Math.round(flat*100)); }
  const q=quantities(order);
  if (!q) return result('unknown',null,m.service);
  const exact=model.rates.find(r=>r.warehouse===warehouse&&r.service===m.service&&r.mix===mixKey(q)&&r.state===(warehouse==='us'?order.region:''));
  if (exact) return result('exact',gbpMinor(exact.postage+exact.pickPack,warehouse==='us'?'USD':'GBP',settings.jjGbpPerUsd),m.service,false);
  const items=Object.values(q).reduce((a,b)=>a+b,0);
  let postage=m.flatPostage;
  if (warehouse==='us') {
    if (!order.region || Object.keys(q).some(k=>!Object.hasOwn(m.weight.coefficients,k))) return result('unknown',null,m.service);
    const band=m.bands.find(b=>b.band===bandFor(Math.max(0,predict(m.weight,q))*1000));
    if (!band) return result('unknown',null,m.service);
    postage=band.postage;
  }
  return result('ladder',gbpMinor(Math.max(0,predict(m.ladder,{items}))+postage,warehouse==='us'?'USD':'GBP',settings.jjGbpPerUsd),m.service);
}
export function parcelFlags(p: Parcel, order: Order | undefined, model: Model): string[] {
  const flags: string[]=[];
  if (!knownService(p.warehouse,p.service)) flags.push('Unknown service');
  if (p.warehouse==='unknown') flags.push('Unknown fulfilment centre');
  const expected=destination(order?.country??p.country);
  if (expected!=='unknown'&&p.warehouse!==expected) flags.push('Wrong warehouse for destination');
  const actual=actualPence(p);
  if (actual!==null&&p.rateBaselinePence!==null&&p.rateBaselinePence>0&&Math.abs(actual-p.rateBaselinePence)/p.rateBaselinePence>.25) flags.push('Cost more than 25% off its rate');
  const q=order&&quantities(order), m=p.warehouse==='unknown'?undefined:model.warehouses[p.warehouse];
  if (q&&m) {
    const expectedPick=Math.max(0,predict(m.ladder,{items:Object.values(q).reduce((a,b)=>a+b,0)}));
    if (expectedPick>0&&p.pickPackMinor>expectedPick*1.25) flags.push('Possible new surcharge');
  }
  return flags;
}
export function priorWeek(now: Date): { from:string; to:string } {
  const today=ukToday(now), weekday=new Date(today+'T12:00:00Z').getUTCDay(), monday=addDays(today,-((weekday+6)%7));
  return {from:addDays(monday,-7),to:addDays(monday,-1)};
}
export function weeklyReminder(now: Date, uploads: readonly { despatchFrom:string;despatchTo:string;coverageWeek?:string|null }[]): boolean {
  const today=ukToday(now), weekday=new Date(today+'T12:00:00Z').getUTCDay(), monday=addDays(today,-((weekday+6)%7));
  const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',hour:'2-digit',hourCycle:'h23'}).format(now));
  if (today===monday&&hour<9) return false;
  const from=addDays(monday,-7), to=addDays(monday,-1);
  return !uploads.some(u=>u.coverageWeek===from || u.despatchFrom.slice(0,10)<=from&&u.despatchTo.slice(0,10)>=to);
}
