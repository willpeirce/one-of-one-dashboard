import { readActivity, type ActivityView } from './activity.js';
import {decisionRows} from './decision-rows.js';
export {decisionRows} from './decision-rows.js';
import {readMetaActions,type MetaAction} from './actions.js';
import {creativeFeatureFlags} from '../creatives/config.js';
import type { Database } from '../db.js';
import type { Settings } from '../settings.js';
import { addDays,ukToday } from '../hero-range.js';
import { readAdSets, type StoredAdSet } from './catalogue.js';
import {judgeAdSet,totalDays,type SetDay,type SetVerdict,type RuleContext} from './rules.js';
import {breakEven,weekdayBudget} from './settings.js';
export interface AdSetRow { set: StoredAdSet; days: SetDay[]; verdict: SetVerdict|null; yesterday: number|null; spend: number; purchases: number|null; cpp: number|null; cpatc:number|null; breakEven:number|null; breakEvenNote:string; weekdayBudget:number|null; freelancer: {window:3|7; cpp:number|null; oursCpp:number|null; over:boolean|null}[]; changes: {time:string;field:string;old:string;value:string}[] }
export interface AdSetsView { mode:'sample'|'live';today:string;lastRead:string|null;stale:boolean;count:number;rows:AdSetRow[];accountYesterday:number|null;actionsEnabled:boolean; actions?:MetaAction[]; activity?:ActivityView }
export function buildAdSetsView(sets:StoredAdSet[],days:Map<string,SetDay[]>,settings:Settings,today:string,options:{mode:'sample'|'live';lastRead:string|null;stale?:boolean;accountYesterday:number|null;contexts?:Map<string,RuleContext>;recentActionIds?:string[]}):AdSetsView {
 const yesterday=addDays(today,-1),ownerOrder={ours:0,freelancer:1,unassigned:2};
 const ours=(market:string,window:number)=>totalDays(sets.filter(s=>s.owner==='ours'&&s.market===market).flatMap(s=>(days.get(s.id)??[]).filter(d=>d.day>=addDays(today,-window)&&d.day<today)));
 const rows=sets.filter(s=>s.effectiveStatus==='ACTIVE'||options.recentActionIds?.includes(s.id)).map(set=>{
  const data=days.get(set.id)??[],last=data.find(d=>d.day===yesterday),week=totalDays(data.filter(d=>d.day>=addDays(today,-7)&&d.day<today));
  const be=set.market==='unknown'?null:breakEven(settings,set.market,today);
  return {set,days:data.filter(d=>d.day>=addDays(today,-7)&&d.day<today),
    verdict:judgeAdSet(set,data,settings,today,{...options.contexts?.get(set.id),ourMarketSpendYesterday:ours(set.market,1).spend}),
    yesterday:last?.spend??null,spend:week.spend,purchases:week.purchases,cpp:week.purchases?week.spend/week.purchases:null,cpatc:week.addsToCart?week.spend/week.addsToCart:null,
    breakEven:be?.value??null,breakEvenNote:be?.note??'',weekdayBudget:set.market==='unknown'||set.dailyBudget===null?null:set.dailyBudget/100*(set.flatBudget?1:1+settings.adRules[set.market].upliftPercent/100),
    freelancer:set.owner!=='freelancer'?[]:([3,7] as const).map(window=>{const t=totalDays(data.filter(d=>d.day>=addDays(today,-window)&&d.day<today)),o=ours(set.market,window);return {window,cpp:t.purchases?t.spend/t.purchases:null,oursCpp:o.purchases?o.spend/o.purchases:null,over:t.purchases===null||t.spend===0?null:t.purchases===0||t.spend/t.purchases>settings.adRules.freelancerTriggerGbp};}),changes:[],
  };
 }).sort((a,b)=>ownerOrder[a.set.owner]-ownerOrder[b.set.owner]||b.spend-a.spend||a.set.id.localeCompare(b.set.id));
 return {...options,today,count:sets.length,stale:options.stale??false,rows,actionsEnabled:false};
}

export function liveSummary(view:AdSetsView,settings:Settings,market='all') {
 const ours=view.rows.filter(r=>r.set.owner==='ours'&&r.set.effectiveStatus==='ACTIVE'&&(market==='all'||r.set.market===market));
 const budgets=ours.map(r=>r.set.market==='unknown'?null:weekdayBudget(r.set.dailyBudget,r.set.market,addDays(view.today,-1),settings,r.set.flatBudget));
 return {count:ours.length,decisions:decisionRows(view,market).length,spend:ours.some(r=>r.yesterday===null)?null:ours.reduce((s,r)=>s+r.yesterday!,0),expected:budgets.some(b=>b===null)?null:budgets.reduce<number>((s,b)=>s+b!,0)};
}
export async function readAdSetsView(db:Database,settings:Settings,env:NodeJS.ProcessEnv,now:Date):Promise<AdSetsView> {
 if(!settings.metaAdAccountId||!env.META_ACCESS_TOKEN)return sampleAdSetsView(settings);
 const account=settings.metaAdAccountId,today=ukToday(now);
 const [sets,sync,stored,coverage,ads,changes,actions]=await Promise.all([
  readAdSets(db,account,settings),db.query<any>('SELECT last_read FROM pulse.meta_ad_set_sync WHERE account_id=$1',[account]),
  db.query<any>("SELECT ad_set_id,uk_day::text AS day,spend_amount,purchases,adds_to_cart FROM pulse.ad_spend WHERE mode='live' AND source='meta' AND account_id=$1 AND uk_day<$2 ORDER BY uk_day,ad_set_id",[account,today]),
  db.query<{day:string}>("SELECT uk_day::text AS day FROM pulse.ad_spend_days WHERE source='meta' AND account_id=$1 AND uk_day<$2 AND actions_complete ORDER BY uk_day",[account,today]),
  db.query<any>("SELECT ad_set_id,effective_status,status_since FROM pulse.ads WHERE mode='live' AND account_id=$1",[account]),
  db.query<any>('SELECT * FROM pulse.meta_ad_set_changes WHERE account_id=$1 ORDER BY observed_at DESC',[account]),
  db.query<any>("SELECT ad_set_id,time FROM pulse.meta_actions WHERE account_id=$1 AND result='success' AND time>=$2",[account,addDays(today,-7)]),
 ]);
 const days=new Map<string,SetDay[]>(),contexts=new Map<string,RuleContext>();
 for(const set of sets){
  const born=ukToday(new Date(set.createdTime));
  const rows=stored.rows.filter(r=>r.ad_set_id===set.id);
  days.set(set.id,coverage.rows.filter(r=>r.day>=born).map(({day})=>{const row=rows.find(r=>r.day===day);return {day,spend:row?Number(row.spend_amount):0,purchases:row?row.purchases===null?null:Number(row.purchases):0,addsToCart:row?row.adds_to_cart===null?null:Number(row.adds_to_cart):0};}));
  contexts.set(set.id,{changes:changes.rows.filter(r=>r.ad_set_id===set.id).map(r=>new Date(r.observed_at).toISOString()),ads:ads.rows.filter(r=>r.ad_set_id===set.id).map(r=>({effectiveStatus:r.effective_status,statusSince:new Date(r.status_since).toISOString()}))});
 }
 const lastRead=sync.rows[0]?new Date(sync.rows[0].last_read).toISOString():null,yesterday=addDays(today,-1);
 const view=buildAdSetsView(sets,days,settings,today,{recentActionIds:actions.rows.filter(a=>now.getTime()-new Date(a.time).getTime()<=86_400_000).map(a=>a.ad_set_id),mode:'live',lastRead,stale:!!lastRead&&now.getTime()-Date.parse(lastRead)>2*60*60_000,accountYesterday:coverage.rows.some(r=>r.day===yesterday)?stored.rows.filter(r=>r.day===yesterday).reduce((s,r)=>s+Number(r.spend_amount),0):null,contexts});
 view.activity=await readActivity(db,account,settings,now);
 view.actionsEnabled=creativeFeatureFlags(env).metaActionsEnabled;
 view.actions=await readMetaActions(db,account);
 for(const row of view.rows){
   const times=actions.rows.filter(a=>a.ad_set_id===row.set.id).map(a=>new Date(a.time).toISOString());
   const context=contexts.get(row.set.id)??{};context.changes=[...(context.changes??[]),...times];
   row.verdict=judgeAdSet(row.set,days.get(row.set.id)??[],settings,today,{...context,ourMarketSpendYesterday:sets.filter(s=>s.owner==='ours'&&s.market===row.set.market).flatMap(s=>days.get(s.id)??[]).filter(d=>d.day===yesterday).reduce((n,d)=>n+d.spend,0)});
 }
 for(const row of view.rows)row.changes=changes.rows.filter(c=>c.ad_set_id===row.set.id).slice(0,50).map(c=>({time:new Date(c.observed_at).toISOString(),field:c.field,old:c.old_value,value:c.new_value}));
 return view;
}
/** All sample identities, dates and measures are invented and remain in sample mode. */
export function sampleAdSetsView(settings:Settings):AdSetsView {
 const today='2026-10-16',days=new Map<string,SetDay[]>(),s=structuredClone(settings);
 s.adRules.killFloorGbp=75;s.adRules.slippingFloorGbp=90;s.adRules.uk.killBar=1.3;s.adRules.uk.slippingBar=1.5;s.adRules.uk.atcBarGbp=15;s.adRules.uk.upliftPercent=0;s.cppUkBreakEvenGbp=20;s.adRules.uk.overrideGbp=null;s.adRules.testShareCapPercent=25;
 const sets=['Kill','Slipping','Delivery','Test share','Step','Clear','Freelancer','Unassigned'].map((label,i):StoredAdSet=>{
  const id=`invented-adset-${i}`,campaignId=`invented-campaign-${i}`,born='2026-10-09T08:00:00Z';
  s.metaOwners.push({campaignId,owner:'ours',test:label==='Test share'});
  const row={id,campaignId,flatBudget:label==='Clear'?true:null,name:`Invented — UK — ${label} Fern`,status:'ACTIVE',effectiveStatus:'ACTIVE',dailyBudget:2000,lifetimeBudget:null,currency:'GBP',createdTime:born,updatedTime:born,learningStage:label==='Delivery'?'LEARNING_LIMITED':null,lastSignificantEdit:null,market:'uk' as const,owner:i<6?'ours' as const:i===6?'freelancer' as const:'unassigned' as const,campaignName:`Invented ${label} UK`,firstSeen:born,lastSeen:'2026-10-16T08:00:00Z',lastRead:'2026-10-16T08:00:00Z'};
  const data=Array.from({length:7},(_,j)=>({day:addDays('2026-10-09',j),spend:label==='Kill'?40:label==='Slipping'?(j<4?5:40):label==='Test share'?150:label==='Step'?16:21,purchases:label==='Test share'?10:1,addsToCart:label==='Test share'?20:3}));
  if(label==='Test share')row.updatedTime='2026-10-15T08:00:00Z';
  days.set(id,data);return row;
 });
 return buildAdSetsView(sets,days,s,today,{mode:'sample',lastRead:'2026-10-16T08:00:00Z',accountYesterday:[...days.values()].reduce((n,d)=>n+d.at(-1)!.spend,0)});
}
