import type { DialModel, State } from '../dashboard-types.js';
import { addDays } from '../hero-range.js';
import { paceDate, paceNumber, sampleSeriesPace, type SeriesPaceMarket, type SeriesPaceResult } from './model.js';

export interface SeriesPaceMarketView extends SeriesPaceResult {
  landingDate: string;
  orderDate: string;
  landingOffsetDays: number;
  targetOverride: string | null;
  snapshots: { day: string; takenAt: string; late: boolean }[];
}
export interface SeriesPaceCard { markets: Record<SeriesPaceMarket, SeriesPaceMarketView> }

const esc = (value: string | number): string => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const whole = (value: number): string => value.toLocaleString('en-GB', { maximumFractionDigits: 0 });
export const seriesPaceRule = 'Only kit units (SKU oneofone1), including kits inside bundles. Complete UK days only. Daily sold is opening stock minus the next day’s opening stock when both snapshots are on time; otherwise it uses ShopifyQL. Missing days stay unknown; negative days stay signed. The last two complete days at zero or below mean PAUSED and count as zeros in the average. Needed = current stock ÷ days to target; projected sell-out = today + stock ÷ average. The dial shows target minus projected sell-out, from −90 to +90 days: TOO SLOW on the left, ON PACE within 5 days either side, TOO FAST on the right. Both extremes are amber. Kit shortfall or surplus is rounded to the nearest 10. Last 3 days is a trend only.';

export function sampleSeriesPaceCard(now: Date | string): SeriesPaceCard {
  const models = sampleSeriesPace(now);
  const view = (market: SeriesPaceMarket): SeriesPaceMarketView => ({ ...models[market], landingDate: models[market].targetDate,
    orderDate: addDays(models[market].today, 16), landingOffsetDays: market === 'UK' ? 104 : 74, targetOverride: null, snapshots: [] });
  return { markets: { UK: view('UK'), US: view('US') } };
}

export function paceState(model: SeriesPaceMarketView): State { return model.state === 'muted' ? 'info' : model.state; }
export function seriesPaceDial(market: SeriesPaceMarket, model: SeriesPaceMarketView): DialModel {
  return { v: model.needle, min: -90, max: 90, t: model.gap === null ? '—' : `${model.gap > 0 ? '+' : ''}${paceNumber(model.gap)}d`,
    l: market, s: model.verdict, z: [[-90, -5, 'warn'], [-5, 5, 'good'], [5, 90, 'warn']], cap: paceState(model),
    d: { why: [model.verdict, model.outcome, model.correction].filter(Boolean).join('. '), rule: seriesPaceRule, src: 'Shopify inventory snapshots and ShopifyQL kit units' } };
}

export function seriesPaceFacts(model: SeriesPaceMarketView): string {
  const targetKind = model.targetOverride ? 'your date' : 'landing date';
  const average = model.average === null ? 'not yet known' : `${paceNumber(model.average)} average`;
  const projection = model.projectedDate ? paceDate(model.projectedDate) : model.status === 'sold_out' ? 'Sold out' : model.average !== null && model.average <= 0 ? 'no sell-out at this pace' : 'not yet known';
  return `<span class="pace-facts"><span><strong>${model.stock === null ? 'Unknown' : esc(whole(model.stock))}</strong> kits left</span>
    <span>${esc(whole(Math.max(0, model.daysLeft)))} days to target · ${esc(paceDate(model.targetDate))}<br><small>${targetKind}</small></span>
    <span>${model.needed === null ? 'Needed pace not available' : `${esc(paceNumber(model.needed))} needed`} · ${esc(average)} kits a day</span>
    <span>Projected sell-out: ${esc(projection)}</span>
    ${model.outcome ? `<span class="pace-outcome">${esc(model.outcome)}</span>` : ''}
    ${model.correction ? `<strong>${esc(model.correction)}</strong>` : ''}
    ${model.trendAverage === null ? '' : `<span>last 3 days: ${esc(paceNumber(model.trendAverage))} a day${model.trend === 'up' ? ' ↑' : model.trend === 'down' ? ' ↓' : ''}</span>`}
    <small>${esc(model.averageLabel)}, complete days to ${esc(paceDate(model.completeThrough))}</small></span>`;
}

/** The same card shell is used by server rendering and each live update. */
export function seriesPaceCardHtml(card: SeriesPaceCard, mode: 'sample' | 'live'): string {
  return `<h3>Series 1 sell-out pace</h3>${mode === 'sample' ? '<small class="sample-label">Sample data</small>' : ''}<div class="series-pace-markets">${(['UK', 'US'] as const).map(market => `<button type="button" class="series-pace-market dial" data-series-market="${market}" data-src="shopify" data-state="${paceState(card.markets[market])}" aria-label="Series 1 sell-out pace · ${market}"><span class="dl">${market}</span><span class="ds">${esc(card.markets[market].verdict)}</span>${seriesPaceFacts(card.markets[market])}</button>`).join('')}</div>`;
}

export function seriesPaceSheetHtml(market: SeriesPaceMarket, model: SeriesPaceMarketView, mode: 'sample' | 'live'): string {
  const rows = Array.from({ length: 7 }, (_, index) => {
    const day = addDays(model.today, index - 7), row = model.days.find(candidate => candidate.day === day);
    return `<tr><th scope="row">${esc(paceDate(day))}</th><td>${row ? esc(whole(row.sold)) : 'Unknown'}</td><td>${row ? row.source === 'snapshot' ? 'Snapshot' : 'ShopifyQL' : 'Not available'}</td></tr>`;
  }).join('');
  const snapshots = model.snapshots.map(row => `<li>${esc(paceDate(row.day))}: ${esc(new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' }).format(new Date(row.takenAt)))} UK · ${row.late ? 'late' : 'on time'}</li>`).join('');
  return `<div class="series-pace-sheet"><h4>Last 7 complete days · kit units</h4><table class="pace-days"><thead><tr><th>UK day</th><th>Sold</th><th>Source</th></tr></thead><tbody>${rows}</tbody></table>
    <h4>Snapshots</h4>${snapshots ? `<ul class="pace-snapshots">${snapshots}</ul>` : '<p>No stock snapshots yet. Available daily sales use ShopifyQL.</p>'}
    <p>Landing date: <strong>${esc(paceDate(model.landingDate))}</strong> (${esc(paceDate(model.orderDate))} + ${model.landingOffsetDays} days).</p>
    <p data-series-date-in-force>Target in force: <strong>${esc(paceDate(model.targetDate))}</strong> · ${model.targetOverride ? 'your date' : 'landing date'}.</p>
    <form id="series-target-form" data-market="${market}"><fieldset${mode === 'sample' ? ' disabled' : ''}><legend>${market} target sell-out date</legend>
      <label for="series-target-date">Your date (leave blank to use landing date)</label><input type="date" id="series-target-date" name="targetDate" value="${esc(model.targetOverride ?? '')}">
      <div class="pace-target-actions"><button class="act primary" type="submit">Save</button><button class="act" type="button" data-series-use-landing>Use landing date</button></div>
      </fieldset><p id="series-target-status" role="status" aria-live="polite">${mode === 'sample' ? 'Target dates cannot be changed in sample mode.' : 'Saves only this target date in Pulse Settings.'}</p></form></div>`;
}
