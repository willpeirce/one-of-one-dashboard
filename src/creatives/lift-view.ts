import { formatNumber, formatPounds } from '../money.js';
import { escapeCreative as e } from './html.js';
import type { CreativeLift, LiftWindowDays } from './lifts.js';
import type { CreativeBrief, CreativeLiftPresentation } from './lift-presentation.js';
import type { SourceMode } from '../sources.js';
import { strengthMeter } from './strength-meter.js';

const ratio = (value: number | null) => value === null ? '—' : `${formatNumber(value, 2)}×`;
const percent = (value: number | null) => value === null ? '—' : `${formatNumber(value * 100, 1)}%`;
const cpp = (value: number | null) => value === null ? '—' : formatPounds(value);
const when = (value: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const copyIcon = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M15 5V3H3v13h2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';

export function briefBulletsHtml(brief: CreativeBrief): string {
  return brief.bullets.length ? `<ul class="creative-brief-bullets">${brief.bullets.map(bullet => `<li><span data-brief-text>${e(bullet.text)}</span> ${strengthMeter(bullet.confidence)}</li>`).join('')}</ul>` : `<p class="creative-brief-empty">${e(brief.empty)}</p>`;
}
export function creativeLiftsHtml(presentation: Pick<CreativeLiftPresentation, 'makeNext'>, mode: SourceMode, windowDays: LiftWindowDays = 7): string {
  return `<section class="creative-lifts" aria-labelledby="creative-lifts-title"><header class="creative-heading"><h2 id="creative-lifts-title">Make next</h2><div class="seg" role="group" aria-label="Evidence window">${([1, 3, 7] as const).map(days => `<button type="button" data-lift-window="${days}" aria-pressed="${windowDays === days}">${days} ${days === 1 ? 'day' : 'days'}</button>`).join('')}</div></header>${mode === 'sample' ? '<p class="sample-banner">Sample data · invented lift illustrations.</p>' : ''}<div class="creative-brief-grid">${(['video', 'image'] as const).map(kind => {
    const next = presentation.makeNext[kind];
    return `<article class="glass creative-make-next" data-make-next="${kind}"><header><h3>${kind === 'video' ? 'Video' : 'Image'}</h3><div class="creative-brief-actions"><button class="btn" type="button" data-full-evidence="${kind}">Full evidence</button><button class="btn creative-copy-icon" type="button" data-creative-copy="${e(next.brief)}" aria-label="Copy ${kind} instructions" title="Copy">${copyIcon}</button></div></header>${briefBulletsHtml(next)}${next.examples.length ? `<p class="creative-brief-examples">Copy: ${next.examples.map(example => `<button class="text-btn" data-creative-open="${e(example.id)}" type="button">${e(example.title)}</button>`).join(' · ')}</p>` : ''}<p class="note creative-brief-footer">${e(next.footer)}</p></article>`;
  }).join('')}</div></section>`;
}

export function fullEvidenceHtml(lifts: readonly CreativeLift[], kind: 'video' | 'image', windowDays: LiftWindowDays, mode: SourceMode): string {
  const rows = lifts.filter(lift => lift.kind === kind && lift.windowDays === windowDays);
  const side = (metrics: CreativeLift['metrics']['with']) => `${cpp(metrics.costPerPurchase)} / purchase<br>${ratio(metrics.roas)} ROAS<br>${formatNumber(metrics.purchases)} purchases<br>Add-to-cart ${percent(metrics.addToCartRate)}${kind === 'video' ? `<br>Hook ${percent(metrics.hookRate)} · Hold ${percent(metrics.holdRate)}` : ''}<br>${formatNumber(metrics.groupCount)} groups · ${formatPounds(metrics.spend)} spend`;
  return `<h2 id="creative-sheet-title">Full evidence · ${kind === 'video' ? 'Video' : 'Image'} · ${windowDays} ${windowDays === 1 ? 'day' : 'days'}</h2><p class="note">${mode === 'sample' ? 'Sample data · invented figures. ' : ''}Patterns, not proof. Video hold uses ThruPlays and 3-second plays from matching Meta account days when its timezone differs from UK time. Meta says · groups with each value against groups with another known value.</p>${rows.length ? `<table class="creative-table creative-lift-table"><thead><tr><th>Finding</th><th>Strength</th><th>With</th><th>Without</th><th>Evidence</th></tr></thead><tbody>${rows.map(lift => `<tr><th data-label="Finding"><span>${e(lift.label)}</span></th><td data-label="Strength">${strengthMeter(lift.confidence)}</td><td data-label="With"><span>${side(lift.metrics.with)}</span></td><td data-label="Without"><span>${side(lift.metrics.without)}</span></td><td data-label="Evidence"><span>${percent(lift.metrics.share)} of 200 group resamples held<br>${e(lift.metrics.from)}–${e(lift.metrics.to)} UK days<br>Computed <time datetime="${e(lift.computedAt)}">${e(when(lift.computedAt))} UK</time></span></td></tr>`).join('')}</tbody></table>` : '<p>No findings in this window yet.</p>'}`;
}
export function homeMakeNextHtml(briefs: CreativeLiftPresentation['makeNext'], compact = true): string {
  if (compact) {
    const confidence = { Hint: 1, Likely: 2, Strong: 3 };
    const score = (kind: 'video' | 'image') => { const first = briefs[kind].bullets[0]; return first ? confidence[first.confidence] : 0; };
    const kind = score('image') > score('video') ? 'image' : 'video', brief = briefs[kind];
    return `<article class="creative-home-well" data-home-make-next="${kind}"><header><h4><a href="/creatives">Make next · ${kind}</a></h4>${brief.bullets.length ? `<button class="btn creative-copy-icon" type="button" data-creative-copy="${e(brief.brief)}" aria-label="Copy brief">${copyIcon}</button>` : ''}</header>${briefBulletsHtml({ ...brief, bullets: brief.bullets.slice(0, 3) })}</article>`;
  }
  return `<div class="creative-home-briefs">${(['video', 'image'] as const).map(kind => {
    const brief = briefs[kind], first = brief.bullets[0];
    return `<a class="glass creative-home-brief" href="/creatives"><h4>Make next · ${kind}</h4><p>${e(brief.line)} ${first ? strengthMeter(first.confidence) : ''}</p><small>7 days · Patterns, not proof.</small></a>`;
  }).join('')}</div>`;
}
