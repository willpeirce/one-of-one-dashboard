import type { DashboardSnapshot } from '../dashboard-types.js';
import type { Settings } from '../settings.js';
import type { SourceMode } from '../sources.js';
import type { TickerSnapshot } from '../ticker/model.js';
import type { CreativeView } from '../creatives/presentation-types.js';
import { formatPounds } from '../money.js';
import { addDays, ukToday } from '../hero-range.js';
import type { Database } from '../db.js';
import { googleCovers } from '../google-ads/metrics.js';
import { emptyGoogleFacts, googleSync } from '../google-ads/store.js';
import type { GoogleSyncState } from '../google-ads/model.js';
import type { MorningFigure, MorningInput } from './model-types.js';

/** Project the same locally stored observations Home uses; no source or database work here. */
export function morningInputFromDashboard(dashboard: DashboardSnapshot, settings: Settings, ticker: TickerSnapshot, mode: SourceMode, coverage?: MorningCoverage): MorningInput {
  const adSets = mode === 'live' && dashboard.adSets?.mode !== 'live' ? undefined : dashboard.adSets;
  const creatives = mode === 'live' && dashboard.creatives?.mode !== 'live' ? undefined : dashboard.creatives;
  const health = new Map(dashboard.sourceHealth?.map(row => [row.source, row]));
  const healthy = (source: string): boolean => {
    const row = [...health.values()].find(item => item.source === source);
    return !!row && (row.mode === 'sample' ? mode === 'sample' : row.status === 'healthy');
  };
  const sourceReadOk: Record<string, boolean> = {
    ticker: true,
    adsets: !!adSets && (adSets.mode === 'sample' || !!coverage?.adsets && !!adSets.lastRead && !adSets.stale && healthy('meta')
      && !!health.get('meta')?.lastAttemptAt && Date.parse(adSets.lastRead) >= new Date(health.get('meta')!.lastAttemptAt!).getTime()),
    creatives: !!creatives && (creatives.mode === 'sample' || !!coverage?.creatives && creatives.performance.frequencyUnavailable === 0),
    activity: !!adSets?.activity?.hasRead && !adSets.activity.error && !!adSets.activity.lastRead
      && !!health.get('meta')?.lastAttemptAt && Date.parse(adSets.activity.lastRead) >= new Date(health.get('meta')!.lastAttemptAt!).getTime(),
    google: healthy('google-ads') && (mode === 'sample' || coverage?.google === true), tests: false,
    'needs:j-and-j': true,
    'needs:pulse': [...health.values()].filter(row => row.mode === 'live').every(row => row.status === 'healthy'),
  };
  for (const source of ['shopify', 'meta', 'google-ads', 'mailchimp', 'tiktok']) sourceReadOk[`needs:${source}`] = healthy(source);
  sourceReadOk['needs:meta'] = healthy('meta') && healthy('shopify') && !!sourceReadOk.adsets && !!sourceReadOk.activity;
  sourceReadOk['needs:google-ads'] = sourceReadOk.google!;
  const sourceReadAt: Record<string, string | null> = Object.fromEntries([...health.values()].map(row =>
    [`needs:${row.source}`, row.lastSuccessAt ? new Date(row.lastSuccessAt).toISOString() : null]));
  sourceReadAt.creatives = coverage?.creativeReadAt ?? null;
  sourceReadAt.adsets = adSets?.lastRead ?? null;
  sourceReadAt.activity = adSets?.activity?.lastRead ?? null;
  sourceReadAt.google = coverage?.googleReadAt ?? null;
  sourceReadAt['needs:google-ads'] = coverage?.googleReadAt ?? null;
  return {
    mode, needs: dashboard.shopify?.needs ?? [], checks: dashboard.shopify?.checks ?? [], adSets,
    creativeCards: creatives?.cards ?? [], creativeFigures: creativeFigures(creatives), ticker, settings,
    activity: adSets?.activity?.events ?? [], metaActions: adSets?.actions ?? [], sourceReadOk, sourceReadAt,
  };
}

export interface MorningCoverage { adsets: boolean; creatives: boolean; creativeReadAt: string | null; google: boolean; googleReadAt: string | null }
/** Match the report display's four-hour freshness and certify every input used by Google needs. */
function googleCoverage(jobs: GoogleSyncState[], now: Date): Pick<MorningCoverage, 'google' | 'googleReadAt'> {
  const kinds = ['campaigns', 'networks', 'conversions'] as const;
  const facts = emptyGoogleFacts('live'); facts.jobs = jobs;
  const today = ukToday(now), from = addDays(today, -7), to = addDays(today, -1);
  const ready = kinds.every(kind => {
    const job = jobs.find(row => row.kind === kind);
    if (!job?.lastSuccessAt || !job.lastAttemptAt || job.error || job.failures || job.currency !== 'GBP') return false;
    const at = Date.parse(job.lastSuccessAt), attemptedAt = Date.parse(job.lastAttemptAt);
    return at >= attemptedAt && now.getTime() >= at && now.getTime() - at <= 4 * 60 * 60_000;
  });
  const reads = jobs.filter(job => kinds.some(kind => kind === job.kind)).flatMap(job => job.lastSuccessAt ? [job.lastSuccessAt] : []).sort();
  return { google: ready && googleCovers(facts, 'networks', from, to) && googleCovers(facts, 'conversions', from, to),
    googleReadAt: reads[0] ?? null };
}
/** Independent reads must certify their own coverage before a missing rule can clear a saved answer. */
export async function readMorningCoverage(db: Database, account: string, now: Date,
  options: { googleAccount?: string; googleNow?: Date } = {}): Promise<MorningCoverage> {
  const today = ukToday(now), from = addDays(today, -7);
  const [adDays, creative, googleJobs] = await Promise.all([
    db.query<{ count: string }>(`SELECT count(*)::text AS count FROM pulse.ad_spend_days
      WHERE source='meta' AND account_id=$1 AND uk_day >= $2 AND uk_day < $3 AND actions_complete`, [account, from, today]),
    db.query<{ last_success_at: Date | null; last_catalogue_at: Date | null; error_code: string | null;
      catalogue_error: string | null; insights_error: string | null; count: string }>(`SELECT last_success_at,last_catalogue_at,error_code,catalogue_error,insights_error,
      (SELECT count(*)::text FROM pulse.creative_insight_days WHERE account_id=$1 AND day >= $2 AND day < $3 AND completed) AS count
      FROM pulse.creative_jobs WHERE account_id=$1`, [account, from, today]),
    options.googleAccount ? googleSync(db, options.googleAccount) : Promise.resolve([]),
  ]);
  const job = creative.rows[0], fresh = (at: Date | null | undefined) => !!at && now.getTime() >= new Date(at).getTime() && now.getTime() - new Date(at).getTime() <= 2 * 60 * 60_000;
  return { adsets: Number(adDays.rows[0]?.count) === 7,
    creatives: !!job && !job.error_code && !job.catalogue_error && !job.insights_error && fresh(job.last_success_at) && fresh(job.last_catalogue_at) && Number(job.count) === 7,
    creativeReadAt: job?.last_success_at ? new Date(job.last_success_at).toISOString() : null,
    ...googleCoverage(googleJobs, options.googleNow ?? now) };
}

function creativeFigures(view: CreativeView | undefined): Record<string, MorningFigure> {
  if (!view) return {};
  const strengths = { Hint: 1, Likely: 2, Strong: 3 } as const;
  return Object.fromEntries(view.cards.map(card => {
    if (card.kind === 'watch') {
      const group = view.groups.find(row => row.group.id === card.groupId);
      const purchases = group?.totals.purchases, spend = group?.totals.spend;
      return [card.id, { kind: 'thumb', src: card.picture, alt: card.title,
        value: purchases && spend !== undefined ? formatPounds(spend / purchases) : 'Unknown', label: 'Meta cost per purchase' } satisfies MorningFigure];
    }
    const kind = view.groups.find(row => row.group.id === card.groupId)?.group.kind ?? (card.id.includes('-video-') ? 'video' : 'image');
    const variants = Object.fromEntries(([1, 3, 7] as const).map(window => {
      const brief = view.briefWindows?.[window][kind] ?? view.homeMakeNext[kind];
      return [String(window), { bullets: brief.bullets.slice(0, 3).map(bullet => ({ text: bullet.text, strength: strengths[bullet.confidence] })), text: brief.brief, footer: brief.footer }];
    })) as Extract<MorningFigure, { kind: 'brief' }>['variants'];
    return [card.id, { kind: 'brief', variants } satisfies MorningFigure];
  }));
}
