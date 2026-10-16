import { formatNumber, formatPounds } from '../money.js';
import { addDays, ukToday } from '../hero-range.js';
import { attributesForKind, type CreativeKind } from './attributes.js';
import type { CreativeLift, LiftConfidence, LiftMarket, LiftWindowDays } from './lifts.js';
import { creativeLiftLabel, mergeInstructions } from './lift-phrasing.js';
import type { CreativeData } from './model.js';
import type { CreativeCard } from './presentation-types.js';
import { aggregateCreativeGroups, parentGroup } from './ranking.js';

export interface CreativeBullet { text: string; confidence: LiftConfidence; liftIds: string[] }
export interface CreativeBrief {
  line: string; brief: string; bullets: CreativeBullet[];
  examples: { id: string; title: string }[]; footer: string; empty: string;
}
export interface CreativeLiftPresentation {
  makeNext: Record<CreativeKind, CreativeBrief>;
  cards: CreativeCard[];
}
export const creativeLiftDifference = (lift: CreativeLift): number =>
  lift.metrics.with.costPerPurchase != null && lift.metrics.without.costPerPurchase != null
    ? lift.metrics.without.costPerPurchase - lift.metrics.with.costPerPurchase : 0;
const confidenceRank = { Strong: 3, Likely: 2, Hint: 1 } as const;
const byConfidence = (a: CreativeLift, b: CreativeLift): number => confidenceRank[b.confidence] - confidenceRank[a.confidence]
  || creativeLiftDifference(b) - creativeLiftDifference(a) || a.attributeKey.localeCompare(b.attributeKey) || a.value.localeCompare(b.value);
const pounds = (value: number) => formatPounds(value, n => formatNumber(n, Number.isInteger(n) ? 0 : 2));
const percent = (value: number) => `${formatNumber(value * 100, 0)}%`;
const close = (a: number | null, b: number | null) => a != null && b != null && Math.abs(a - b) <= Math.abs(b) * .1;

/** One comparison per bullet; never mix the purchase, cart and hook measures. */
export function liftComparison(lift: CreativeLift): string {
  const a = lift.metrics.with, b = lift.metrics.without;
  if (close(a.costPerPurchase, b.costPerPurchase) || a.costPerPurchase == null || b.costPerPurchase == null) {
    if (lift.kind === 'video' && close(a.addToCartRate, b.addToCartRate) && a.hookRate != null && b.hookRate != null) {
      return `Hook ${percent(a.hookRate)} against ${percent(b.hookRate)}.`;
    }
    if (a.addToCartRate != null && b.addToCartRate != null) return `Add-to-cart ${percent(a.addToCartRate)} against ${percent(b.addToCartRate)}.`;
  }
  if (a.costPerPurchase == null || b.costPerPurchase == null) return 'Purchase cost unavailable.';
  return lift.value === 'no' ? `${pounds(a.costPerPurchase)} a purchase without it, ${pounds(b.costPerPurchase)} with.`
    : `${pounds(a.costPerPurchase)} a purchase against ${pounds(b.costPerPurchase)}.`;
}

function sameAds(a: CreativeLift, b: CreativeLift): boolean {
  const x = new Set(a.metrics.withGroupIds), y = new Set(b.metrics.withGroupIds);
  if (!x.size || !y.size || Math.abs(x.size - y.size) > 1) return false;
  const [small, large] = x.size < y.size ? [x, y] : [y, x];
  return [...small].every(id => large.has(id));
}
function instruction(lift: CreativeLift): string {
  const attribute = attributesForKind(lift.kind).find(attribute => attribute.key === lift.attributeKey);
  return attribute ? creativeLiftLabel(attribute, lift.value) : `${lift.attributeLabel}: ${lift.valueLabel}`;
}
export function emptyBrief(windowDays: LiftWindowDays): string {
  return windowDays === 1 ? 'Too early for 1 day, see 3 days.' : windowDays === 3 ? 'Too early for 3 days, see 7 days.' : 'Not enough yet. Scans and spend fill this in.';
}

export function makeCreativeBrief(kind: CreativeKind, lifts: readonly CreativeLift[], data: CreativeData,
  windowDays: LiftWindowDays, market: LiftMarket, today: string): CreativeBrief {
  const eligible = lifts.filter(lift => lift.kind === kind && lift.windowDays === windowDays && lift.market === market && lift.confidence !== 'Hint').sort(byConfidence);
  const clusters: CreativeLift[][] = [], seen = new Set<string>();
  for (const lift of eligible) {
    if (seen.has(lift.attributeKey)) continue;
    seen.add(lift.attributeKey);
    // Compare to every member: do not transitively merge two different ad sets.
    const cluster = clusters.find(group => group.every(other => sameAds(other, lift)));
    if (cluster) cluster.push(lift); else clusters.push([lift]);
  }
  const bullets = clusters.slice(0, 3).map(group => ({
    text: `${mergeInstructions(group.map(instruction))}. ${liftComparison(group[0]!)}`,
    confidence: group[0]!.confidence, liftIds: group.map(lift => lift.id),
  }));
  const top = eligible[0], seenExamples = new Set<string>();
  const examples = (top?.metrics.exampleGroupIds ?? []).flatMap(id => {
    const group = parentGroup(id, data.groups);
    if (!group || group.kind !== kind || seenExamples.has(group.id)) return [];
    seenExamples.add(group.id); return [{ id: group.id, title: group.title }];
  }).slice(0, 2);
  const groups = aggregateCreativeGroups(data, { kind, market, from: addDays(today, 1 - windowDays), to: today });
  const spend = groups.reduce((sum, group) => sum + group.totals.spend, 0);
  const thin = top && (top.metrics.with.groupCount < 5 || top.metrics.without.groupCount < 5);
  const footer = `${formatNumber(groups.length)} ${kind === 'video' ? 'videos' : 'images'}, ${pounds(spend)} spend. Patterns, not proof.${thin ? ' Thin evidence, read loosely.' : ''}`;
  const empty = bullets.length ? '' : emptyBrief(windowDays);
  const copyLine = examples.length ? `Copy: ${examples.map(example => example.title).join(' · ')}` : '';
  return { bullets, examples, footer, empty, line: bullets[0]?.text ?? empty,
    brief: [...(bullets.length ? bullets.map(bullet => `${bullet.text} [${bullet.confidence}]`) : [empty]), ...(copyLine ? [copyLine] : []), footer].join('\n') };
}

/** Home, library, sheets and Decide use the same ordered findings and stored strength. */
export function deriveCreativeLiftPresentation(lifts: readonly CreativeLift[], data: CreativeData,
  options: { windowDays?: LiftWindowDays; market?: LiftMarket; today?: string } = {}): CreativeLiftPresentation {
  const windowDays = options.windowDays ?? 7, market = options.market ?? 'all';
  const today = options.today ?? lifts[0]?.metrics.to ?? ukToday(new Date());
  const makeNext = Object.fromEntries((['video', 'image'] as const).map(kind => [kind,
    makeCreativeBrief(kind, lifts, data, windowDays, market, today)])) as CreativeLiftPresentation['makeNext'];
  const cards: CreativeCard[] = [];
  for (const kind of ['video', 'image'] as const) {
    const brief = makeNext[kind], first = brief.bullets[0], example = brief.examples[0];
    if (!first || first.confidence !== 'Strong' || !example) continue;
    const strongest = lifts.find(lift => lift.id === first.liftIds[0])!;
    cards.push({ id: `creative-lift-${kind}-${encodeURIComponent(strongest.attributeKey)}-${encodeURIComponent(strongest.value)}`,
      kind: 'decide', groupId: example.id, picture: data.groups.find(group => group.id === example.id)!.thumbnailUrl, mode: data.mode,
      title: `Make more like this: ${kind}`, reason: first.text, strength: first.confidence, brief: brief.brief });
  }
  return { makeNext, cards };
}
