import type { DashboardSnapshot, HeroPeriod } from '../dashboard-types.js';
import type { Settings } from '../settings.js';
import { formatNumber } from '../money.js';
import { formatUkTime } from '../uk-time.js';
import { MAILCHIMP_FRESH_MS, type MailchimpFacts } from './model.js';

export function mailchimpFlowNote(facts: MailchimpFacts): string {
  return facts.flowCoverage === 'unavailable' ? 'Mailchimp’s per-flow figures are not available by API.'
    : facts.flowCoverage === 'available' ? 'Flow reporting was found; verified campaign-to-flow mappings are still needed.'
      : 'Mailchimp’s per-flow figures await the read-only probe.';
}

/** Preset and custom ranges carry the same Mailchimp availability beside Shopify money. */
export function applyMailchimpHero(hero: HeroPeriod, facts: MailchimpFacts): HeroPeriod {
  const note = mailchimpFlowNote(facts);
  for (const view of [hero, ...Object.values(hero.markets ?? {})]) {
    const detail = view.business?.email.detail;
    if (detail) detail.extra = [...(detail.extra ?? []).filter(([label]) => label !== 'Mailchimp view'), ['Mailchimp view', `${note} Its own count and USD revenue remain sample.`]];
  }
  return hero;
}

/** Audience can stand alone; flow claims remain sample until a verified reporting path exists. */
export function applyMailchimpDashboard(snapshot: DashboardSnapshot, facts: MailchimpFacts, settings: Settings, now: Date): void {
  const note = mailchimpFlowNote(facts);
  for (const id of ['w043','w044','w045']) {
    const widget = snapshot.widgets[id];
    if (widget?.kind !== 'detail') continue;
    widget.mode = 'sample'; widget.state = 'info'; widget.source = ['mailchimp'];
    widget.value = { why: `${note} ${id === 'w043' ? 'Invented Mailchimp view: 4 credited orders and $64.00 USD revenue. This is separate from Shopify’s GBP sales.' : id === 'w044' ? 'Invented add-on flow example: 17 entries across all versions.' : 'Invented popup flow example: 9 entries. No live per-flow count is inferred.'}`,
      rule: 'Sample data. Combine flow versions: Mailchimp’s country split is unreliable. The refill funnel remains sample until the probe result supports its stages.',
      src: 'Mailchimp sample data · reporting not connected' };
  }
  for (const [key, value] of [['t0277','Email sales · Mailchimp'],['t0278','$64.00'],['t0279','Sample own credit · USD'],['t0280','Add-on flow · Mailchimp'],['t0281','Sample'],['t0282','Per-flow reporting not connected'],['t0283','Popup flow · Mailchimp'],['t0284','Sample'],['t0285','Per-flow reporting not connected']] as const)
    snapshot.textValues[key] = {source:['mailchimp'],mode:'sample',value};
  // The Shopify card and every carried market/range view keep their own money and provenance.
  const email = snapshot.widgets.w039;
  if (email?.kind === 'detail') email.value.extra = [...(email.value.extra ?? []).filter(([label]) => label !== 'Mailchimp view'), ['Mailchimp view', `${note} Its own order count and USD revenue remain sample.`]];
  for (const hero of Object.values(snapshot.hero)) applyMailchimpHero(hero, facts);
  const fetched = Date.parse(facts.fetchedAt ?? '');
  if (facts.mode !== 'live' || facts.status !== 'live' || !facts.audience || facts.audience.contacts === null
    || !Number.isFinite(fetched) || fetched > now.getTime() || now.getTime() - fetched > MAILCHIMP_FRESH_MS) return;
  const audience = facts.audience, limit = settings.mailchimpPlanLimit, share = limit === null ? null : audience.contacts! / limit * 100;
  const max = Math.max(130, share ?? 0);
  snapshot.widgets.w038 = {kind:'dial',source:['mailchimp'],mode:'live',value:{
    v:share ?? 0,min:0,max,t:share === null ? 'Read' : `≈${formatNumber(share,1)}%`,l:'Email audience',
    s:`Mailchimp · all markets${limit === null ? ' · plan not set' : ' · plan usage'}`,z:[[0,max,'info']],cap:'info',hidePointer:share === null,
    d:{why:`Mailchimp reports approximately ${formatNumber(audience.contacts!)} total contacts across all contact states${limit === null ? '; no plan limit is set' : ` against the ${formatNumber(limit)} contact plan`}. This provider estimate is not an exact billing count. ${note}`,
      rule:'Use the provider’s approximate total contacts; subscribers alone never stand in for the audience. A Watch item appears only above a configured plan in the seven days before its billing date. No source changes.',
      src:`Mailchimp live · read ${formatUkTime(facts.fetchedAt!)}`,
      extra:[['Approximate total contacts',formatNumber(audience.contacts!)],['Subscribers',formatNumber(audience.subscribers)],['Unsubscribed',formatNumber(audience.unsubscribed)],['Cleaned',formatNumber(audience.cleaned)],
        ['Plan limit',limit === null ? 'Not set' : formatNumber(limit)],['Billing day',settings.mailchimpBillingDay === null ? 'Not set' : String(settings.mailchimpBillingDay)],['Markets','All markets combined; Mailchimp’s UK/US address filter is unreliable.']]},
  }};
}
