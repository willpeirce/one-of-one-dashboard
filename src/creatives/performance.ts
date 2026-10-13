import { addDays } from '../hero-range.js';
import type { Settings } from '../settings.js';
import type { CreativeData } from './model.js';
import { aggregateCreativeGroups, creativeTotals, type CreativeFilter, type GroupPerformance } from './ranking.js';
import { exactCreativeFrequency, hasFadingHistory } from './frequency.js';

export type CreativePerformanceSettings = Pick<Settings, 'cppUkTargetGbp' | 'cppUsTargetGbp' | 'creativeWeeklyTarget'
  | 'creativeHitWinnerSpendGbp' | 'creativeHitKilledSpendGbp' | 'creativeHitKilledTargetMultiplier'
  | 'creativeFadeFrequency' | 'creativeFadeCtrDropPercent'>;
export type HitVerdict = 'winner' | 'killed' | 'testing';

/** A parent running in both markets uses purchase-weighted targets; unplaced spend has no target. */
export function creativeHitVerdict(row: GroupPerformance, data: CreativeData, settings: CreativePerformanceSettings, today: string): HitVerdict {
  const ads = new Map(row.ads.map(ad => [ad.id, ad]));
  const insights = data.insights.filter(insight => insight.day <= today && ads.has(insight.adId));
  if (insights.some(insight => (insight.spend > 0 || insight.purchases > 0)
    && ads.get(insight.adId)?.market === 'unknown')) return 'testing';
  const targetFor = (adId: string) => ads.get(adId)?.market === 'uk' ? settings.cppUkTargetGbp : settings.cppUsTargetGbp;
  const purchases = insights.reduce((sum, insight) => sum + insight.purchases, 0);
  const weight = purchases > 0 ? purchases : row.totals.spend;
  const target = weight > 0 ? insights.reduce((sum, insight) => sum
    + (purchases > 0 ? insight.purchases : insight.spend) * targetFor(insight.adId), 0) / weight : null;
  if (target === null || target <= 0) return 'testing';
  const cpp = row.totals.costPerPurchase ?? Infinity;
  if (row.totals.spend >= settings.creativeHitWinnerSpendGbp && cpp < target) return 'winner';
  if (row.totals.spend >= settings.creativeHitKilledSpendGbp && cpp > target * settings.creativeHitKilledTargetMultiplier) return 'killed';
  return 'testing';
}

export interface FadingCreative {
  groupId: string;
  title: string;
  reasons: string[];
  frequency: number | null;
  ctrDropPercent: number | null;
}

export function creativePerformance(data: CreativeData, settings: CreativePerformanceSettings,
  options: CreativeFilter & { today: string }) {
  const { today } = options;
  const groups = aggregateCreativeGroups(data, { ...options, to: today });
  const cohort = groups.filter(row => row.firstSpendDay && row.firstSpendDay >= addDays(today, -29) && row.firstSpendDay <= today);
  const verdicts = cohort.map(row => creativeHitVerdict(row, data, settings, today));
  const winners = verdicts.filter(verdict => verdict === 'winner').length;
  const killed = verdicts.filter(verdict => verdict === 'killed').length;
  const newCount = groups.filter(row => row.firstSpendDay && row.firstSpendDay >= addDays(today, -6) && row.firstSpendDay <= today).length;
  const fading: FadingCreative[] = [];
  let frequencyUnavailable = 0;
  for (const row of groups) {
    if (!hasFadingHistory(row, today)) continue;
    const ids = new Set(row.ads.map(ad => ad.id));
    const history = data.insights.filter(insight => ids.has(insight.adId) && insight.day <= today);
    const recent = creativeTotals(history.filter(insight => insight.day >= addDays(today, -6)));
    const frequency = exactCreativeFrequency(data, [...ids], addDays(today, -6), today);
    if (frequency === null) frequencyUnavailable++;
    // Skip the initial, potentially partial, spend day; wait for seven complete days.
    const firstWeekStart = addDays(row.firstSpendDay!, 1), firstWeekEnd = addDays(row.firstSpendDay!, 7);
    const baseline = firstWeekEnd < today ? creativeTotals(history.filter(insight => insight.day >= firstWeekStart
      && insight.day <= firstWeekEnd)) : null;
    const ctrDropPercent = baseline?.ctr && recent.ctr !== null ? (1 - recent.ctr / baseline.ctr) * 100 : null;
    const reasons: string[] = [];
    if (frequency !== null && frequency > settings.creativeFadeFrequency + 1e-10)
      reasons.push(`frequency ${frequency.toFixed(1)}, seen too often`);
    if (ctrDropPercent !== null && ctrDropPercent + 1e-10 >= settings.creativeFadeCtrDropPercent)
      reasons.push(`clicks ${Math.round(ctrDropPercent)}% under its first week`);
    if (reasons.length) fading.push({ groupId: row.group.id, title: row.group.title, reasons,
      frequency, ctrDropPercent });
  }
  const hitRate = { winners, killed, testing: cohort.length - winners - killed, total: cohort.length,
    label: `hit rate ${winners} of ${cohort.length}` };
  const newThisWeek = { count: newCount, target: settings.creativeWeeklyTarget,
    label: `New this week ${newCount} of ${settings.creativeWeeklyTarget}` };
  return { hitRate, newThisWeek, fading, frequencyUnavailable, label: `${newThisWeek.label} · ${hitRate.label}` };
}
