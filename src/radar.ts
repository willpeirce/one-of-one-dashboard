import type { SpendFacts } from './ad-spend/store.js';
import { formatNumber } from './money.js';

export type RadarAdSource = Pick<SpendFacts['sources'][number], 'source' | 'live' | 'status' | 'fetchedAt' | 'stale' | 'failures'>;
export interface RadarMeasure { score: number | null; label: string; reason: string }
export interface RadarTally { good: number; warn: number; alarm: number; reason?: string }
export interface RadarArea { key: string; name: string; measure: RadarMeasure; target?: string }
const noMeasureReasons: Record<string, string> = {
  growth: 'Growth measures are not built yet.',
  store: 'Shopify has no measured store checks yet.',
  email: 'Mailchimp measures are not built yet.',
  stock: 'Stock or its sales rate is not available yet.',
};

/** Advertising axes describe the spend feed, independently of deferred campaign gauges. */
export function radarMeasure(key: string, tally?: RadarTally, ads?: readonly RadarAdSource[]): RadarMeasure {
  if (key === 'meta' || key === 'google') {
    const source = ads?.find(row => row.source === (key === 'meta' ? 'meta' : 'google-ads'));
    if (!source || !source.live) return { score: null, label: 'Waiting for keys', reason: 'The ad spend connection is not configured.' };
    if ((source.failures ?? 0) > 0 || source.status === 'source unavailable')
      return { score: source.fetchedAt ? 0 : null, label: 'Unavailable', reason: 'The last ad spend read failed. Check Source health.' };
    if (source.stale || source.status.startsWith('stale'))
      return { score: source.fetchedAt ? 0.5 : null, label: 'Stale', reason: 'Ad spend has missed three polls. Check Source health.' };
    if (!source.fetchedAt) return { score: null, label: 'No data yet', reason: 'The first ad spend sync is pending.' };
    return { score: 1, label: 'Live', reason: 'Ad spend is updating.' };
  }
  const total = tally ? tally.good + tally.warn + tally.alarm : 0;
  if (!tally || !total) return { score: null, label: 'Not built', reason: noMeasureReasons[key] ?? 'No measures are available for this group yet.' };
  const score = (tally.good + 0.5 * tally.warn) / total;
  return { score, label: `${formatNumber(Math.round(score * 100))}%`, reason: tally.reason ?? 'Green checks count fully; amber checks count half.' };
}

/** Decisions and information have no performance score. */
export function radarGaugeScore(state: string): number | null {
  return state === 'good' ? 1 : state === 'warn' ? 0.5 : state === 'alarm' ? 0 : null;
}

export function weakestRadarGauge<T>(gauges: readonly T[], state: (gauge: T) => string): T | undefined {
  let weakest: T | undefined, lowest = Infinity;
  for (const gauge of gauges) {
    const score = radarGaugeScore(state(gauge));
    if (score !== null && score < lowest) { weakest = gauge; lowest = score; }
  }
  return weakest;
}

export function radarSummary(areas: readonly RadarArea[]): { health: number | null; weakest?: RadarArea } {
  const measured = areas.filter(area => area.measure.score !== null);
  const weakest = measured.reduce<RadarArea | undefined>((current, area) =>
    !current || area.measure.score! < current.measure.score! ? area : current, undefined);
  return { health: measured.length < 3 ? null : Math.round(100 * measured.reduce((sum, area) => sum + area.measure.score!, 0) / measured.length),
    ...(weakest ? { weakest } : {}) };
}

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, character =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const rounded = (value: number): number => Math.round(value * 100) / 100;

/** Unmeasured points sit on the rim but never enter the shape or health average. */
export function radarChartHtml(areas: readonly RadarArea[]): string {
  const { health, weakest } = radarSummary(areas);
  const point = (index: number, radius: number): [number, number] =>
    [rounded(160 + radius * Math.cos(-Math.PI / 2 + index * 2 * Math.PI / areas.length)),
      rounded(150 + radius * Math.sin(-Math.PI / 2 + index * 2 * Math.PI / areas.length))];
  const polygon = (points: [number, number][]): string => points.map(value => value.join(',')).join(' ');
  let html = '<svg viewBox="0 0 320 300" role="group" aria-label="Business areas">';
  for (const scale of [0.25, 0.5, 0.75, 1]) html += `<polygon points="${polygon(areas.map((_, index) => point(index, 108 * scale)))}" fill="none" stroke="var(--line)" stroke-width="1" aria-hidden="true"/>`;
  areas.forEach((area, index) => {
    const [x, y] = point(index, 108), unmeasured = area.measure.score === null;
    html += `<line class="radar-spoke" data-radar-area="${escapeHtml(area.key)}" data-measured="${!unmeasured}" x1="160" y1="150" x2="${x}" y2="${y}" stroke="${unmeasured ? 'var(--info)' : 'var(--line)'}" stroke-width="${unmeasured ? 1.5 : 1}"${unmeasured ? ' stroke-dasharray="4 4"' : ''} aria-hidden="true"/>`;
  });
  html += health === null
    ? '<text class="radar-health" x="160" y="150" text-anchor="middle" font-family="var(--disp)" font-size="19" font-weight="700" fill="var(--ink)" fill-opacity=".45">Not enough <tspan x="160" dy="22">data</tspan></text>'
    : `<text class="radar-health" x="160" y="172" text-anchor="middle" font-family="var(--disp)" font-size="64" font-weight="800" fill="var(--ink)" fill-opacity=".18">${formatNumber(health)}</text><text x="160" y="190" text-anchor="middle" font-family="var(--disp)" font-size="11" font-weight="700" letter-spacing="1.5" fill="var(--ink)" fill-opacity=".45">HEALTH</text>`;
  const measuredPoints = areas.flatMap((area, index) => area.measure.score === null ? [] : [point(index, 108 * area.measure.score)]);
  if (measuredPoints.length > 1) html += `<${measuredPoints.length > 2 ? 'polygon' : 'polyline'} class="radar-shape" points="${polygon(measuredPoints)}" fill="${measuredPoints.length > 2 ? 'var(--accent)' : 'none'}" fill-opacity=".28" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" aria-hidden="true"/>`;
  areas.forEach((area, index) => {
    const unmeasured = area.measure.score === null, [dotX, dotY] = point(index, 108 * (area.measure.score ?? 1));
    const [x, y] = point(index, 132), centered = Math.abs(x - 160) < 2;
    const statusX = centered ? x : x > 160 ? 320 : 0, statusAnchor = centered ? 'middle' : x > 160 ? 'end' : 'start';
    const href = unmeasured || !area.target ? '/sources' : `#${area.target}`;
    const attributes = `class="radar-target" data-radar-key="${escapeHtml(area.key)}" href="${escapeHtml(href)}" aria-label="${escapeHtml(`${area.name}: ${area.measure.label}. ${unmeasured || !area.target ? 'Open Source health' : 'Open weakest gauge'}`)}"`;
    html += `<a ${attributes}><title>${escapeHtml(area.measure.reason)}</title><circle class="radar-hit" cx="${dotX}" cy="${dotY}" r="13" fill="transparent"/><circle class="radar-dot" data-measured="${!unmeasured}" cx="${dotX}" cy="${dotY}" r="4.5" fill="${unmeasured ? 'var(--info)' : 'var(--accent)'}" stroke="var(--pointer-ring)" stroke-width="2"/></a>`;
    html += `<a ${attributes}><title>${escapeHtml(area.measure.reason)}</title><text x="${x}" y="${y}" text-anchor="${centered ? 'middle' : x > 160 ? 'start' : 'end'}" font-family="var(--disp)" font-size="13" font-weight="600" fill="var(--ink)">${escapeHtml(area.name)}<tspan x="${statusX}" text-anchor="${statusAnchor}" dy="14" font-size="11" font-weight="500" fill="var(--muted)">${escapeHtml(area.measure.label)}</tspan></text></a>`;
  });
  return `${html}</svg><p class="radar-reason radar-weakest">${weakest ? `Weakest: ${escapeHtml(weakest.name)}, ${escapeHtml(weakest.measure.reason)}` : 'No measured areas yet.'}</p>`;
}
