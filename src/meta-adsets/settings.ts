import type { Settings } from '../settings.js';
export type AdMarket = 'uk' | 'us';
export interface MarketRules { overrideGbp: number | null; overrideUntil: string; killBar: number; slippingBar: number; atcBarGbp: number; upliftPercent: number }
export interface AdRules { uk: MarketRules; us: MarketRules; killFloorGbp: number; slippingFloorGbp: number; freelancerTriggerGbp: number; testShareCapPercent: number }
export function adRulesDefaults(): AdRules {
  const market = (atcBarGbp: number): MarketRules => ({overrideGbp:null,overrideUntil:'',killBar:1.3,slippingBar:1.5,atcBarGbp,upliftPercent:0});
  return {uk:market(15),us:market(10),killFloorGbp:75,slippingFloorGbp:90,freelancerTriggerGbp:30,testShareCapPercent:25};
}
export function breakEven(settings: Settings, market: AdMarket, today: string): {value: number; note: string} {
  const rule=settings.adRules[market];
  const active=rule.overrideGbp !== null && !!rule.overrideUntil && today<=rule.overrideUntil;
  return {value:active ? rule.overrideGbp! : market==='uk' ? settings.cppUkBreakEvenGbp : settings.cppUsBreakEvenGbp,note:active ? `override to ${rule.overrideUntil}` : ''};
}
/** UK calendar dates, including February and leap years; never UTC elapsed-day maths. */
export function isSpikeDay(market: AdMarket, day: string): boolean {
  const date=new Date(`${day}T12:00:00Z`),n=date.getUTCDate();
  const last=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();
  return n>=last-1 || (market==='uk' ? n>=24 && n<=26 : n===1 || n===15);
}
export function weekdayBudget(baseMinor: number | null, market: AdMarket, day: string, settings: Settings, flatBudget: boolean | null = null): number | null {
  return baseMinor === null ? null : baseMinor/100*(flatBudget || new Date(`${day}T12:00:00Z`).getUTCDay()===0 ? 1 : 1+settings.adRules[market].upliftPercent/100);
}
