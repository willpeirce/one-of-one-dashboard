import type {DialModel,HeroMarket,State} from '../dashboard-types.js';
import {addDays} from '../hero-range.js';
import type {Settings} from '../settings.js';
import {countedOrder} from '../shopify/metrics.js';
import type {Order} from '../shopify/model.js';
import type {SpendFacts} from './store.js';
import {spendMarket} from './placement.js';
import {formatNumber} from '../money.js';
import {appConfig} from '../config.js';
export const attributionZone=(value:number):State=>value<=1.5?'good':value<=1.8?'warn':'alarm';
export function metaAttribution(facts:SpendFacts,orders:Order[],settings:Settings,today:string,market:HeroMarket) {
  const from=addDays(today,-14),to=addDays(today,-1);
  const rows=facts.rows.filter(r=>r.source==='meta'&&r.day>=from&&r.day<=to&&(market==='all'||spendMarket(r)===market));
  const selected=orders.filter(o=>o.day>=from&&o.day<=to&&countedOrder(o,market));
  const sources=new Set(settings.metaSources.map(s=>s.source.toLowerCase()));
  const attributed=selected.filter(o=>o.lastVisit?.fbclid||sources.has(String(o.lastVisit?.source??'').toLowerCase()));
  const purchases=rows.every(r=>r.purchases!=null)?rows.reduce((n,r)=>n+r.purchases!,0):null,count=attributed.length;
  const source=facts.sources.find(s=>s.source==='meta');
  const complete=Boolean(source?.live&&source.ready&&!source.stale&&!source.failures&&purchases!==null
    &&Array.from({length:14},(_,i)=>addDays(from,i)).every(day=>facts.days.some(d=>d.source==='meta'&&d.day===day)));
  const ratio=complete&&count&&purchases!==null? purchases/count:null;
  const other=new Map<string,number>();
  for(const order of selected.filter(o=>!attributed.includes(o))) {
    const source=String(order.lastVisit?.source??'(none)').toLowerCase();other.set(source,(other.get(source)??0)+1);
  }
  const owners=(['ours','freelancer','unassigned'] as const).map(owner=>{
    const ownerFor=(id:string)=>settings.metaOwners.find(r=>r.campaignId===id)?.owner??'unassigned';
    const ids=new Set([...settings.metaOwners.filter(r=>r.owner===owner).map(r=>r.campaignId),...rows.filter(r=>ownerFor(r.campaignId)===owner).map(r=>r.campaignId)]);
    const matches=selected.filter(o=>ids.has(String(o.lastVisit?.campaign??''))).length;
    const ownerRows=rows.filter(r=>ownerFor(r.campaignId)===owner);
    const claims=ownerRows.every(r=>r.purchases!=null)?ownerRows.reduce((n,r)=>n+r.purchases!,0):null;
    const expected=ratio!==null&&ratio>0&&claims!==null?claims/ratio:null;
    const estimated=expected!==null&&matches<expected*appConfig.adAttribution.ownerMatchMinimumShare;
    return {owner,purchases:claims,matches,orders:estimated?expected:matches||expected,estimated};
  });
  return {from,to,purchases,count,ratio,owners,complete:Boolean(complete),other:[...other].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,5)};
}
export function attributionDial(facts:SpendFacts,orders:Order[],settings:Settings,today:string,market:HeroMarket,shopifyComplete:boolean):DialModel {
  const data=metaAttribution(facts,orders,settings,today,market),value=data.complete&&shopifyComplete?data.ratio:null;
  return {v:value??0,min:0,max:Math.max(3,value??0),t:value===null?'No data':`${formatNumber(value,2)}×`,l:'Meta over-credit',
    s:`${market==='all'?'All markets':market.toUpperCase()} · last 14 complete UK days`,hidePointer:value===null,cap:value===null?'info':attributionZone(value),
    z:[[0,1.5,'good'],[1.5,1.8,'warn'],[1.8,Math.max(3,value??0),'alarm']],
    d:{why:`${data.purchases===null?'Meta purchases unavailable':`Meta says ${formatNumber(data.purchases)} purchases`} · Shopify saw ${formatNumber(data.count)} orders from Meta ads${!data.complete||!shopifyComplete?' · history incomplete':''}`,
      rule:`Meta purchases ÷ counted Shopify orders with a last-visit fbclid or a configured Meta source. Good to 1.5×, warn to 1.8×, alarm above. Owner orders use Meta purchases divided by this ratio when campaign-ID matches are below ${formatNumber(appConfig.adAttribution.ownerMatchMinimumShare*100)}% of that estimate; matched orders remain disclosed.`,src:'Live Meta + Shopify',
        extra:[['Window',`${data.from}–${data.to} · complete UK days`],...data.owners.map(o=>[o.owner,`${o.purchases===null?'Meta purchases unavailable':`${formatNumber(o.purchases)} Meta purchases`} · ${o.orders===null?'unavailable':formatNumber(o.orders,o.estimated?2:0)} Shopify orders${o.estimated?` · estimated (${formatNumber(o.matches)} campaign-ID ${o.matches===1?'match':'matches'})`:''}`] as [string,string]),
        ...data.other.map(([source,count])=>[`Other lastVisit source: ${source}`,`${count} ${count===1?'order':'orders'}`] as [string,string])]}};
}
