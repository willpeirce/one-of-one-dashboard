import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { addDays } from '../src/hero-range.js';
import { defaultSettings, readSettings, saveSettings, SettingsValidationError, validateSettings } from '../src/settings.js';
import type { InboundStock } from '../src/shopify/stock-gap.js';
import { stockPlannerPage } from '../src/stock/planner-view.js';
import { orderState, plannerDefaults, planStock, forecastStock, type PlannerProduct } from '../src/stock/planner.js';
import { createTestDatabase } from './helpers/database.js';

const today = '2031-01-28';
const arrival = (date: string, quantity: number, product = 'Invented Pack'): InboundStock => ({
  expectedDate: date, quantity, product, market: 'uk',
});
const product = (name: string, kit: boolean, available: number, usage: number, days = 28): PlannerProduct => ({
  name, kit, available, market: 'uk',
  daily: new Map(Array.from({ length: days ? days + 1 : 0 }, (_, index) => [addDays(today, -index), available + usage * index])),
});
const config = {
  ...plannerDefaults(),
  supplierLeadTimes: [{ supplier: 'Invented Works', days: 5 }],
  productSuppliers: [{ product: 'Invented Pack', supplier: 'Invented Works' }],
  inboundStock: [],
};

test('run-out uses stock arriving before exhaustion and applies each month’s multiplier', () => {
  const factors = config.seasonalMultipliers;
  assert.deepEqual(forecastStock(today, 40, 4, factors, []), { runOut: '2031-02-07', gaps: [] });
  assert.deepEqual(forecastStock(today, 40, 4, factors, [arrival('2031-02-01', 12)]), { runOut: '2031-02-10', gaps: [] });
  assert.deepEqual(forecastStock(today, 40, 4, factors, [arrival('2031-02-07', 12)]), { runOut: '2031-02-10', gaps: [] });
  assert.deepEqual(forecastStock(today, 40, 4, factors, [arrival('2031-02-08', 12)]), {
    runOut: '2031-02-11', gaps: [{ from: '2031-02-07', to: '2031-02-08', days: 1 }],
  });
  const seasonal = [...factors]; seasonal[1] = 2;
  assert.deepEqual(forecastStock(today, 40, 4, seasonal, []), { runOut: '2031-02-04', gaps: [] });
  assert.deepEqual(forecastStock(today, 40, 4, seasonal, [arrival('2031-02-01', 16)]), { runOut: '2031-02-06', gaps: [] });
  assert.deepEqual(forecastStock(today, 40, 0, seasonal, []), { runOut: null, gaps: [] });
});

test('supplier time and safety weeks move the order-by date, while kits only have a run-out', () => {
  const accessory = product('Invented Pack', false, 120, 4);
  const kit = product('Invented Kit', true, 80, 8);
  const [pack, base] = planStock([accessory, kit], today, config);
  assert.equal(pack!.runOut, '2031-02-27');
  assert.equal(pack!.orderBy, '2031-02-01');
  assert.equal(pack!.rate, 4);
  assert.equal(base!.runOut, '2031-02-07');
  assert.equal(base!.orderBy, null);
  assert.equal(base!.setSupplier, false);
  assert.equal(base!.state, null);
  const [withLanding] = planStock([accessory], today, { ...config, inboundStock: [arrival('2031-02-01', 40)] });
  assert.equal(withLanding!.runOut, '2031-03-09');
  assert.equal(withLanding!.orderBy, '2031-02-11');
  for (const lead of [[], [{ supplier: 'Invented Works', days: null }]]) {
    const [without] = planStock([accessory], today, { ...config, supplierLeadTimes: lead });
    assert.equal(without!.setSupplier, true);
    assert.equal(without!.orderBy, null);
    assert.equal(without!.state, null);
  }
});

test('short histories use observed pairs and missing history stays unavailable', () => {
  const pack = product('Invented Pack', false, 72, 3, 7);
  const [short, missing, zero] = planStock([pack, { ...pack, daily: new Map() }, product('Invented Zero', false, 9, 0, 5)], today, config);
  assert.deepEqual([short!.rate, short!.observedDays], [3, 7]);
  assert.deepEqual([missing!.rate, missing!.observedDays, missing!.runOut, missing!.state], [null, 0, null, null]);
  assert.deepEqual([zero!.rate, zero!.observedDays, zero!.runOut], [0, 5, null]);
  const wrongWarehouse = { ...arrival('2031-01-29', 12), market: 'us' as const };
  assert.deepEqual(planStock([pack], today, { ...config, inboundStock: [wrongWarehouse] })[0]!.inbound, []);
});

test('attach-rate cover uses matching days and each warehouse’s own stock and inbound', () => {
  const pack = product('Invented Pack', false, 20, 2, 7);
  const kit = product('Invented Kit', true, 100, 10);
  const [uk, , us] = planStock([pack, kit, { ...pack, market: 'us' }], today, {
    ...config, inboundStock: [arrival('2031-02-04', 50, kit.name), arrival('2031-02-06', 5)],
  });
  assert.deepEqual(uk!.coverage, { kits: 150, covered: 125, shortfall: 5 });
  assert.equal(us!.coverage, null);
  const [enough] = planStock([{ ...pack, available: 70 }, kit], today, config);
  assert.deepEqual(enough!.coverage, { kits: 100, covered: 100, shortfall: 0 });
});

test('order states are inclusive at today and day fourteen', () => {
  assert.deepEqual([0, 1, 14, 15].map(days => orderState(today, addDays(today, days))), ['alarm', 'warn', 'warn', 'good']);
  assert.equal(orderState(today, addDays(today, -1)), 'alarm');
  assert.equal(orderState(today, null), null);
});

test('older Settings gain planner defaults without writes and planner changes audit atomically', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const { seasonalMultipliers: _months, reorderSafetyWeeks: _weeks, productSuppliers: _suppliers, ...older } = defaultSettings();
  await db.query('INSERT INTO pulse.settings (values, version) VALUES ($1, 7)', [JSON.stringify(older)]);
  const savedBefore = (await db.query('SELECT * FROM pulse.settings')).rows;
  const current = await readSettings(db);
  assert.equal(current.version, 7);
  assert.deepEqual(current.values.seasonalMultipliers, config.seasonalMultipliers);
  assert.equal(current.values.reorderSafetyWeeks, 3);
  assert.deepEqual(current.values.productSuppliers, []);
  assert.deepEqual((await db.query('SELECT * FROM pulse.settings')).rows, savedBefore);
  assert.equal((await db.query('SELECT 1 FROM pulse.audit_log')).rowCount, 0);
  assert.equal((await db.query('SELECT 1 FROM pulse.stock_planner_settings')).rowCount, 0);
  assert.throws(() => validateSettings({ ...current.values, seasonalMultipliers: Array(12).fill(5.01) }), SettingsValidationError);
  assert.throws(() => validateSettings({ ...current.values, seasonalMultipliers: Array(12).fill(0.19) }), SettingsValidationError);
  assert.throws(() => validateSettings({ ...current.values, seasonalMultipliers: Array(11).fill(1) }), SettingsValidationError);
  assert.throws(() => validateSettings({ ...current.values, productSuppliers: config.productSuppliers }), SettingsValidationError);
  const seasonalMultipliers = [0.2, 5, ...Array<number>(10).fill(1)];
  const wanted = { ...current.values, ...config, seasonalMultipliers, reorderSafetyWeeks: 2 };
  const saved = await saveSettings(db, { version: 7, values: wanted }, randomUUID());
  assert.equal(saved.version, 8);
  assert.deepEqual(saved.values, wanted);
  assert.deepEqual(await readSettings(db), { version: 8, values: wanted });
  assert.ok(saved.changedFields.includes('seasonalMultipliers.0'));
  assert.ok(saved.changedFields.includes('reorderSafetyWeeks'));
  assert.ok(saved.changedFields.includes('productSuppliers'));
  const migration = await readFile(new URL('../migrations/079_stock_planner_settings.sql', import.meta.url), 'utf8');
  await db.query(migration); await db.query(migration);
  assert.deepEqual(await readSettings(db), { version: 8, values: wanted });
  assert.equal((await db.query("SELECT 1 FROM information_schema.table_privileges WHERE table_schema='pulse' AND table_name='stock_planner_settings' AND grantee='PUBLIC'")).rowCount, 0);
});

test('a gap across a month end and a second gap resume at the new rate, with order-by from final run-out', () => {
  const multipliers = [...config.seasonalMultipliers];
  multipliers[1] = 2;
  const inboundStock = [arrival('2031-02-06', 160), arrival('2031-02-02', 16)];
  const rows = planStock([product('Invented Pack', false, 8, 4)], today, {
    ...config, seasonalMultipliers: multipliers, reorderSafetyWeeks: 1, inboundStock,
  });
  const row = rows[0]!;
  assert.deepEqual(row.gaps, [
    { from: '2031-01-30', to: '2031-02-02', days: 3 },
    { from: '2031-02-04', to: '2031-02-06', days: 2 },
  ]);
  assert.deepEqual([row.runOut, row.orderBy, row.state], ['2031-02-26', '2031-02-14', 'good']);
  const html = stockPlannerPage({ today, mode: 'sample', asOf: null, rows });
  assert.equal((html.match(/<span data-stock-state="alarm">None from /g) ?? []).length, 2);
  assert.match(html.replace(/<[^>]+>/g, ''), /None from 30 Jan to 2 Feb · 3 days/);
  assert.match(html, /data-stock-state="good">Good/);
});

test('an empty shelf starts at zero and groups same-day receipts without carrying lost demand', () => {
  const factors = config.seasonalMultipliers;
  assert.deepEqual(forecastStock(today, -6, 4, factors, [arrival(today, 4), arrival(today, 8)]),
    { runOut: '2031-01-31', gaps: [] });
  assert.deepEqual(forecastStock(today, 0, 4, factors, [arrival('2031-02-03', 8)]), {
    runOut: '2031-02-05', gaps: [{ from: today, to: '2031-02-03', days: 6 }],
  });
});

test('accessory cover counts arrivals through the last launched kit run-out in its own warehouse', () => {
  const pack = product('Invented Pack', false, 6, 3);
  const first = product('Invented Dawn', true, 20, 10);
  const second = product('Invented Dusk', true, 30, 5);
  const future = { ...second, name: 'Invented Noon', launch: '2031-03-01' };
  const other = { ...second, market: 'us' as const, available: 240 };
  const inboundStock = [arrival('2031-02-06', 25, second.name),
    arrival('2031-02-08', 3), arrival('2031-02-11', 3), arrival('2031-02-12', 12)];
  const rows = planStock([pack, first, second, future, other], today, { ...config, inboundStock });
  assert.deepEqual([rows[2]!.runOut, rows[2]!.orderBy], ['2031-02-11', null]);
  assert.deepEqual(rows[2]!.gaps, [{ from: '2031-02-03', to: '2031-02-06', days: 3 }]);
  assert.deepEqual(rows[0]!.coverage, { kits: 75, covered: 60, shortfall: 3 });
});

test('order-by uses each warehouse override and otherwise falls back to the supplier days', () => {
  const pack = product('Invented Pack', false, 120, 4);
  const products = [pack, { ...pack, market: 'us' as const }];
  for (const [overrides, expected] of [
    [{}, ['2031-02-22', '2031-02-22']],
    [{ ukDays: 9 }, ['2031-02-18', '2031-02-22']],
    [{ usDays: 0 }, ['2031-02-22', '2031-02-27']],
  ] as const) {
    const rows = planStock(products, today, { ...config, reorderSafetyWeeks: 0,
      supplierLeadTimes: [{ ...config.supplierLeadTimes[0]!, ...overrides }] });
    assert.deepEqual(rows.map(row => row.orderBy), expected);
  }
});
