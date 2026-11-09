import type { DashboardSnapshot, DialModel, HeroMarket } from '../dashboard-types.js';
import type { Settings } from '../settings.js';
import type { Order } from '../shopify/model.js';
import { countedOrder } from '../shopify/metrics.js';
import type { ActivityView } from '../meta-adsets/activity.js';
import type { SpendFacts } from '../ad-spend/store.js';
import { SPEND_STALE_AFTER_MS } from '../ad-spend/worker.js';
import { addDays, ukToday } from '../hero-range.js';
import { formatNumber, formatPounds } from '../money.js';
import { formatUkTime } from '../uk-time.js';
import { GOOGLE_CHANGE_INTERVAL_MS, type GoogleFacts, type GoogleJobKind } from './model.js';
import { googleCampaignIds, googleCampaignMarket, googleCovers, googleNetworkName, googleNetworkTotals, isYouTubeNetwork } from './metrics.js';

export interface GoogleShopifyContext { mode: 'sample' | 'live'; orders: readonly Order[]; ready: boolean; from: string; through?: string; lastRead?: string | null }
/** Last-visit Google credit is shown beside Google's claim, never as a replacement. */
export function isGooglePaidOrder(order: Order): boolean {
  const visit = order.lastVisit;
  return !!visit?.gclid || (!!visit && ['google', 'googleads', 'google_ads', 'google-ads'].includes(String(visit.source ?? '').trim().toLowerCase())
    && ['cpc', 'ppc', 'paid', 'paid_search', 'paidsearch', 'paid_social'].includes(String(visit.medium ?? '').trim().toLowerCase()));
}
function freshness(facts: GoogleFacts, kind: GoogleJobKind, now: Date): string {
  const job = facts.jobs.find(row => row.kind === kind);
  const stale = !job?.lastSuccessAt || now.getTime() - Date.parse(job.lastSuccessAt) > 4 * 60 * 60_000;
  return `Google live · ${job?.lastSuccessAt ? `read ${formatUkTime(job.lastSuccessAt)}` : 'waiting for first read'}${job?.error ? ' · latest read failed' : stale ? ' · read is stale' : ''} · figures can lag about 3 hours`;
}
function dial(label: string, value: number | null, suffix: string, subtitle: string, why: string, rule: string, source: string, extra: [string, string][] = [], max = 100): DialModel {
  return { v: value ?? 0, min: 0, max: Math.max(max, value ?? 0), t: value === null ? 'No data' : `${formatNumber(value, suffix === '×' ? 2 : 1)}${suffix}`,
    l: label, s: subtitle, z: [[0, Math.max(max, value ?? 0), 'info']], cap: 'info', hidePointer: value === null,
    d: { why, rule, src: source, extra } };
}

/** Each supported tile promotes independently; unsupported tiles retain their labelled sample model. */
export function applyGoogleDashboard(snapshot: DashboardSnapshot, facts: GoogleFacts, shopify: GoogleShopifyContext, settings: Settings,
  metaActivity: ActivityView | undefined, now: Date, _spend?: SpendFacts): void {
  if (facts.mode !== 'live') return;
  const today = ukToday(now), from = addDays(today, -7), to = addDays(today, -1);
  const campaignJob = facts.jobs.find(row => row.kind === 'campaigns');
  const hasCampaigns = !!campaignJob?.lastSuccessAt;
  const campaignFresh = !!campaignJob?.lastSuccessAt && !campaignJob.error && now.getTime() - Date.parse(campaignJob.lastSuccessAt) <= 4 * 60 * 60_000;
  const campaignNote = `Campaign settings ${campaignJob?.lastSuccessAt ? `read ${formatUkTime(campaignJob.lastSuccessAt)}` : 'not read'}${campaignJob?.error ? ' · latest campaign read failed' : !campaignFresh ? ' · campaign settings are stale' : ''}`;
  const markets = ['all', 'uk', 'us'] as const;
  if (googleCovers(facts, 'networks', from, to) && hasCampaigns) {
    const networkTotals = googleNetworkTotals(facts.networks, from, to);
    const models = Object.fromEntries(markets.map(market => {
      const ids = googleCampaignIds(facts, market), rows = networkTotals.filter(row => !ids || ids.has(row.campaignId));
      const spend = rows.reduce((sum, row) => sum + row.spendMicros, 0n), youtube = rows.filter(row => isYouTubeNetwork(row.network)).reduce((sum, row) => sum + row.spendMicros, 0n);
      const value = spend > 0n ? Number(youtube) / Number(spend) * 100 : null;
      const grouped = new Map<string, bigint>();
      for (const row of rows) grouped.set(row.network, (grouped.get(row.network) ?? 0n) + row.spendMicros);
      return [market, dial('YouTube share', value, '%', `${market === 'all' ? 'All markets' : market.toUpperCase()} · last 7 complete UK days · information`,
        `${formatPounds(Number(youtube) / 1_000_000)} of ${formatPounds(Number(spend) / 1_000_000)} Google spend was on explicit YouTube networks. Mixed and unrecognised networks remain separate.`,
        'Share is information only, with no good or bad zones. Watch rules judge each campaign and network by its seven-day spend and ROAS.', `${freshness(facts, 'networks', now)} · ${campaignNote}`,
        [...grouped].map(([network, cost]) => [googleNetworkName(network), formatPounds(Number(cost) / 1_000_000)]))];
    })) as Record<HeroMarket, DialModel>;
    snapshot.widgets.w024 = { kind: 'dial', source: ['google-ads'], mode: 'live', value: models.all, markets: models };
  }
  if (googleCovers(facts, 'conversions', today, today, true) && campaignFresh && (campaignJob?.currency ?? facts.currency) === 'GBP') {
    const enabled = facts.campaigns.filter(row => row.status === 'ENABLED');
    if (enabled.reduce((sum, row) => sum + BigInt(row.budgetMicros), 0n) > 0n) {
      const models = Object.fromEntries(markets.map(market => {
        const ids = googleCampaignIds(facts, market);
        const plan = enabled.filter(row => market === 'all' || googleCampaignMarket(row) === market).reduce((sum, row) => sum + BigInt(row.budgetMicros), 0n);
        const spend = facts.conversions.filter(row => row.day === today && (!ids || ids.has(row.campaignId))).reduce((sum, row) => sum + BigInt(row.spendMicros), 0n);
        return [market, dial('Google spend vs plan', plan > 0n ? Number(spend) / Number(plan) * 100 : null, '%', `${market === 'all' ? 'All markets' : market.toUpperCase()} · today so far · budget plan assumption`,
          `${formatPounds(Number(spend) / 1_000_000)} spent against ${formatPounds(Number(plan) / 1_000_000)}: the sum of currently enabled campaigns’ daily budgets. This is the plan assumption, not a separate agreed target.`,
          'Today so far against current enabled daily budgets. Google can spend unevenly during a day; no automatic budget change.', freshness(facts, 'conversions', now),
          [['Budget read', campaignJob?.lastSuccessAt ? formatUkTime(campaignJob.lastSuccessAt) : 'Unknown']], 150)];
      })) as Record<HeroMarket, DialModel>;
      snapshot.widgets.w025 = { kind: 'dial', source: ['google-ads'], mode: 'live', value: models.all, markets: models };
    }
  }
  if (googleCovers(facts, 'conversions', from, to) && hasCampaigns) {
    const shopifyComplete = shopify.mode === 'live' && shopify.ready && shopify.from <= from && !!shopify.through && shopify.through >= to;
    const models = Object.fromEntries(markets.map(market => {
      const ids = googleCampaignIds(facts, market), rows = facts.conversions.filter(row => row.day >= from && row.day <= to && (!ids || ids.has(row.campaignId)));
      const spend = rows.reduce((sum, row) => sum + BigInt(row.spendMicros), 0n), value = rows.reduce((sum, row) => sum + BigInt(row.conversionValueMicros), 0n);
      const conversions = rows.reduce((sum, row) => sum + row.conversions, 0);
      const attributed = shopify.orders.filter(order => order.day >= from && order.day <= to && countedOrder(order, market) && isGooglePaidOrder(order));
      const shopifyLine = shopifyComplete ? `${formatNumber(attributed.length)} Shopify orders with last-visit Google paid credit`
        : `Shopify comparison unavailable · ${shopify.mode === 'sample' ? 'Shopify is on sample data' : 'order history is incomplete'}`;
      const campaignLines: [string, string][] = facts.campaigns.filter(campaign => !ids || ids.has(campaign.id)).map(campaign => {
        const claims = rows.filter(row => row.campaignId === campaign.id).reduce((sum, row) => sum + row.conversions, 0);
        const matches = attributed.filter(order => order.lastVisit?.campaign === campaign.id).length;
        return [campaign.name, `${formatNumber(claims, 2)} Google conversions · ${shopifyComplete ? `${formatNumber(matches)} Shopify campaign-ID matches` : 'Shopify comparison unavailable'}`];
      });
      return [market, dial('Google ROAS 7d', spend > 0n ? Number(value) / Number(spend) : null, '×', `${market === 'all' ? 'All markets' : market.toUpperCase()} · last 7 complete UK days`,
        `Google claims ${formatNumber(conversions, 2)} conversions and ${formatPounds(Number(value) / 1_000_000)} conversion value. ${shopifyLine}.`,
        'Google conversion value ÷ Google cost. Shopify orders use last-visit gclid or Google paid UTMs; both views keep their own attribution. No guessed split for unnamed or conflicting markets.', `${freshness(facts, 'conversions', now)} · ${campaignNote}`,
        [['Window', `${from}–${to} · UK days`], ['Google conversions', formatNumber(conversions, 2)], ['Google conversion value', formatPounds(Number(value) / 1_000_000)], ['Shopify view', shopifyLine],
          ['Shopify read', shopify.lastRead ? formatUkTime(shopify.lastRead) : 'Unavailable'], ['Campaign matching', 'Shopify campaign-ID matches can be lower: readable-name UTMs and gclid alone do not identify a campaign. All credited orders remain in the Shopify total.'], ...campaignLines,
          ...Array.from({ length: 7 }, (_, index): [string, string] => { const day = addDays(from, index); return [day, `${formatNumber(rows.filter(row => row.day === day).reduce((sum, row) => sum + row.conversions, 0), 2)} Google conversions · ${shopifyComplete ? `${formatNumber(attributed.filter(order => order.day === day).length)} Shopify Google-paid orders` : 'Shopify comparison unavailable'}`]; })], 6)];
    })) as Record<HeroMarket, DialModel>;
    snapshot.widgets.w026 = { kind: 'dial', source: shopifyComplete ? ['google-ads', 'shopify'] : ['google-ads'], mode: 'live', value: models.all, markets: models };
  }
  const changes = facts.jobs.find(row => row.kind === 'changes');
  const asOf = Math.min(now.getTime(), Date.parse(metaActivity?.lastRead ?? ''), Date.parse(changes?.lastSuccessAt ?? ''), Date.parse(changes?.coverage?.to ?? ''));
  const start = asOf - 24 * 60 * 60_000;
  if (metaActivity?.hasRead && metaActivity.lastRead && !metaActivity.error && now.getTime() - Date.parse(metaActivity.lastRead) <= SPEND_STALE_AFTER_MS
    && changes?.lastSuccessAt && !changes.error && now.getTime() - Date.parse(changes.lastSuccessAt) <= 2 * GOOGLE_CHANGE_INTERVAL_MS && changes.coverage?.basis === 'instant'
    && Number.isFinite(asOf) && Date.parse(changes.coverage.from) <= start) {
    const google = facts.changes.filter(row => Date.parse(row.at) >= start && Date.parse(row.at) <= asOf).length;
    const meta = metaActivity.events.filter(row => Date.parse(row.time) >= start && Date.parse(row.time) <= asOf && !settings.ourActors.some(actor => actor.actorId === row.actorId)).length;
    snapshot.widgets.w028 = { kind: 'detail', source: ['meta', 'google-ads'], mode: 'live', state: 'info', value: {
      why: `${formatNumber(meta)} Meta changes not by our configured actors · ${formatNumber(google)} Google changes by all actors, in the 24 hours ending ${formatUkTime(new Date(asOf))}. Google actor identity is not read.`,
      rule: 'Review only. Meta uses Our actors from Settings; Google reports all changes, so no Google change is labelled not by us.',
      src: `${metaActivity.line} · ${freshness(facts, 'changes', now)}`,
    } };
    for (const [key, value] of [['t0254', 'Account changes'], ['t0255', `${formatNumber(meta)} · ${formatNumber(google)}`], ['t0256', 'Meta not ours · Google all · 24h']] as const)
      snapshot.textValues[key] = { source: ['meta', 'google-ads'], mode: 'live', value };
  }
}
