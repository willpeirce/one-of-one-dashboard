import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { afterTaxMetric, corporationTax, defaultCorporationTaxPercent } from '../src/after-tax.js';
import type { HeroMetric } from '../src/dashboard-types.js';
import { defaultSettings, readSettings, saveSettings, validateSettings } from '../src/settings.js';
import { settingsPage } from '../src/settings-view.js';
import { getSampleDashboard } from '../src/sample-dashboard.js';
import { dashboardPage } from '../src/dashboard-view.js';
import { createTestDatabase } from './helpers/database.js';

const profit = (n: number, extra: Partial<HeroMetric> = {}): HeroMetric => ({
  n, state: 'est', ss: 'Estimate · invented label', pre: '£', dp: 2, source: ['shopify', 'meta'], mode: 'live',
  d: { why: 'Invented profit', rule: 'Invented rule', src: 'Invented source', hist: [400, -100, 0] }, ...extra,
});

test('After tax takes the Settings rate off a profit and nothing off a loss', () => {
  const kept = afterTaxMetric(profit(1000), 25);
  assert.equal(kept.n, 750);
  assert.equal(kept.ss, 'Less 25% corporation tax');
  assert.deepEqual(kept.d.hist, [300, -100, 0]);
  assert.deepEqual(kept.d.extra, [['Net profit', '£1,000.00'], ['Corporation tax at 25%', '−£250.00'], ['After tax', '£750.00']]);
  assert.match(kept.d.why, /not the bank balance/);
  assert.match(kept.d.rule, /UK VAT is already out of Net profit/);
  assert.match(kept.d.rule, /without VAT/);
  assert.deepEqual([kept.pre, kept.dp, kept.state, kept.mode, kept.source], ['£', 2, 'est', 'live', ['shopify', 'meta']]);
  assert.equal(afterTaxMetric(profit(1000), 19).n, 810);
  assert.equal(afterTaxMetric(profit(1000), 19).ss, 'Less 19% corporation tax');
  const loss = afterTaxMetric(profit(-200), 25);
  assert.equal(loss.n, -200);
  assert.equal(loss.ss, 'No tax on a loss');
  assert.equal(loss.d.extra![1]![1], 'None on a loss');
  assert.equal(corporationTax(0, 25), 0);
  assert.equal(defaultCorporationTaxPercent, 25);
});

test('After tax carries Net profit gaps and unavailability', () => {
  const warned = afterTaxMetric(profit(100, { state: 'warn', ss: 'Meta spend missing\nEstimate' }), 25);
  assert.equal(warned.state, 'warn');
  assert.equal(warned.ss, 'Less 25% corporation tax\nSame gaps as Net profit');
  const unknown = afterTaxMetric(profit(0, { unavailable: true, ss: 'History unavailable for this range', statusLabel: 'store-wide' }), 25);
  assert.equal(unknown.unavailable, true);
  assert.equal(unknown.ss, 'History unavailable for this range');
  assert.equal(unknown.statusLabel, 'store-wide');
  assert.deepEqual(unknown.d.extra!.map(([, value]) => value), ['Unknown', 'Unknown', 'Unknown']);
});

test('the corporation tax rate is a validated Setting with its own audit row after migration 070', async (t) => {
  assert.equal(defaultSettings().corporationTaxPercent, 25);
  assert.throws(() => validateSettings({ ...defaultSettings(), corporationTaxPercent: 101 }));
  assert.throws(() => validateSettings({ ...defaultSettings(), corporationTaxPercent: null }));
  const db = await createTestDatabase(); t.after(() => db.close());
  const initial = await readSettings(db);
  const { corporationTaxPercent: _rate, ...older } = initial.values;
  await db.query('UPDATE pulse.settings SET values=$1', [JSON.stringify(older)]);
  const filled = await readSettings(db);
  assert.equal(filled.values.corporationTaxPercent, 25);
  const migration = await readFile(new URL('../migrations/070_corporation_tax_setting.sql', import.meta.url), 'utf8');
  await db.query(migration); await db.query(migration);
  const definition = (await db.query<{ definition: string }>(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE conrelid='pulse.settings_changes'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%goalOrdersPerDay%'`)).rows[0]!.definition;
  assert.equal((definition.match(/'corporationTaxPercent'/g) ?? []).length, 1);
  const saved = await saveSettings(db, { version: filled.version, values: { ...filled.values, corporationTaxPercent: 19 } }, randomUUID());
  assert.deepEqual(saved.changedFields, ['corporationTaxPercent']);
  assert.equal((await readSettings(db)).values.corporationTaxPercent, 19);
  assert.match(settingsPage({ ...filled, values: { ...filled.values, corporationTaxPercent: 19 } }), /Corporation tax rate \(%\)/);
});

test('Home shows After tax as the last line of the profit pair, from the sample hero', () => {
  const snapshot = getSampleDashboard();
  for (const period of Object.values(snapshot.hero)) {
    assert.equal(period.afterTax.n, period.profit.n - corporationTax(period.profit.n, 25));
    for (const view of Object.values(period.markets ?? {})) assert.equal(view.afterTax.n, view.profit.n - corporationTax(view.profit.n, 25));
  }
  const html = dashboardPage(snapshot);
  const pair = /<div class="profit-pair">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? '';
  assert.deepEqual([...pair.matchAll(/data-k="([^"]+)"/g)].map(match => match[1]), ['contribution', 'profit', 'afterTax']);
  assert.match(pair, /class="profit-line after-tax" data-k="afterTax"[^>]*data-sign="/);
  assert.match(pair, /<span class="sl">After tax<\/span>/);
});
