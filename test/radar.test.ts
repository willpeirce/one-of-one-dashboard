import assert from 'node:assert/strict';
import test from 'node:test';
import { radarChartHtml, radarGaugeScore, radarMeasure, radarSummary, weakestRadarGauge, type RadarAdSource, type RadarArea } from '../src/radar.js';

const source = (id: RadarAdSource['source'], overrides: Partial<RadarAdSource> = {}): RadarAdSource => ({
  source: id, live: true, status: 'live', fetchedAt: '2026-09-30T10:00:00Z', ...overrides,
});
const areas = (scores: (number | null)[]): RadarArea[] => scores.map((score, index) => ({
  key: `area-${index}`, name: `Area ${index}`, target: `gauge-${index}`,
  measure: { score, label: score === null ? 'Not built' : `${score * 100}%`, reason: `Invented reason ${index}.` },
}));

test('unbuilt, unconfigured and pending radar areas have no measured score', () => {
  for (const key of ['growth', 'store', 'email', 'stock']) {
    assert.equal(radarMeasure(key).score, null);
    assert.equal(radarMeasure(key).label, 'Not built');
    assert.equal(radarMeasure(key, { good: 0, warn: 0, alarm: 0 }).score, null);
  }
  for (const [key, id] of [['meta', 'meta'], ['google', 'google-ads']] as const) {
    assert.equal(radarMeasure(key, undefined, [source(id, { live: false })]).score, null);
    assert.equal(radarMeasure(key, undefined, [source(id, { live: false })]).label, 'Waiting for keys');
    assert.equal(radarMeasure(key, undefined, [source(id, { fetchedAt: null })]).score, null);
    // A previously measured feed failure stays a measured problem, never an unbuilt area.
    assert.equal(radarMeasure(key, undefined, [source(id, { failures: 1 })]).score, 0);
    assert.equal(radarMeasure(key, undefined, [source(id, { failures: 1, fetchedAt: null })]).score, null);
  }
});

test('health averages measured areas equally and needs at least three', () => {
  for (const scores of [[], [null, null], [1], [1, 0.5, null, null]]) {
    assert.equal(radarSummary(areas(scores)).health, null);
    assert.match(radarChartHtml(areas(scores)), /Not enough/);
    assert.doesNotMatch(radarChartHtml(areas(scores)), /radar-health[^>]*>100</);
  }
  assert.equal(radarSummary(areas([1, 0.5, 0, null, null, null])).health, 50);
  assert.equal(radarSummary(areas([1, 1, 0.5, null, null, null])).health, 83);
});

test('unmeasured spokes are grey and dashed with their dots at the rim and Source health targets', () => {
  const html = radarChartHtml(areas([null, 0.5, 1, null, 0, null]));
  assert.match(html, /class="radar-spoke" data-radar-area="area-0" data-measured="false"[^>]*x2="160" y2="42" stroke="var\(--info\)"[^>]*stroke-dasharray="4 4"/);
  assert.match(html, /class="radar-dot" data-measured="false" cx="160" cy="42"[^>]*fill="var\(--info\)"/);
  assert.match(html, /data-radar-key="area-0" href="\/sources"[^>]*Open Source health/);
  assert.equal((html.match(/data-radar-key="area-0" href="\/sources"/g) ?? []).length, 2, 'Dot and label both link to Source health');
  assert.equal((html.match(/data-radar-key="area-1" href="#gauge-1"/g) ?? []).length, 2, 'Measured dot and label both target the gauge');
  const shape = /radar-shape" points="([^"]+)"/.exec(html)?.[1];
  assert.equal(shape?.split(' ').length, 3, 'Only measured areas enter the performance shape');
  assert.ok(shape?.includes('160,150'), 'A measured zero stays at the centre');
  assert.ok(!shape?.includes('160,42'), 'The unmeasured rim point stays out of the shape');
  assert.match(html, /Not built/);
});

test('weakest line names the lowest measured area with the existing reason and escapes content', () => {
  const groups = areas([null, 0.5, 1, 0]);
  groups[3]!.name = 'Stock <script>';
  groups[3]!.measure.reason = 'An invented item is under its bar.';
  assert.equal(radarSummary(groups).weakest, groups[3]);
  const html = radarChartHtml(groups);
  assert.match(html, /Weakest: Stock &lt;script&gt;, An invented item is under its bar\./);
  assert.doesNotMatch(html, /<script>/);
  assert.match(radarChartHtml(areas([null, null])), /No measured areas yet\./);
});

test('weakest gauge follows performance state while neutral decisions and information do not lower health', () => {
  const gauges = [{ id: 'sample-good', state: 'good' }, { id: 'sample-decision', state: 'decide' },
    { id: 'sample-warning', state: 'warn' }, { id: 'sample-alarm', state: 'alarm' }];
  assert.equal(weakestRadarGauge(gauges, gauge => gauge.state)?.id, 'sample-alarm');
  assert.equal(weakestRadarGauge(gauges.slice(0, 3), gauge => gauge.state)?.id, 'sample-warning');
  assert.equal(weakestRadarGauge([{ state: 'info' }], gauge => gauge.state), undefined);
  for (const state of ['info', 'decide', 'sofar', 'est']) assert.equal(radarGaugeScore(state), null);
});
