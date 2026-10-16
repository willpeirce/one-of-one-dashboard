import { addDays, ukToday } from '../hero-range.js';
import { formatNumber, formatPounds } from '../money.js';
import type { Settings } from '../settings.js';
import type { StoredAdSet } from './catalogue.js';
import { breakEven, isSpikeDay, weekdayBudget, type AdMarket } from './settings.js';
export interface SetDay { day: string; spend: number; purchases: number | null; addsToCart: number | null }
export type VerdictWord = 'Kill' | 'Slipping' | 'Delivery' | 'Test share' | 'Step' | 'Clear';
export interface RuleReason { rule: string; verdict: VerdictWord; text: string; figures: [string,string] }
export interface SetVerdict {
  verdict: VerdictWord; reason: string; reasons: RuleReason[]; figures: [string,string];
  spend: number; purchases: number | null; addsToCart: number | null; cpp: number | null; cpatc: number | null;
  windowFrom: string; windowTo: string; includesSpikeDays: boolean; breakEven: number | null; breakEvenNote: string;
  proposedBase: number | null; proposedWeekday: number | null; stepPercent: number | null;
}
export interface RuleContext {
  changes?: string[];
  ads?: {effectiveStatus: string; statusSince: string}[];
  ourMarketSpendYesterday?: number;
}
export const verdictOrder: VerdictWord[] = ['Kill','Slipping','Step','Delivery','Test share','Clear'];
export function totalDays(rows: SetDay[]): {spend: number; purchases: number | null; addsToCart: number | null} {
  const sum = (key:'purchases'|'addsToCart') => rows.length && rows.every(r=>r[key] !== null) ? rows.reduce((s,r)=>s+r[key]!,0) : null;
  return {spend:Math.round(rows.reduce((s,r)=>s+r.spend,0)*1e6)/1e6,purchases:sum('purchases'),addsToCart:sum('addsToCart')};
}
const ratio=(spend:number,count:number|null)=>count!==null && count>0 ? spend/count : null;
const cost=(spend:number,count:number|null)=>count===null ? 'Unknown' : count===0 ? 'no purchase' : formatPounds(spend/count);
const dates=(from:string,to:string)=>{const days:string[]=[];for(let d=from;d<=to;d=addDays(d,1))days.push(d);return days;};
/** Only explicit ours + ACTIVE may enter the rule engine. Null actions never mean zero. */
export function judgeAdSet(set: StoredAdSet, days: SetDay[], settings: Settings, today: string, context: RuleContext = {}): SetVerdict | null {
  if(set.owner!=='ours'||set.effectiveStatus!=='ACTIVE')return null;
  const born=ukToday(new Date(set.createdTime)),yesterday=addDays(today,-1),from=[born,addDays(today,-7)].sort().at(-1)!;
  const windowDates=dates(from,yesterday),window=days.filter(d=>d.day>=from&&d.day<=yesterday),totals=totalDays(window);
  const complete=windowDates.length>0&&windowDates.every(d=>window.some(r=>r.day===d));
  const market=set.market==='unknown'?null:set.market,be=market?breakEven(settings,market,today):null;
  const reasons:RuleReason[]=[];
  const add=(rule:string,verdict:VerdictWord,text:string,a:string,b:string)=>reasons.push({rule,verdict,text,figures:[a,b]});
  const last=days.find(d=>d.day===yesterday),budget=market?weekdayBudget(set.dailyBudget,market,yesterday,settings):null;
  let proposedBase:number|null=null,proposedWeekday:number|null=null,stepPercent:number|null=null;
  const cpp=ratio(totals.spend,totals.purchases),cpatc=ratio(totals.spend,totals.addsToCart);
  const beText=be?`${formatPounds(be.value)}${be.note?` · ${be.note}`:''}`:'Unknown market';
  if(market&&be) {
    const rules=settings.adRules[market],bar=be.value*rules.killBar;
    if(complete&&totals.spend>=settings.adRules.killFloorGbp && totals.purchases!==null && (totals.purchases===0||cpp!>bar))
      add('purchase-cost','Kill',`${formatPounds(totals.spend)} on ${formatNumber(totals.purchases)} purchases, ${cost(totals.spend,totals.purchases)}${totals.purchases?' each':''} against ${formatPounds(bar)}${be.note?` · ${be.note}`:''}`,`${formatPounds(totals.spend)} spend`,`${cost(totals.spend,totals.purchases)} per purchase`);
    if(complete&&windowDates.length>=2&&totals.spend>=settings.adRules.killFloorGbp&&totals.addsToCart!==null&&(totals.addsToCart===0||cpatc!>rules.atcBarGbp))
      add('atc-cost','Kill',`${formatPounds(totals.spend)} on ${totals.addsToCart} adds to cart against ${formatPounds(rules.atcBarGbp)} each`,`${formatPounds(totals.spend)} spend`,totals.addsToCart?`${formatPounds(cpatc!)} an add to cart`:'0 adds to cart');
    if(last&&yesterday>born&&budget!==null&&budget>0&&last.spend>=budget/2&&last.addsToCart===0)
      add('zero-day','Kill',`${formatPounds(last.spend)} yesterday, no adds to cart, against ${formatPounds(budget/2)} half-budget`,`${formatPounds(last.spend)} yesterday`,'0 adds to cart');
    const threeDates=dates(addDays(today,-3),yesterday),three=days.filter(d=>threeDates.includes(d.day)),t=totalDays(three);
    if(threeDates.every(d=>three.some(r=>r.day===d))&&t.spend>=settings.adRules.slippingFloorGbp&&t.purchases!==null&&(t.purchases===0||t.spend/t.purchases>be.value*rules.slippingBar))
      add('slipping','Slipping',`${formatPounds(t.spend)} on ${t.purchases} purchases over 3 days, ${cost(t.spend,t.purchases)} against ${formatPounds(be.value*rules.slippingBar)}${be.note?` · ${be.note}`:''}`,`${formatPounds(t.spend)} in 3 days`,`${cost(t.spend,t.purchases)} per purchase`);
    const changes=[set.updatedTime,set.lastSignificantEdit,...(context.changes??[])].filter((v):v is string=>!!v).map(v=>ukToday(new Date(v)));
    const clean=(day:string)=>{
      const row=days.find(d=>d.day===day);
      return !!row&&!changes.includes(day)&&!isSpikeDay(market,day)&&row.addsToCart!==null&&row.addsToCart>0&&row.purchases!==null&&row.purchases>0&&row.spend/row.purchases<=be.value;
    };
    if(set.dailyBudget!==null&&set.dailyBudget>=100&&!isSpikeDay(market,today)&&clean(yesterday)&&clean(addDays(today,-2))) {
      stepPercent=complete&&windowDates.length===7&&cpp!==null&&cpp<be.value*0.85?30:20;
      proposedBase=Math.round(set.dailyBudget/100*(1+stepPercent/100)*2)/2;
      // Nearest 50p may cross the hard +30% action ceiling: use the nearest permitted 50p instead.
      if(proposedBase>set.dailyBudget/100*1.3)proposedBase=Math.floor(set.dailyBudget/100*1.3*2)/2;
      proposedWeekday=proposedBase*(1+rules.upliftPercent/100);
      add('two-clean-days','Step',`Two clean days at or below ${beText}; base +${stepPercent}% to ${formatPounds(proposedBase)}`,`${formatPounds(set.dailyBudget/100)} current base`,`${formatPounds(proposedBase)} proposed base`);
    }
  }
  const lifeDates=dates(born,yesterday),life=days.filter(d=>d.day>=born&&d.day<=yesterday),lifeTotal=totalDays(life);
  const lifeComplete=lifeDates.length>0&&lifeDates.every(d=>life.some(r=>r.day===d));
  if(lifeComplete&&lifeDates.length>=3&&life[0]&&lifeTotal.addsToCart!==null) {
    const first=life.find(d=>d.day===born);
    if(first?.addsToCart&&first.addsToCart===lifeTotal.addsToCart)
      add('first-day-pattern','Kill',`All ${lifeTotal.addsToCart} adds to cart were on the first day; none in ${lifeDates.length-1} days since`,`${lifeTotal.addsToCart} first-day adds to cart`,'0 since');
  }
  const line=/kill\s+at\s+(\d+(?:\.\d+)?)\s+ATC\s*\/\s*(\d+(?:\.\d+)?)\s+purch\b/i.exec(set.name);
  if(line&&lifeComplete&&lifeTotal.addsToCart!==null&&lifeTotal.purchases!==null&&lifeTotal.addsToCart>=Number(line[1])&&lifeTotal.purchases>=Number(line[2]))
    add('name-line','Kill',`Life totals meet kill at ${line[1]} ATC / ${line[2]} purch: ${lifeTotal.addsToCart} adds to cart / ${lifeTotal.purchases} purchases`,`${lifeTotal.addsToCart} life adds to cart`,`${lifeTotal.purchases} life purchases`);
  const rejected=(context.ads??[]).filter(ad=>/^(rejected|disapproved|in[_ ]review|pending_review)$/i.test(ad.effectiveStatus)&&ukToday(new Date(ad.statusSince))<yesterday);
  if(rejected.length)add('ad-review','Delivery',`${rejected.length} ads rejected, disapproved or in review for more than one UK day`,`${rejected.length} affected ads`,'Review delivery');
  if(last&&budget!==null&&budget>0&&last.spend<budget/2)add('under-budget','Delivery',`${formatPounds(last.spend)} yesterday against ${formatPounds(budget)} expected (under 50%)`,`${formatPounds(last.spend)} yesterday`,`${formatPounds(budget)} expected`);
  const learning=set.learningStage?.toLowerCase().replaceAll('_',' '),learningSince=ukToday(new Date(set.lastSignificantEdit??set.createdTime));
  if(learning==='learning limited'||learning==='learning'&&learningSince<addDays(today,-7))add('learning','Delivery',learning==='learning limited'?'Learning limited':`In learning since ${learningSince}, over 7 days`,learning==='learning limited'?'Learning limited':`Learning since ${learningSince}`,'Check delivery');
  const test=settings.metaOwners.find(r=>r.campaignId===set.campaignId)?.test;
  if(test&&born>addDays(today,-14)&&last&&context.ourMarketSpendYesterday&&last.spend/context.ourMarketSpendYesterday*100>settings.adRules.testShareCapPercent)
    add('test-share','Test share',`${formatPounds(last.spend)} is ${formatNumber(last.spend/context.ourMarketSpendYesterday*100,1)}% of our market spend, above ${settings.adRules.testShareCapPercent}%`,`${formatPounds(last.spend)} test spend`,`${settings.adRules.testShareCapPercent}% cap`);
  reasons.sort((a,b)=>verdictOrder.indexOf(a.verdict)-verdictOrder.indexOf(b.verdict));
  const first=reasons[0];
  return {verdict:first?.verdict??'Clear',reason:first?.text??(!market?'Market unknown; assign a UK or US name':!complete||totals.purchases===null||totals.addsToCart===null?'Waiting for complete day rows':'Inside its rules'),reasons,figures:first?.figures??[`${formatPounds(totals.spend)} spend`,`${cost(totals.spend,totals.purchases)} per purchase`],...totals,cpp,cpatc,windowFrom:from,windowTo:yesterday,includesSpikeDays:!!market&&windowDates.some(d=>isSpikeDay(market,d)),breakEven:be?.value??null,breakEvenNote:be?.note??'',proposedBase,proposedWeekday,stepPercent};
}
