import type {DialModel,HeroMarket,State} from '../dashboard-types.js';
import {addDays} from '../hero-range.js';
import type {Settings} from '../settings.js';
import {countedOrder} from '../shopify/metrics.js';
import type {Order} from '../shopify/model.js';
import type {SpendFacts} from './store.js';
import {spendMarket} from './placement.js';
import {formatNumber} from '../money.js';
export const attributionZone=(value:number):State=>value<=1.5?'good':value<=1.8?'warn':'alarm';
export function metaAttribution(facts:SpendFacts,orders:Order[],settings:Settings,today:string,market:HeroMarket) {
  const from=addDays(today,-14),to=addDays(today,-1);
  const rows=facts.rows.filter(r=>r.source==='meta'&&r.day>=from&&r.day<=to&&(market==='all'||spendMarket(r)===market));
  const selected=orders.filter(o=>o.day>=from&&o.day<=to&&countedOrder(o,market));
  const sources=new Set(settings.metaSources.map(s=>s.source.toLowerCase()));
  const attributed=selected.filter(o=>o.lastVisit?.fbclid||sources.has(String(o.lastVisit?.source??'').toLowerCase()));
  const purchases=rows.reduce((n,r)=>n+(r.purchases??0),0),count=attributed.length;
  const ratio=count? purchases/count:null;
  const other=new Map<string,number>();
  for(const order of selected.filter(o=>!attributed.includes(o))) {
    const source=String(order.lastVisit?.source??'(none)').toLowerCase();other.set(source,(other.get(source)??0)+1);
  }
  const owners=(['ours','freelancer','unassigned'] as const).map(owner=>{
    const ownerFor=(id:string)=>settings.metaOwners.find(r=>r.campaignId===id)?.owner??'unassigned';
    const ids=new Set([...settings.metaOwners.filter(r=>r.owner===owner).map(r=>r.campaignId),...rows.filter(r=>ownerFor(r.campaignId)===owner).map(r=>r.campaignId)]);
    const matches=selected.filter(o=>ids.has(String(o.lastVisit?.campaign??''))).length;
    const claims=rows.filter(r=>ownerFor(r.campaignId)===owner).reduce((n,r)=>n+(r.purchases??0),0);
    return {owner,purchases:claims,orders:matches|| (ratio&&ratio>0?claims/ratio:null),estimated:matches===0};
  });
  const source=facts.sources.find(s=>s.source==='meta');
  const complete=source?.live&&source.ready&&!source.stale&&!source.failures&&rows.every(r=>r.purchases!=null)
    &&Array.from({length:14},(_,i)=>addDays(from,i)).every(day=>facts.days.some(d=>d.source==='meta'&&d.day===day));
  return {from,to,purchases,count,ratio,owners,complete:Boolean(complete),other:[...other].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,5)};
}
export function attributionDial(facts:SpendFacts,orders:Order[],settings:Settings,today:string,market:HeroMarket,shopifyComplete:boolean):DialModel {
  const data=metaAttribution(facts,orders,settings,today,market),value=data.complete&&shopifyComplete?data.ratio:null;
  return {v:value??0,min:0,max:Math.max(3,value??0),t:value===null?'No data':`${formatNumber(value,2)}×`,l:'Meta over-credit',
    s:`${market==='all'?'All markets':market.toUpperCase()} · last 14 complete UK days`,hidePointer:value===null,cap:value===null?'info':attributionZone(value),
    z:[[0,1.5,'good'],[1.5,1.8,'warn'],[1.8,Math.max(3,value??0),'alarm']],
    d:{why:`Meta says ${formatNumber(data.purchases)} purchases · Shopify saw ${formatNumber(data.count)} orders from Meta ads${!data.complete||!shopifyComplete?' · history incomplete':''}`,
      rule:'Meta purchases ÷ counted Shopify orders with a last-visit fbclid or a configured Meta source. Good to 1.5×, warn to 1.8×, alarm above.',src:'Live Meta + Shopify',
      extra:[['Window',`${data.from}–${data.to} · complete UK days`],...data.owners.map(o=>[o.owner,`${formatNumber(o.purchases)} Meta purchases · ${o.orders===null?'unavailable':formatNumber(o.orders,2)} Shopify orders${o.estimated?' · estimated':''}`] as [string,string]),
        ...data.other.map(([source,count])=>[`Other lastVisit source: ${source}`,`${count} orders`] as [string,string])]}};
}
