import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { defaultSettings, readSettings, saveSettings, SettingsValidationError, validateSettings } from '../src/settings.js';
import { settingsPage } from '../src/settings-view.js';
import { seriesPaceDates } from '../src/series-pace/dates.js';
import { createTestDatabase } from './helpers/database.js';

const paceKeys = [
  'UKOrderDate', 'UKLandingOffsetDays', 'USLandingOffsetDays',
  'UKTargetDate', 'USTargetDate',
] as const;

test('Series 1 defaults use landing dates until a real target date is set or cleared', () => {
  const settings = validateSettings(defaultSettings()).series[0]!;
  assert.deepEqual(paceKeys.map(key => settings[key]), ['2026-11-04', 104, 74, '', '']);
  assert.deepEqual(seriesPaceDates(settings.UKOrderDate, settings.UKLandingOffsetDays), {
    landingDate: '2027-02-16', targetDate: '2027-02-16', targetKind: 'landing date',
  });
  assert.deepEqual(seriesPaceDates(settings.UKOrderDate, settings.USLandingOffsetDays, '2027-02-03'), {
    landingDate: '2027-01-17', targetDate: '2027-02-03', targetKind: 'your date',
  });
  assert.equal(seriesPaceDates(settings.UKOrderDate, settings.USLandingOffsetDays, '')!.targetDate, '2027-01-17');
  assert.equal(seriesPaceDates('2026-10-24', 2)!.landingDate, '2026-10-26');
  assert.equal(seriesPaceDates('2027-03-27', 2)!.landingDate, '2027-03-29');
});

const editedSeries = (values: ReturnType<typeof defaultSettings>, changes: Record<string, unknown>) => ({
  ...values, series: [{ ...values.series[0]!, ...changes }],
});

test('Series 1 validates real calendar dates and whole landing offsets from zero to 365', () => {
  for (const key of ['UKOrderDate', 'UKTargetDate', 'USTargetDate'] as const) {
    for (const invalid of ['2027-02-29', '2026-04-31', '2026-13-01', '2026-11-4', '04/11/2026', '2026-11-04T00:00:00Z', '0000-01-01', null]) {
      assert.throws(() => validateSettings(editedSeries(defaultSettings(), { [key]: invalid })), SettingsValidationError);
    }
    assert.equal(validateSettings(editedSeries(defaultSettings(), { [key]: '2028-02-29' })).series[0]![key], '2028-02-29');
  }
  assert.throws(() => validateSettings(editedSeries(defaultSettings(), { UKOrderDate: '' })), SettingsValidationError);
  for (const key of ['UKLandingOffsetDays', 'USLandingOffsetDays'] as const) {
    for (const invalid of [-1, 366, 1.5, NaN, Infinity, '74', null]) {
      assert.throws(() => validateSettings(editedSeries(defaultSettings(), { [key]: invalid })), SettingsValidationError);
    }
    for (const valid of [0, 365]) assert.equal(validateSettings(editedSeries(defaultSettings(), { [key]: valid })).series[0]![key], valid);
  }
  assert.throws(() => validateSettings(editedSeries(defaultSettings(), { UKOrderDate: '9999-12-31' })), SettingsValidationError);
  assert.equal(seriesPaceDates('2026-11-04', 1.5), null);
  assert.equal(seriesPaceDates('2026-11-04', 74, '2027-02-29'), null);
});

test('older stored Settings acquire pace defaults without a version change, write or audit', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  const { series: _series, ...base } = defaultSettings();
  const previous = { ...base, goalOrdersPerDay: 42, series1OrderDate: '2026-11-07',
    series1UkLandingOffsetDays: 94, series1UsLandingOffsetDays: 83, series1UkTargetDate: '', series1UsTargetDate: '2027-02-04' };
  await db.query('INSERT INTO pulse.settings (values, version) VALUES ($1, 7)', [JSON.stringify(previous)]);
  const current = await readSettings(db);
  assert.equal(current.version, 7);
  assert.equal(current.values.goalOrdersPerDay, 42);
  assert.deepEqual(paceKeys.map(key => current.values.series[0]![key]), ['2026-11-07', 94, 83, '', '2027-02-04']);
  assert.equal(current.values.series[0]!.USOrderDate, '2026-11-07');
  assert.deepEqual((await db.query<{ values: Record<string, unknown> }>('SELECT values FROM pulse.settings')).rows[0]!.values, previous);
  assert.equal((await db.query('SELECT * FROM pulse.settings_changes')).rowCount, 0);
  const saved = await saveSettings(db, { version: current.version, values: editedSeries(current.values, { UKTargetDate: '2027-03-01' }) }, randomUUID());
  assert.deepEqual(saved.changedFields, ['series.0.UKTargetDate']);
  assert.equal(saved.version, 8);
  assert.deepEqual((await readSettings(db)).values, saved.values);
});

test('each pace setting saves through the existing path with one audit row, and both target dates clear', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  const credentialId = randomUUID();
  let current = await readSettings(db);
  const edits = [
    ['UKOrderDate', '2026-12-02'], ['UKLandingOffsetDays', 91], ['USLandingOffsetDays', 62],
    ['UKTargetDate', '2027-03-11'], ['USTargetDate', '2027-02-09'],
    ['UKTargetDate', ''], ['USTargetDate', ''],
  ] as const;
  for (const [key, value] of edits) {
    const saved = await saveSettings(db, { version: current.version, values: editedSeries(current.values, { [key]: value }) }, credentialId);
    assert.deepEqual(saved.changedFields, [`series.0.${key}`]);
    assert.equal(saved.values.series[0]![key], value);
    assert.equal(saved.version, current.version + 1);
    current = await readSettings(db);
    assert.deepEqual(current.values, saved.values);
  }
  const audit = await db.query<{ field: string }>('SELECT field FROM pulse.settings_changes ORDER BY audit_id');
  assert.deepEqual(audit.rows.map(row => row.field), edits.map(([key]) => `series.0.${key}`));
});

test('Settings renders the pace group with bounded offsets, optional targets and each derived date beside its fields', () => {
  const html = settingsPage({ version: 0, values: validateSettings(editedSeries(defaultSettings(), { USTargetDate: '2027-02-03' })) });
  assert.match(html, /Series sell-out pace/);
  assert.match(html, /name="series.0.UKOrderDate"[^>]+type="date"[^>]+value="2026-11-04" required/);
  for (const market of ['UK', 'US']) {
    assert.match(html, new RegExp(`name="series.0.${market}LandingOffsetDays"[^>]+type="number"[^>]+min="0" step="1" max="365"`));
    const input = html.match(new RegExp(`<input[^>]+name="series.0.${market}TargetDate"[^>]*>`))![0];
    assert.match(input, /type="date"/);
    assert.ok(!input.includes(' required'));
  }
  assert.match(html, /data-series-pace-dates="UK"[^>]*>Landing date: 16 Feb 2027 · Target date: 16 Feb 2027 \(landing date\)/);
  assert.match(html, /data-series-pace-dates="US"[^>]*>Landing date: 17 Jan 2027 · Target date: 3 Feb 2027 \(your date\)/);
});

test('a target can be omitted and an unstocked series can be removed until its first daily observation', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const current = await readSettings(db);
  const first = current.values.series[0]!;
  const { UKTargetDate: _uk, USTargetDate: _us, ...dates } = first;
  const extra = { ...dates, key: 'invented-drop-3', sku: 'invented-drop-3', name: 'Invented Drop Three' };
  const saving = { ...current.values, series: [first, extra] };
  const credential = randomUUID();
  const saved = await saveSettings(db, { version: current.version, values: saving }, credential);
  assert.equal(saved.values.series[1]!.UKTargetDate, '');
  assert.equal(saved.values.series[1]!.USTargetDate, '');
  const removed = await saveSettings(db, { version: saved.version, values: current.values }, credential);
  assert.deepEqual(removed.values.series, [first]);
  const restored = await saveSettings(db, { version: removed.version, values: saving }, credential);
  const now = new Date('2032-03-02T00:05:00Z');
  await db.query(`INSERT INTO pulse.stock_daily(mode,day,location_id,inventory_item_id,product_id,sku,available,taken_at,fetched_at,source_id)
    VALUES('live','2032-03-02','invented-location','invented-inventory','invented-product',$1,31,$2,$2,'invented-daily-observation')`,
  [extra.sku, now]);
  await assert.rejects(saveSettings(db, { version: restored.version, values: current.values }, credential),
    error => error instanceof SettingsValidationError && error.fields.includes('series'));
  assert.deepEqual(await readSettings(db), { version: restored.version, values: restored.values });
});
