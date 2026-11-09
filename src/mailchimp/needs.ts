import { dayCount, ukToday } from '../hero-range.js';
import { formatNumber } from '../money.js';
import type { Settings } from '../settings.js';
import type { DashboardNeed } from '../shopify/dashboard.js';
import { MAILCHIMP_FRESH_MS, type MailchimpFacts } from './model.js';

/** Calendar arithmetic, with a short month's final day standing in for days 29–31. */
export function nextMailchimpBillingDate(today: string, billingDay: number): string {
  const month = new Date(`${today.slice(0,7)}-01T00:00:00Z`);
  const dateFor = () => {
    const end = new Date(month);end.setUTCMonth(end.getUTCMonth()+1);end.setUTCDate(0);
    const candidate = new Date(month);candidate.setUTCDate(Math.min(billingDay,end.getUTCDate()));
    return candidate.toISOString().slice(0,10);
  };
  let date = dateFor();
  if (date <= today) { month.setUTCMonth(month.getUTCMonth()+1);date=dateFor(); }
  return date;
}

/** Authoritative audience totals only; this observation has no source or Settings writer. */
export function mailchimpBillingNeeds(facts: MailchimpFacts, settings: Pick<Settings,'mailchimpPlanLimit'|'mailchimpBillingDay'>, now: Date): DashboardNeed[] {
  const { mailchimpPlanLimit: limit, mailchimpBillingDay: billingDay } = settings;
  const fetched = facts.fetchedAt ? Date.parse(facts.fetchedAt) : NaN;
  const contacts = facts.audience?.contacts;
  if (facts.mode !== 'live' || facts.status !== 'live' || !Number.isFinite(fetched)
    || fetched > now.getTime() || now.getTime()-fetched > MAILCHIMP_FRESH_MS
    || limit === null || !Number.isSafeInteger(limit) || limit < 1
    || billingDay === null || !Number.isInteger(billingDay) || billingDay < 1 || billingDay > 31
    || contacts === null || contacts === undefined || !Number.isSafeInteger(contacts) || contacts <= limit) return [];
  const today = ukToday(now), date = nextMailchimpBillingDate(today,billingDay);
  const days = dayCount(today,date)-1;
  if (days < 1 || days > 7) return [];
  return [{ id:'mailchimp-audience-limit',state:'warn',source:'mailchimp',title:'Email audience over plan',link:'/settings',
    figure:{value:`~${formatNumber(contacts-limit)}`,label:'contacts over plan'},
    why:`Mailchimp's approximate total is ${formatNumber(contacts)} contacts against a plan limit of ${formatNumber(limit)}. Billing is ${date}, in ${days} UK calendar ${days===1?'day':'days'}. Review the audience before billing.` }];
}
