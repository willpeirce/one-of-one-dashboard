import type {DashboardNeed} from '../shopify/dashboard.js';
import {addDays,aggregateDays,cpo,ukToday,type DailyMetrics} from '../hero-range.js';
import type {Settings} from '../settings.js';
import type {MetaActivity} from '../meta-adsets/activity.js';
import type {SpendFacts} from './store.js';
import {placedSpendRows} from './metrics.js';
import {needsMarketName,spendMarket} from './placement.js';
import {formatNumber,formatPounds} from '../money.js';
import type { GoogleFacts, GoogleFlagDetail, GoogleJobKind } from '../google-ads/model.js';
import { googleCampaignMarket, googleCovers, googleNetworkName, googleNetworkTotals } from '../google-ads/metrics.js';

/** Read-only observations: these rules have no source or Settings writer. */
export function metaRisks(facts:SpendFacts,days:DailyMetrics[],events:MetaActivity[],settings:Settings,today:string) {
  const needs:DashboardNeed[]=[];
  if(facts.mode!=='live')return needs;
  const add=(id:string,title:string,why:string,link='/ads',figure?:DashboardNeed['figure'])=>{if(!needs.some(n=>n.id===id))needs.push({id,state:'warn',source:'meta',title,why,link,...(figure ? {figure} : {})});};
  const from=addDays(today,-3),to=addDays(today,-1);
  const placed=placedSpendRows(facts,from,to,today).filter(r=>r.source==='meta');
  const selected=days.filter(d=>d.date>=from&&d.date<=to).map(d=>({...d,
    ukM:placed.filter(r=>r.day===d.date&&r.market==='uk').reduce((n,r)=>n+Number(r.amount),0),
    usM:placed.filter(r=>r.day===d.date&&r.market==='us').reduce((n,r)=>n+Number(r.amount),0)}));
  if(selected.length===3&&selected.every(d=>d.countsKnown!==false&&facts.days.some(r=>r.source==='meta'&&r.day===d.date))) {
    const totals=aggregateDays(selected);
    for(const market of ['uk','us'] as const){
      const value=cpo(totals,selected,market==='uk'?'ukcpo':'uscpo',settings.blendedMetaTripwireGbp).value;
      const spend=totals[market==='uk'?'ukM':'usM'],orders=totals[market];
      if(spend>0&&(orders===0||value>settings.blendedMetaTripwireGbp))
        add(`meta-cpo:${market}`,`${market.toUpperCase()} Meta cost per order over the bar`,
          orders===0 ? `${formatPounds(spend)} spent with 0 counted orders over ${from}–${to}; all Meta owners.`
            : `${formatPounds(value)} over ${from}–${to}; bar ${formatPounds(settings.blendedMetaTripwireGbp)}. Counted orders, all Meta owners.`,
          '/ads',{value:formatPounds(orders===0?spend:value),label:orders===0?'spent · 0 orders':'an order · 3 days'});
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

/** Google observations never expose a writer or imply a source change. */
export function googleRisks(facts: GoogleFacts, settings: Settings, today: string, spend?: SpendFacts): DashboardNeed[] {
  if (facts.mode !== 'live') return [];
  const needs: DashboardNeed[] = [], from = addDays(today, -7), to = addDays(today, -1);
  const add = (id: string, title: string, why: string, googleFlag: GoogleFlagDetail, figure?: DashboardNeed['figure']) => needs.push({
    id, source: 'google-ads', state: 'warn', title, why, link: '/settings', googleFlag, ...(figure ? { figure } : {}),
  });
  const name = (id: string) => facts.campaigns.find(row => row.id === id)?.name || `Campaign ${id}`;
  const source = (kind: GoogleJobKind) => `Google Ads ${kind} report · last read ${facts.jobs.find(row => row.kind === kind)?.lastSuccessAt ?? 'unknown'}. Google conversions are Google's own claims.`;
  const micros = (pounds: number) => BigInt(Math.round(pounds * 1_000_000));
  const ratioMeasure = (value: number, bar: number, label: string) => ({value,bar,label,formattedValue:`${value.toFixed(2)}×`,formattedBar:`${bar}×`});
  const expected = new Set(settings.expectedGoogleCampaigns.map(row => row.campaignId));
  if (!expected.size) add('google-expected-list', 'Google expected campaign list is not set', 'Add the campaigns you expect in Settings. One list warning covers all campaigns until the list is set.',
    {kind:'expected-list',rule:'At least one expected Google campaign must be listed in Settings.',sourceLine:source('campaigns')});
  else {
    const spending = new Set([
      ...facts.conversions.filter(row => row.day >= from && row.day <= today && BigInt(row.spendMicros) > 0n).map(row => row.campaignId),
      ...facts.networks.filter(row => row.day >= from && row.day <= today && BigInt(row.spendMicros) > 0n).map(row => row.campaignId),
      ...(spend?.mode === 'live' ? spend.rows.filter(row => row.source === 'google-ads' && row.day >= from && row.day <= today && Number(row.amount) > 0).map(row => row.campaignId) : []),
    ]);
    for (const id of spending) if (!expected.has(id)) add(`google-unexpected:${id}`, 'Google campaign spending outside the expected list', `${name(id)} spent in the last 7 complete UK days or today. Review it and add its ID in Settings if expected.`,
      {kind:'unexpected',rule:'Every campaign with spend in the last 7 complete UK days or today belongs in the expected list.',sourceLine:source('campaigns')});
  }
  for (const campaign of facts.campaigns) {
    if (campaign.status === 'ENABLED' && campaign.channelType === 'PERFORMANCE_MAX'
      && (campaign.biddingStrategyType !== 'MAXIMIZE_CONVERSION_VALUE' || campaign.targetRoas === null || campaign.targetRoas <= 0))
      add(`google-bidding:${campaign.id}`, 'Google Performance Max bidding needs review', `${campaign.name}: expected Maximise conversion value with a positive target ROAS. Review in Google; Pulse makes no change.`,
        {kind:'bidding',rule:'Enabled Performance Max campaigns use Maximise conversion value with a target ROAS above 0.',sourceLine:source('campaigns')});
  }
  if (googleCovers(facts, 'networks', from, to)) {
    const floor = BigInt(Math.round(settings.googleNetworkSpendFloorGbp * 1_000_000));
    for (const slice of googleNetworkTotals(facts.networks, from, to)) {
      if (slice.spendMicros <= 0n || slice.spendMicros < floor) continue;
      const roas = Number(slice.valueMicros) / Number(slice.spendMicros);
      if (roas < settings.googleNetworkRoasFloor) add(`google-network:${slice.campaignId}:${slice.network}`, 'Google network return below its bar',
        `${name(slice.campaignId)} · ${googleNetworkName(slice.network)}: ${formatPounds(Number(slice.spendMicros) / 1_000_000)} spent, ${roas.toFixed(2)}× Google ROAS over ${from}–${to}. Floors: ${formatPounds(settings.googleNetworkSpendFloorGbp)} and ${settings.googleNetworkRoasFloor}×. YouTube share alone raises no warning.`,
        {kind:'network',rule:`Each campaign/network slice needs at least ${formatPounds(settings.googleNetworkSpendFloorGbp)} of spend before a return below ${settings.googleNetworkRoasFloor}× warns, over 7 complete UK days.`,sourceLine:source('networks'),measure:ratioMeasure(roas,settings.googleNetworkRoasFloor,'Google ROAS · 7 days')},
        { value: `${roas.toFixed(2)}×`, label: 'Google ROAS · 7 days' });
    }
  }
  const contentWindow = (start: string, label: string) => {
    if (!googleCovers(facts, 'networks', start, to)) return null;
    const rows = facts.networks.filter(row => row.day >= start && row.day <= to);
    const total = rows.reduce((sum,row) => sum + BigInt(row.spendMicros),0n);
    const content = rows.filter(row => row.network === 'CONTENT');
    const cost = content.reduce((sum,row) => sum + BigInt(row.spendMicros),0n);
    const campaigns = new Map<string,bigint>();
    for (const row of content) campaigns.set(row.campaignId,(campaigns.get(row.campaignId) ?? 0n) + BigInt(row.spendMicros));
    const largest = [...campaigns].sort(([idA,a],[idB,b]) => a === b ? idA.localeCompare(idB) : a > b ? -1 : 1)[0]?.[0];
    return {label,total,cost,largest,share:total > 0n ? Number(cost) / Number(total) * 100 : 0};
  };
  const day = contentWindow(to,'last complete UK day'), week = contentWindow(from,'7 complete UK days');
  const breach = [day,week].filter((window): window is NonNullable<typeof day> => !!window && window.total > 0n
    && window.cost >= micros(settings.googleContentSpendFloorGbp)
    && window.cost * 10_000n > window.total * BigInt(Math.round(settings.googleContentShareMaxPct * 100)))
    .sort((a,b) => b.share - a.share)[0];
  if (breach) {
    const shareText = (window: typeof day) => window ? `${window.share.toFixed(2)}% (${formatPounds(Number(window.cost) / 1_000_000)} content spend)` : 'unknown · coverage incomplete';
    add('google-content-share','Google Display / content share is over its bar',
      `Display / content share: last complete UK day ${to}: ${shareText(day)}; 7 complete UK days ${from}–${to}: ${shareText(week)}. ${breach.largest ? name(breach.largest) : 'No campaign'} had the most content spend in the ${breach.label}. Bar: ${settings.googleContentShareMaxPct}% with at least ${formatPounds(settings.googleContentSpendFloorGbp)} of content spend.`,
      {kind:'content-share',rule:`Content share must be over ${settings.googleContentShareMaxPct}% and content spend at least ${formatPounds(settings.googleContentSpendFloorGbp)} in either complete UK window.`,sourceLine:source('networks'),
        measure:{value:breach.share,bar:settings.googleContentShareMaxPct,label:`Content share · ${breach.label}`,formattedValue:`${breach.share.toFixed(2)}%`,formattedBar:`${settings.googleContentShareMaxPct}%`}},
      {value:`${breach.share.toFixed(2)}%`,label:`Display / content · ${breach.label}`});
  }
  if (googleCovers(facts,'conversions',from,to)) {
    const totals = new Map<string,{spend:bigint;value:bigint;conversions:number}>();
    for (const row of facts.conversions) {
      if (row.day < from || row.day > to) continue;
      const total = totals.get(row.campaignId) ?? {spend:0n,value:0n,conversions:0};
      total.spend += BigInt(row.spendMicros); total.value += BigInt(row.conversionValueMicros); total.conversions += row.conversions;
      totals.set(row.campaignId,total);
    }
    for (const [campaignId,total] of totals) {
      if (total.spend <= 0n) continue;
      const pounds = Number(total.spend) / 1_000_000;
      // Decimal conversion fractions can sum to just below 0.01 through floating-point rounding.
      if (total.spend >= micros(settings.googleNoSaleSpendFloorGbp) && total.conversions < 0.01 - Number.EPSILON)
        add(`google-nosale:${campaignId}`,'Google campaign spent without a conversion',
          `${name(campaignId)} spent ${formatPounds(pounds)} over ${from}–${to}, with ${formatNumber(total.conversions)} Google conversions. Under 0.01 counts as none; spend floor ${formatPounds(settings.googleNoSaleSpendFloorGbp)}.`,
          {kind:'nosale',rule:`At least ${formatPounds(settings.googleNoSaleSpendFloorGbp)} of positive spend and fewer than 0.01 Google conversions over 7 complete UK days.`,sourceLine:source('conversions'),
            measure:{value:pounds,bar:settings.googleNoSaleSpendFloorGbp,label:'Spent · no conversions · 7 days',formattedValue:formatPounds(pounds),formattedBar:formatPounds(settings.googleNoSaleSpendFloorGbp)}},
          {value:formatPounds(pounds),label:'spent · no conversions · 7 days'});
      const campaign = facts.campaigns.find(row => row.id === campaignId), market = campaign ? googleCampaignMarket(campaign) : 'unknown';
      const bar = market === 'uk' ? settings.googleBreakEvenReturnUk : market === 'us' ? settings.googleBreakEvenReturnUs : 0;
      if (bar > 0 && total.spend >= micros(settings.googleNetworkSpendFloorGbp)
        && total.value * 100n < total.spend * BigInt(Math.round(bar * 100))) {
        const value = Number(total.value) / Number(total.spend);
        add(`google-under:${campaignId}`,'Google campaign return is under break-even',
          `${name(campaignId)} · ${market.toUpperCase()}: ${formatPounds(pounds)} spent, ${formatPounds(Number(total.value) / 1_000_000)} Google conversion value and ${value.toFixed(2)}× return over ${from}–${to}; break-even ${bar}× and spend floor ${formatPounds(settings.googleNetworkSpendFloorGbp)}.`,
          {kind:'under',rule:`${market.toUpperCase()} Google return below ${bar}× after at least ${formatPounds(settings.googleNetworkSpendFloorGbp)} of spend over 7 complete UK days. A zero market bar turns this check off.`,sourceLine:source('conversions'),measure:ratioMeasure(value,bar,'Google return · 7 days')},
          {value:`${value.toFixed(2)}×`,label:'Google return · 7 days'});
      }
    }
  }
  return needs;
}
