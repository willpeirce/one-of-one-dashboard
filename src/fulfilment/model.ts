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

export const normaliseService = (service: string) => service.replace(/\s/g, '').toLowerCase();

export function knownService(_warehouse: Warehouse, service: string): boolean {
  return Object.values(appConfig.fulfilment.knownServices).flat().some(s => normaliseService(s) === normaliseService(service)) || /^FedEx\b.*\bIOSS\b/i.test(service);
}
// Pivoted normal equations; dependent SKU columns get a deterministic zero coefficient.
// This is ordinary least squares, with no invented product weights or ridge prior.
export function leastSquares(rows: { x: Record<string,number>; y: number }[]): Fit {
  if (!rows.length) return { base:0, coefficients:{}, count:0 };
  const keys = [...new Set(rows.flatMap(r => Object.keys(r.x)))].sort();
  const vectors = rows.map(r => [1,...keys.map(k => r.x[k] ?? 0)]), n = keys.length + 1;
  const a = Array.from({length:n},(_,i) => [...Array.from({length:n},(_,j) => vectors.reduce((s,x) => s+x[i]!*x[j]!,0)), rows.reduce((s,r,k) => s+vectors[k]![i]!*r.y,0)]);
  return solveFit(a, keys, rows.length);
}
function solveFit(a: number[][], keys: string[], count: number): Fit {
  const n = keys.length + 1;
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
  return { base:b[0]!, coefficients:Object.fromEntries(keys.map((k,i)=>[k,b[i+1]!])), count };
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
    const key=JSON.stringify([row.p.warehouse,normaliseService(row.p.service),mixKey(row.q),row.p.warehouse==='us'?row.o.region:'']);
    if (!groups.has(key)) groups.set(key,[]);
    groups.get(key)!.push(row);
  }
  const rates: Rate[] = [...groups.values()].map(rows=>({warehouse:rows[0]!.p.warehouse,service:rows[0]!.p.service,mix:mixKey(rows[0]!.q),state:rows[0]!.p.warehouse==='us'?rows[0]!.o.region!:'',postage:mean(rows.map(r=>r.p.postageMinor)),pickPack:mean(rows.map(r=>r.p.pickPackMinor)),count:rows.length,lastSeen:rows.map(r=>r.p.despatchedAt).sort().at(-1)!}));
  const warehouses: Model['warehouses'] = {};
  for (const w of ['uk','us'] as const) {
    const all=usable.filter(r=>r.p.warehouse===w);
    if (!all.length) continue;
    const counts=new Map<string,number>(); all.forEach(r=>counts.set(normaliseService(r.p.service),(counts.get(normaliseService(r.p.service))??0)+1));
    const serviceKey=[...counts].sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0]))[0]![0];
    const usual=all.filter(r=>normaliseService(r.p.service)===serviceKey), service=usual[0]!.p.service, bands=new Map<number,typeof usual>();
    usual.forEach(r=>{const b=bandFor(r.p.boxedGrams);if (!bands.has(b)) bands.set(b,[]);bands.get(b)!.push(r);});
    warehouses[w]={service,ladder:leastSquares(all.map(r=>({x:{items:r.items},y:r.p.pickPackMinor}))),weight:leastSquares(all.map(r=>({x:r.q,y:r.p.boxedGrams/1000}))),flatPostage:mean(usual.map(r=>r.p.postageMinor)),bands:[...bands].map(([band,rows])=>({band,postage:mean(rows.map(r=>r.p.postageMinor)),count:rows.length}))};
  }
  return {rates,warehouses};
}
// Sufficient statistics let us subtract one training row without refitting its peers.
// Cost is linear in parcels for a fixed SKU/service vocabulary, including large groups.
function fitWithout(rows: { x: Record<string,number>; y: number }[]) {
  const keys = [...new Set(rows.flatMap(r => Object.keys(r.x)))].sort();
  const uses = keys.map(k => rows.filter(r => Object.hasOwn(r.x,k)).length);
  const n = keys.length + 1;
  const sums = Array.from({length:n}, () => Array<number>(n+1).fill(0));
  for (const r of rows) {
    const x = [1,...keys.map(k => r.x[k] ?? 0)];
    for (let i=0;i<n;i++) {
      for (let j=0;j<n;j++) sums[i]![j]! += x[i]! * x[j]!;
      sums[i]![n]! += x[i]! * r.y;
    }
  }
  return (excluded?: {x:Record<string,number>;y:number}): Fit => {
    const count = rows.length - (excluded ? 1 : 0);
    if (!count) return {base:0,coefficients:{},count:0};
    const indices = [0,...keys.flatMap((k,i) => uses[i]! - (excluded && Object.hasOwn(excluded.x,k) ? 1 : 0) > 0 ? [i+1] : [])];
    const x = excluded ? [1,...keys.map(k => excluded.x[k] ?? 0)] : Array<number>(n).fill(0);
    const a = indices.map(i => [...indices.map(j => sums[i]![j]! - x[i]!*x[j]!), sums[i]![n]! - x[i]!*(excluded?.y ?? 0)]);
    return solveFit(a, indices.slice(1).map(i => keys[i-1]!), count);
  };
}
export function leaveOneOutModels(parcels: readonly Parcel[], orders: readonly Order[]): (parcel: Parcel) => Model {
  const byId = new Map(orders.map(o => [o.id,o]));
  const usable = parcels.flatMap(p => {
    const o = p.orderId ? byId.get(p.orderId) : undefined, q = o && quantities(o);
    return o && q && p.warehouse !== 'unknown' && knownService(p.warehouse,p.service) && (p.warehouse !== 'us' || o.region)
      ? [{p,o,q,items:Object.values(q).reduce((a,b)=>a+b,0)}] : [];
  });
  const byParcel = new Map(usable.map(r => [r.p.id,r]));
  const key = (w: Warehouse, service: string, mix: string, state: string) => JSON.stringify([w,normaliseService(service),mix,state]);
  const groups = new Map<string,{rate:Rate;postage:number;pickPack:number}>();
  for (const r of usable) {
    const k=key(r.p.warehouse,r.p.service,mixKey(r.q),r.p.warehouse==='us'?r.o.region!:'');
    let g=groups.get(k);
    if (!g) {
      g={rate:{warehouse:r.p.warehouse,service:r.p.service,mix:mixKey(r.q),state:r.p.warehouse==='us'?r.o.region!:'',postage:0,pickPack:0,count:0,lastSeen:r.p.despatchedAt},postage:0,pickPack:0};
      groups.set(k,g);
    }
    g.rate.count++;g.postage+=r.p.postageMinor;g.pickPack+=r.p.pickPackMinor;
  }
  const warehouses = new Map((['uk','us'] as const).map(w => {
    const rows=usable.filter(r=>r.p.warehouse===w);
    const services = new Map<string,{service:string;count:number;postage:number;bands:Map<number,{count:number;postage:number}>}>();
    for (const {p} of rows) {
      const k=normaliseService(p.service);
      if (!services.has(k)) services.set(k,{service:p.service,count:0,postage:0,bands:new Map()});
      const service=services.get(k)!;service.count++;service.postage+=p.postageMinor;
      const b=bandFor(p.boxedGrams),band=service.bands.get(b)??{count:0,postage:0};
      band.count++;band.postage+=p.postageMinor;service.bands.set(b,band);
    }
    return [w,{rows:rows.length,services,ladder:fitWithout(rows.map(r=>({x:{items:r.items},y:r.p.pickPackMinor}))),weight:fitWithout(rows.map(r=>({x:r.q,y:r.p.boxedGrams/1000})))}] as const;
  }));
  return p => {
    const model=emptyModel(), excluded=byParcel.get(p.id), o=p.orderId?byId.get(p.orderId):undefined, q=o&&quantities(o);
    if (p.warehouse==='unknown') return model;
    const w=warehouses.get(p.warehouse)!;
    const counts=[...w.services].map(([k,s])=>({k,s,count:s.count-(excluded&&normaliseService(p.service)===k?1:0)})).filter(s=>s.count>0).sort((a,b)=>b.count-a.count||a.k.localeCompare(b.k));
    const usual=counts[0];
    if (usual) {
      const subtract=!!excluded&&normaliseService(p.service)===usual.k;
      model.warehouses[p.warehouse]={service:usual.s.service,
        ladder:w.ladder(excluded?{x:{items:excluded.items},y:p.pickPackMinor}:undefined),
        weight:w.weight(excluded?{x:excluded.q,y:p.boxedGrams/1000}:undefined),
        flatPostage:(usual.s.postage-(subtract?p.postageMinor:0))/usual.count,
        bands:[...usual.s.bands].flatMap(([band,b])=>{
          const remove=subtract&&bandFor(p.boxedGrams)===band, count=b.count-(remove?1:0);
          return count?[{band,count,postage:(b.postage-(remove?p.postageMinor:0))/count}]:[];
        })};
    }
    // Only these two groups can be read by the parcel baseline/fallback calculation.
    if (q) for (const service of new Set([normaliseService(p.service),usual?.k].filter((k):k is string=>!!k))) {
      const k=key(p.warehouse,service,mixKey(q),p.warehouse==='us'?o!.region??'':'');
      const g=groups.get(k);if (!g) continue;
      const remove=!!excluded&&k===key(p.warehouse,p.service,mixKey(excluded.q),p.warehouse==='us'?excluded.o.region!:'');
      const count=g.rate.count-(remove?1:0);
      if (count) model.rates.push({...g.rate,count,postage:(g.postage-(remove?p.postageMinor:0))/count,pickPack:(g.pickPack-(remove?p.pickPackMinor:0))/count});
    }
    return model;
  };
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
  const exact=model.rates.find(r=>r.warehouse===warehouse&&normaliseService(r.service)===normaliseService(m.service)&&r.mix===mixKey(q)&&r.state===(warehouse==='us'?order.region:''));
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
  if (!knownService(p.warehouse,p.service)) return flags;
  const actual=actualPence(p);
  if (actual!==null&&p.rateBaselinePence!==null&&p.rateBaselinePence>0&&Math.abs(actual-p.rateBaselinePence)/p.rateBaselinePence>.25) flags.push('Cost more than 25% off its rate');
  const q=order&&quantities(order), m=p.warehouse==='unknown'?undefined:model.warehouses[p.warehouse];
  if (q&&m) {
    const expectedPick=Math.max(0,predict(m.ladder,{items:Object.values(q).reduce((a,b)=>a+b,0)}));
    if (expectedPick>0&&p.pickPackMinor>expectedPick*1.25) flags.push('Possible new surcharge');
  }
  return flags;
}
export function monthlyReminder(now: Date, uploads: readonly { coverageFrom:string|null; coverageTo:string|null }[]): boolean {
  const today=ukToday(now), first=today.slice(0,7)+'-01';
  let workingDay=first;
  while ([0,6].includes(new Date(workingDay+'T12:00:00Z').getUTCDay())) workingDay=addDays(workingDay,1);
  const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',hour:'2-digit',hourCycle:'h23'}).format(now));
  if (today<workingDay || today===workingDay&&hour<9) return false;
  const to=addDays(first,-1), from=to.slice(0,7)+'-01';
  let uncovered=from;
  const ranges=uploads.filter((u):u is {coverageFrom:string;coverageTo:string}=>u.coverageFrom!==null&&u.coverageTo!==null).sort((a,b)=>a.coverageFrom.localeCompare(b.coverageFrom));
  for (const range of ranges) {
    if (range.coverageFrom>uncovered) break;
    if (range.coverageTo>=uncovered) uncovered=addDays(range.coverageTo,1);
    if (uncovered>to) return false;
  }
  return true;
}
