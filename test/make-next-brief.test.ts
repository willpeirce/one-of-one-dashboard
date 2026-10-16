import assert from 'node:assert/strict';
import test from 'node:test';
import { attributeSchema } from '../src/creatives/attributes.js';
import { creativeLiftLabel, liftPhrasing } from '../src/creatives/lift-phrasing.js';
import { emptyBrief, liftComparison, makeCreativeBrief } from '../src/creatives/lift-presentation.js';
import { briefBulletsHtml, fullEvidenceHtml } from '../src/creatives/lift-view.js';
import { strengthMeter } from '../src/creatives/strength-meter.js';
import { sampleCreativeData, sampleCreativeStoredLifts } from '../src/creatives/sample.js';
import { defaultSettings } from '../src/settings.js';
import type { CreativeLift } from '../src/creatives/lifts.js';
import { metricSign } from '../src/metric-sign.js';
import { getSampleDashboard } from '../src/sample-dashboard.js';
import { dashboardPage } from '../src/dashboard-view.js';

// Invented examples only, including every count, price, group and comparison.
const now = new Date('2026-10-16T12:00:00Z'), today = '2026-10-16';
const data = sampleCreativeData(defaultSettings(), now);
const base = sampleCreativeStoredLifts(now).find(lift => lift.kind === 'video' && lift.windowDays === 7 && lift.market === 'all')!;
const finding = (key: string, value: string, ids = ['invented-a', 'invented-b', 'invented-c']): CreativeLift => ({ ...structuredClone(base), id: `invented-${key}-${value}`, attributeKey: key, value, metrics: { ...structuredClone(base.metrics), withGroupIds: ids } });
const brief = (lifts: CreativeLift[]) => makeCreativeBrief('video', lifts, data, 7, 'all', today);

test('every schema value has an instruction, yes/no names its winning value, unknown values fall back sensibly', () => {
  for (const attributes of Object.values(attributeSchema)) for (const attribute of attributes) for (const option of attribute.values) {
    assert.ok(liftPhrasing[attribute.key]?.[option.value], `${attribute.key}:${option.value}`);
    assert.equal(creativeLiftLabel(attribute, option.value), liftPhrasing[attribute.key]![option.value]);
  }
  assert.match(brief([finding('copyOffer', 'no')]).line, /^Leave the deal out of the text\./);
  assert.match(brief([finding('copyOffer', 'yes')]).line, /^Put the deal in the text\./);
  assert.match(brief([finding('boxShown', 'no')]).line, /^No box on screen\./);
  assert.equal(creativeLiftLabel({ key: 'invented-new', label: 'New attribute', sources: [], values: [{ value: 'x', label: 'new value' }] }, 'x'), 'New attribute: new value');
});

test('one metric comparison uses CPP, then carts within 10%, then video hook within both 10% boundaries', () => {
  const lift = finding('slabEarly', 'yes');
  lift.metrics.with.costPerPurchase = 20; lift.metrics.without.costPerPurchase = 32;
  assert.equal(liftComparison(lift), '£20 a purchase against £32.');
  lift.metrics.with.costPerPurchase = 28.8;
  lift.metrics.with.addToCartRate = .24; lift.metrics.without.addToCartRate = .14;
  assert.equal(liftComparison(lift), 'Add-to-cart 24% against 14%.');
  lift.metrics.with.costPerPurchase = 28.79;
  assert.match(liftComparison(lift), /a purchase/);
  lift.metrics.with.costPerPurchase = 30;
  lift.metrics.with.addToCartRate = .209; lift.metrics.without.addToCartRate = .2;
  lift.metrics.with.hookRate = .4; lift.metrics.without.hookRate = .3;
  assert.equal(liftComparison(lift), 'Hook 40% against 30%.');
  assert.equal(liftComparison({ ...lift, kind: 'image' }), 'Add-to-cart 21% against 20%.');
  lift.metrics.with.addToCartRate = null;
  assert.match(liftComparison(lift), /a purchase/, 'missing is not evidence of two similar cart rates');
});

test('identical and near-subset group sets merge values once, cap at three, and do not merge unrelated or transitive sets', () => {
  const markers = finding('copyMarkers', 'yes'), stencils = finding('copyStencils', 'yes');
  const result = brief([markers, stencils]);
  assert.equal(result.bullets.length, 1);
  assert.match(result.line, /^Say markers and stencils\./);
  stencils.metrics.withGroupIds.push('invented-d');
  assert.equal(brief([markers, stencils]).bullets.length, 1);
  stencils.metrics.withGroupIds.push('invented-e');
  assert.equal(brief([markers, stencils]).bullets.length, 2);
  const different = ['boxShown', 'productEarly', 'slabEarly', 'captions'].map((key, i) => finding(key, 'yes', [`invented-${i}`]));
  assert.equal(brief(different).bullets.length, 3);
  const a = finding('boxShown', 'yes', ['a']), b = finding('productEarly', 'yes', ['a', 'b']), c = finding('slabEarly', 'yes', ['b']);
  assert.equal(brief([a, b, c]).bullets.length, 2);
});

test('footer uses selected window and market totals, thin evidence, and every window has its own empty state', () => {
  const lift = finding('slabEarly', 'yes'); lift.metrics.with.groupCount = 5; lift.metrics.without.groupCount = 4;
  assert.match(brief([lift]).footer, /Thin evidence, read loosely\./);
  lift.metrics.without.groupCount = 5;
  assert.doesNotMatch(brief([lift]).footer, /Thin/);
  const uk = makeCreativeBrief('video', [], data, 1, 'uk', today), us = makeCreativeBrief('video', [], data, 7, 'us', today);
  assert.notEqual(uk.footer, us.footer);
  for (const days of [1, 3, 7] as const) {
    const result = makeCreativeBrief('video', [{ ...lift, windowDays: days, confidence: 'Hint' }], data, days, 'all', today);
    assert.deepEqual(result.bullets, []); assert.equal(result.empty, emptyBrief(days));
  }
  assert.deepEqual([1, 3, 7].map(days => emptyBrief(days as 1 | 3 | 7)), ['Too early for 1 day, see 3 days.', 'Too early for 3 days, see 7 days.', 'Not enough yet. Scans and spend fill this in.']);
});

test('meters light 1/2/3 bars with the stored accessible strength; copy contains exactly the visible text plus bracketed strength', () => {
  for (const [i, confidence] of (['Hint', 'Likely', 'Strong'] as const).entries()) {
    const html = strengthMeter(confidence);
    assert.equal((html.match(/class="lit"/g) ?? []).length, i + 1);
    assert.match(html, new RegExp(`aria-label="Strength: ${confidence.toLowerCase()}"`));
    assert.match(html, new RegExp(`title="Strength: ${confidence.toLowerCase()}"`));
    assert.doesNotMatch(html, /red|alarm/);
  }
  const result = brief([finding('copyOffer', 'no')]);
  const visible = [...briefBulletsHtml(result).matchAll(/data-brief-text>([^<]+)</g)].map(match => match[1]!);
  assert.deepEqual(visible, result.bullets.map(bullet => bullet.text));
  assert.equal(result.brief, [...visible.map((text, i) => `${text} [${result.bullets[i]!.confidence}]`), `Copy: ${result.examples.map(example => example.title).join(' · ')}`, result.footer].join('\n'));
  const evidence = fullEvidenceHtml([base], 'video', 7, 'sample');
  for (const text of ['With', 'Without', 'groups', 'spend', 'resamples held', 'UK days', 'Hook', 'Hold', 'Strength: strong']) assert.ok(evidence.includes(text));
});

test('each profit tile background follows its own sign in SSR, including zero and Unknown', () => {
  const snapshot = getSampleDashboard();
  for (const key of ['margin', 'profit', 'contribution'] as const) for (const [n, unavailable, expected] of [[15, false, 'positive'], [-3, false, 'negative'], [0, false, 'none'], [10, true, 'none']] as const) {
    const metric = { ...snapshot.hero.today[key], n, unavailable };
    assert.equal(metricSign(metric), expected);
    snapshot.hero.today[key] = metric;
    const html = dashboardPage(snapshot), tag = new RegExp(`<button[^>]*data-k="${key}"[^>]*>`).exec(html)![0];
    assert.ok(tag.includes(`data-sign="${expected}"`));
  }
});
