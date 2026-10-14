import { formatNumber, formatPounds } from '../money.js';
import { escapeCreative as e } from './html.js';
import type { CreativeLift } from './lifts.js';
import type { CreativeLiftPresentation } from './lift-presentation.js';
import type { SourceMode } from '../sources.js';

const ratio = (value: number | null) => value === null ? '—' : `${formatNumber(value, 2)}×`;
const cpp = (value: number | null) => value === null ? '—' : formatPounds(value);
const when = (value: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

export function creativeLiftsHtml(lifts: readonly CreativeLift[], presentation: Pick<CreativeLiftPresentation, 'makeNext'>, mode: SourceMode): string {
  return `<section class="creative-lifts" aria-labelledby="creative-lifts-title"><h2 id="creative-lifts-title">What the winners have in common</h2><p class="note">A lift is a correlation, not a cause. Video and image data stay separate.</p>${mode === 'sample' ? '<p class="sample-banner">Sample data · fixed invented lift illustrations and briefs.</p>' : ''}${(['video', 'image'] as const).map(kind => {
    const rows = lifts.filter(lift => lift.kind === kind);
    return `<h3>${kind === 'video' ? 'Video' : 'Image'} lifts</h3>${rows.length ? `<table class="creative-table creative-lift-table"><caption>Meta says · groups with each value against groups with another known value</caption><thead><tr><th>Attribute</th><th>Value</th><th>Confidence</th><th>With</th><th>Without</th><th>Computed</th></tr></thead><tbody>${rows.map(lift => `<tr><th data-label="Attribute"><span>${e(lift.attributeLabel)}</span></th><td data-label="Value"><span>${e(lift.valueLabel)}</span></td><td data-label="Confidence"><span>${e(lift.confidence)}</span></td><td data-label="With"><span>${cpp(lift.metrics.with.costPerPurchase)} / purchase<br>${ratio(lift.metrics.with.roas)} ROAS<br>${formatNumber(lift.metrics.with.groupCount)} groups · ${formatPounds(lift.metrics.with.spend)}</span></td><td data-label="Without"><span>${cpp(lift.metrics.without.costPerPurchase)} / purchase<br>${ratio(lift.metrics.without.roas)} ROAS<br>${formatNumber(lift.metrics.without.groupCount)} groups · ${formatPounds(lift.metrics.without.spend)}</span></td><td data-label="Computed"><time datetime="${e(lift.computedAt)}">${e(when(lift.computedAt))} UK</time></td></tr>`).join('')}</tbody></table>` : '<p>Not enough data yet</p>'}`;
  }).join('')}<h2>Make next</h2>${(['video', 'image'] as const).map(kind => {
    const next = presentation.makeNext[kind];
    return `<div class="creative-make-next" data-make-next="${kind}"><p>${next ? e(next.line) : `Next ${kind}: Not enough data yet`}</p>${next ? `<button class="btn" type="button" data-creative-copy="${e(next.brief)}">Copy ${kind} brief</button>` : ''}</div>`;
  }).join('')}</section>`;
}
