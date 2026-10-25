import assert from 'node:assert/strict';
import test from 'node:test';
import { dropsHtml, droppedAreas, radarGaugeScore, radarMeasure, radarSummary, weakestRadarGauge, type RadarAdSource, type RadarArea } from '../src/radar.js';

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
  }
  assert.equal(radarSummary(areas([1, 0.5, 0, null, null, null])).health, 50);
  assert.equal(radarSummary(areas([1, 1, 0.5, null, null, null])).health, 83);
});

test('weakest gauge follows performance state while neutral decisions and information do not lower health', () => {
  const gauges = [{ id: 'sample-good', state: 'good' }, { id: 'sample-decision', state: 'decide' },
    { id: 'sample-warning', state: 'warn' }, { id: 'sample-alarm', state: 'alarm' }];
  assert.equal(weakestRadarGauge(gauges, gauge => gauge.state)?.id, 'sample-alarm');
  assert.equal(weakestRadarGauge(gauges.slice(0, 3), gauge => gauge.state)?.id, 'sample-warning');
  assert.equal(weakestRadarGauge([{ state: 'info' }], gauge => gauge.state), undefined);
  for (const state of ['info', 'decide', 'sofar', 'est']) assert.equal(radarGaugeScore(state), null);
});

test('drop line names alarms and stale feeds, stays quiet for amber, and limits worst-first areas', () => {
  const groups = areas([0.5, 0, 0.25]).map((area, i) => ({ ...area, name: ['Meta', 'Stock', 'Store'][i]!, alarms: [0, 2, 1][i]!, title: `Invented gauge ${i}` }));
  assert.equal(dropsHtml([groups[0]!]), '<span class="drops-clear">✓ Nothing has dropped</span>');
  groups[0]!.measure.label = 'Stale';
  assert.match(dropsHtml([groups[0]!]), /data-drop-key="area-0">Meta/);
  assert.match(dropsHtml([groups[1]!]), /Stock.*Invented gauge 1/);
  assert.deepEqual(droppedAreas(groups).map(area => area.name), ['Stock', 'Store', 'Meta']);
  assert.match(dropsHtml(groups), /Stock.*Store.*\+1 more/);
  assert.doesNotMatch(dropsHtml(groups), />Meta</);
});
