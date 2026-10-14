import { formatNumber, formatPounds } from '../money.js';
import type { CreativeKind } from './attributes.js';
import type { CreativeLift } from './lifts.js';
import type { CreativeData } from './model.js';
import type { CreativeCard } from './presentation-types.js';
import { parentGroup } from './ranking.js';

export interface CreativeBrief { line: string; brief: string }
export interface CreativeLiftPresentation {
  winning: { video: string; image: string };
  makeNext: { video?: CreativeBrief; image?: CreativeBrief };
  cards: CreativeCard[];
}
export const creativeLiftDifference = (lift: CreativeLift): number =>
  lift.metrics.with.costPerPurchase != null && lift.metrics.without.costPerPurchase != null
    ? lift.metrics.without.costPerPurchase - lift.metrics.with.costPerPurchase : 0;
const confidenceRank = { Strong: 3, Likely: 2, Hint: 1 } as const;
const byDifference = (a: CreativeLift, b: CreativeLift): number => creativeLiftDifference(b) - creativeLiftDifference(a)
  || confidenceRank[b.confidence] - confidenceRank[a.confidence] || a.attributeKey.localeCompare(b.attributeKey) || a.value.localeCompare(b.value);
const byConfidence = (a: CreativeLift, b: CreativeLift): number => confidenceRank[b.confidence] - confidenceRank[a.confidence] || byDifference(a, b);
const displayRatio = (value: number | null, suffix: string) => value == null ? 'unavailable' : `${formatNumber(value, 2)}${suffix}`;
const percent = (value: number | null) => value == null ? 'unavailable' : `${formatNumber(value * 100, 1)}%`;
const cpp = (value: number | null) => value == null ? 'unavailable' : formatPounds(value);
const capitalise = (value: string) => value[0]!.toUpperCase() + value.slice(1);

function examplesFor(lift: CreativeLift, data: CreativeData) {
  const seen = new Set<string>();
  return lift.metrics.exampleGroupIds.flatMap(id => {
    const group = parentGroup(id, data.groups);
    if (!group || group.kind !== lift.kind || seen.has(group.id)) return [];
    seen.add(group.id);
    return [group];
  });
}

function makeBrief(kind: CreativeKind, lifts: readonly CreativeLift[], data: CreativeData): CreativeBrief {
  const line = `Next ${kind}: ${lifts.map(lift => lift.label).join(' · ')}`;
  const details = lifts.map(lift => {
    const a = lift.metrics.with, b = lift.metrics.without;
    return `${capitalise(lift.label)} — ${lift.confidence}. Meta says cost per purchase ${cpp(a.costPerPurchase)} with it vs ${cpp(b.costPerPurchase)} without it; `
      + `ROAS ${displayRatio(a.roas, '×')} vs ${displayRatio(b.roas, '×')}. `
      + `Meta says purchases ${formatNumber(a.purchases)} vs ${formatNumber(b.purchases)}; add-to-cart rate ${percent(a.addToCartRate)} vs ${percent(b.addToCartRate)}. `
      + (kind === 'video' ? `Hook rate ${percent(a.hookRate)} vs ${percent(b.hookRate)}; hold rate ${percent(a.holdRate)} vs ${percent(b.holdRate)}. ` : '')
      + `${a.groupCount} groups / ${formatPounds(a.spend)} with it, ${b.groupCount} groups / ${formatPounds(b.spend)} without it. `
      + `${formatNumber(lift.metrics.share * 100, 1)}% of 200 group resamples held. ${lift.metrics.from} to ${lift.metrics.to}.`;
  });
  const examples = examplesFor(lifts[0]!, data);
  return { line, brief: [line, '', ...details, '',
    examples.length ? `Best examples: ${examples.map(group => group.title).join('; ')}.` : 'Best examples are no longer available.',
    'These are correlations, not proof of cause. Treat this as a brief to test.',
    ...(data.mode === 'sample' ? ['Sample data: invented lift illustrations.'] : [])].join('\n') };
}

/** Panel, gallery, sheets and Decide all use the same stored evidence and plain-language brief. */
export function deriveCreativeLiftPresentation(lifts: readonly CreativeLift[], data: CreativeData): CreativeLiftPresentation {
  const result: CreativeLiftPresentation = { winning: { video: 'Not enough data yet', image: 'Not enough data yet' }, makeNext: {}, cards: [] };
  for (const kind of ['video', 'image'] as const) {
    const eligible = lifts.filter(lift => lift.kind === kind && lift.confidence !== 'Hint');
    if (!eligible.length) continue;
    result.winning[kind] = [...eligible].sort(byDifference).slice(0, 2).map(lift => `${lift.label} (${lift.confidence})`).join(' · ');
    const seen = new Set<string>();
    const compatible = [...eligible].sort(byConfidence).filter(lift => {
      if (seen.has(lift.attributeKey)) return false;
      seen.add(lift.attributeKey); return true;
    });
    const brief = makeBrief(kind, compatible, data);
    result.makeNext[kind] = brief;
    const strongest = eligible.filter(lift => lift.confidence === 'Strong').sort(byDifference)[0];
    const example = strongest && examplesFor(strongest, data)[0];
    if (!strongest || !example) continue;
    result.cards.push({ id: `creative-lift-${kind}-${encodeURIComponent(strongest.attributeKey)}-${encodeURIComponent(strongest.value)}`,
      kind: 'decide', groupId: example.id, picture: example.thumbnailUrl, mode: data.mode,
      title: `Make more like this: ${kind}`,
      reason: `${capitalise(strongest.label)} · Strong · Meta says ${cpp(strongest.metrics.with.costPerPurchase)} per purchase with it vs ${cpp(strongest.metrics.without.costPerPurchase)} without it.`,
      brief: brief.brief });
  }
  return result;
}
