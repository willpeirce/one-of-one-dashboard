import {addDays,aggregateDays,cpo,ukToday,type DailyMetrics} from '../hero-range.js';
import type {Settings} from '../settings.js';
import type {MetaActivity} from '../meta-adsets/activity.js';
import type {SpendFacts} from './store.js';
import {placedSpendRows} from './metrics.js';
import {needsMarketName,spendMarket} from './placement.js';
import {formatPounds} from '../money.js';

/** Read-only observations: these rules have no source or Settings writer. */
export function metaRisks(facts:SpendFacts,days:DailyMetrics[],events:MetaActivity[],settings:Settings,today:string) {
  const needs:{id:string;state:'warn';title:string;why:string;link:string}[]=[];
  if(facts.mode!=='live')return needs;
  const add=(id:string,title:string,why:string,link='/ads')=>{if(!needs.some(n=>n.id===id))needs.push({id,state:'warn',title,why,link});};
  const from=addDays(today,-3),to=addDays(today,-1);
  const placed=placedSpendRows(facts,from,to,today).filter(r=>r.source==='meta');
  const selected=days.filter(d=>d.date>=from&&d.date<=to).map(d=>({...d,
    ukM:placed.filter(r=>r.day===d.date&&r.market==='uk').reduce((n,r)=>n+Number(r.amount),0),
    usM:placed.filter(r=>r.day===d.date&&r.market==='us').reduce((n,r)=>n+Number(r.amount),0)}));
  if(selected.length===3&&selected.every(d=>d.countsKnown!==false&&facts.days.some(r=>r.source==='meta'&&r.day===d.date))) {
    const totals=aggregateDays(selected);
    for(const market of ['uk','us'] as const){
      const value=cpo(totals,selected,market==='uk'?'ukcpo':'uscpo',settings.blendedMetaTripwireGbp).value;
      if(totals[market==='uk'?'ukM':'usM']>0&&value>settings.blendedMetaTripwireGbp)
        add(`meta-cpo:${market}`,`${market.toUpperCase()} Meta cost per order over the bar`,`${formatPounds(value)} over ${from}–${to}; bar ${formatPounds(settings.blendedMetaTripwireGbp)}. Shopify orders, all Meta owners.`);
    }
  }
  const recent=facts.rows.filter(r=>r.source==='meta'&&r.day>=addDays(today,-6)&&r.day<=today&&Number(r.amount)>0);
  for(const row of recent){
    if(!settings.metaOwners.some(o=>o.campaignId===row.campaignId))add(`meta-unassigned:${row.campaignId}`,`Meta campaign unassigned: ${row.campaignName}`,'Spent in the last 7 UK days. Assign its owner in Settings.','/settings');
    if(needsMarketName(row)&&(row.targetCountries?.length??0)>0)add(`meta-name:${row.adSetId}`,`Add ${spendMarket(row)==='unknown'?'UK or US':spendMarket(row).toUpperCase()} to the ad-set name`,`${row.adSetName}: ${spendMarket(row)==='unknown'?'target countries do not identify one market':'placed from its target countries'}. Review the name in Meta; this card makes no change.`);
  }
  for(const event of events){
    if(ukToday(new Date(event.time))<addDays(today,-6)||ukToday(new Date(event.time))>today||settings.ourActors.some(a=>a.actorId===event.actorId)||!event.type.endsWith('_budget')||event.oldPence===null||event.newPence===null)continue;
    const change=Math.abs(event.newPence-event.oldPence);
    if(change*5>event.oldPence)add(`meta-budget:${event.id}`,`Budget changed by more than 20%: ${event.object}`,`${event.old} → ${event.value} · ${event.actor||event.actorId} · ${event.app}. Review only, including freelancer campaigns.`);
  }
  return needs;
}
