import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { defaultSettings, readSettings, saveSettings, SettingsValidationError, validateSettings } from '../src/settings.js';
import { settingsPage } from '../src/settings-view.js';
import { seriesPaceDates } from '../src/series-pace/dates.js';
import { createTestDatabase } from './helpers/database.js';

const paceKeys = [
  'series1OrderDate', 'series1UkLandingOffsetDays', 'series1UsLandingOffsetDays',
  'series1UkTargetDate', 'series1UsTargetDate',
] as const;

test('Series 1 defaults use landing dates until a real target date is set or cleared', () => {
  const settings = validateSettings(defaultSettings());
  assert.deepEqual(paceKeys.map(key => settings[key]), ['2026-11-04', 104, 74, '', '']);
  assert.deepEqual(seriesPaceDates(settings.series1OrderDate, settings.series1UkLandingOffsetDays), {
    landingDate: '2027-02-16', targetDate: '2027-02-16', targetKind: 'landing date',
  });
  assert.deepEqual(seriesPaceDates(settings.series1OrderDate, settings.series1UsLandingOffsetDays, '2027-02-03'), {
    landingDate: '2027-01-17', targetDate: '2027-02-03', targetKind: 'your date',
  });
  assert.equal(seriesPaceDates(settings.series1OrderDate, settings.series1UsLandingOffsetDays, '')!.targetDate, '2027-01-17');
  assert.equal(seriesPaceDates('2026-10-24', 2)!.landingDate, '2026-10-26');
  assert.equal(seriesPaceDates('2027-03-27', 2)!.landingDate, '2027-03-29');
});

test('Series 1 validates real calendar dates and whole landing offsets from zero to 365', () => {
  for (const key of ['series1OrderDate', 'series1UkTargetDate', 'series1UsTargetDate'] as const) {
    for (const invalid of ['2027-02-29', '2026-04-31', '2026-13-01', '2026-11-4', '04/11/2026', '2026-11-04T00:00:00Z', '0000-01-01', null]) {
      assert.throws(() => validateSettings({ ...defaultSettings(), [key]: invalid }), SettingsValidationError);
    }
    assert.equal(validateSettings({ ...defaultSettings(), [key]: '2028-02-29' })[key], '2028-02-29');
  }
  assert.throws(() => validateSettings({ ...defaultSettings(), series1OrderDate: '' }), SettingsValidationError);
  for (const key of ['series1UkLandingOffsetDays', 'series1UsLandingOffsetDays'] as const) {
    for (const invalid of [-1, 366, 1.5, NaN, Infinity, '74', null]) {
      assert.throws(() => validateSettings({ ...defaultSettings(), [key]: invalid }), SettingsValidationError);
    }
    for (const valid of [0, 365]) assert.equal(validateSettings({ ...defaultSettings(), [key]: valid })[key], valid);
  }
  assert.throws(() => validateSettings({ ...defaultSettings(), series1OrderDate: '9999-12-31' }), SettingsValidationError);
  assert.equal(seriesPaceDates('2026-11-04', 1.5), null);
  assert.equal(seriesPaceDates('2026-11-04', 74, '2027-02-29'), null);
});

test('older stored Settings acquire pace defaults without a version change, write or audit', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  const previous: Record<string, unknown> = { ...defaultSettings(), goalOrdersPerDay: 42 };
  for (const key of paceKeys) delete previous[key];
  await db.query('INSERT INTO pulse.settings (values, version) VALUES ($1, 7)', [JSON.stringify(previous)]);
  const current = await readSettings(db);
  assert.equal(current.version, 7);
  assert.equal(current.values.goalOrdersPerDay, 42);
  for (const key of paceKeys) assert.equal(current.values[key], defaultSettings()[key]);
  assert.deepEqual((await db.query<{ values: Record<string, unknown> }>('SELECT values FROM pulse.settings')).rows[0]!.values, previous);
  assert.equal((await db.query('SELECT * FROM pulse.settings_changes')).rowCount, 0);
  const saved = await saveSettings(db, { version: current.version, values: { ...current.values, series1UkTargetDate: '2027-03-01' } }, randomUUID());
  assert.deepEqual(saved.changedFields, ['series1UkTargetDate']);
  assert.equal(saved.version, 8);
  assert.deepEqual((await readSettings(db)).values, saved.values);
});

test('each pace setting saves through the existing path with one audit row, and both target dates clear', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  const credentialId = randomUUID();
  let current = await readSettings(db);
  const edits = [
    ['series1OrderDate', '2026-12-02'], ['series1UkLandingOffsetDays', 91], ['series1UsLandingOffsetDays', 62],
    ['series1UkTargetDate', '2027-03-11'], ['series1UsTargetDate', '2027-02-09'],
    ['series1UkTargetDate', ''], ['series1UsTargetDate', ''],
  ] as const;
  for (const [key, value] of edits) {
    const saved = await saveSettings(db, { version: current.version, values: { ...current.values, [key]: value } }, credentialId);
    assert.deepEqual(saved.changedFields, [key]);
    assert.equal(saved.values[key], value);
    assert.equal(saved.version, current.version + 1);
    current = await readSettings(db);
    assert.deepEqual(current.values, saved.values);
  }
  const audit = await db.query<{ field: string }>('SELECT field FROM pulse.settings_changes ORDER BY audit_id');
  assert.deepEqual(audit.rows.map(row => row.field), edits.map(([key]) => key));
});

test('Settings renders the pace group with bounded offsets, optional targets and each derived date beside its fields', () => {
  const html = settingsPage({ version: 0, values: { ...defaultSettings(), series1UsTargetDate: '2027-02-03' } });
  assert.match(html, /Series 1 sell-out pace/);
  assert.match(html, /name="series1OrderDate"[^>]+type="date"[^>]+value="2026-11-04" required/);
  for (const market of ['Uk', 'Us']) {
    assert.match(html, new RegExp(`name="series1${market}LandingOffsetDays"[^>]+type="number"[^>]+min="0" step="1" max="365"`));
    const input = html.match(new RegExp(`<input[^>]+name="series1${market}TargetDate"[^>]*>`))![0];
    assert.match(input, /type="date"/);
    assert.ok(!input.includes(' required'));
  }
  assert.match(html, /data-series-pace-dates="Uk"[^>]*>Landing date: 16 Feb 2027 · Target date: 16 Feb 2027 \(landing date\)/);
  assert.match(html, /data-series-pace-dates="Us"[^>]*>Landing date: 17 Jan 2027 · Target date: 3 Feb 2027 \(your date\)/);
});
