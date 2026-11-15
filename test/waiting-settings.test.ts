import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import test from 'node:test';
import {defaultSettings, readSettings, saveSettings, validateSettings, SettingsValidationError} from '../src/settings.js';
import {createTestDatabase} from './helpers/database.js';

test('waiting-on threshold defaults to seven UK days and accepts only integers from one through 365', () => {
  const defaults = defaultSettings();
  assert.equal(defaults.waitingOnDays, 7);
  for (const days of [1, 7, 30, 365]) assert.equal(validateSettings({...defaults, waitingOnDays: days}).waitingOnDays, days);
  for (const value of [undefined, null, '7', false, 0, -1, 1.5, 366, NaN, Infinity, -Infinity])
    assert.throws(() => validateSettings({...defaults, waitingOnDays: value}),
      (error: unknown) => error instanceof SettingsValidationError && error.fields[0] === 'waitingOnDays');
  assert.throws(() => validateSettings({...defaults, inventedExtra: true}), SettingsValidationError);
});

test('older stored Settings get the waiting threshold without changing values, version or audit', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const initial = await readSettings(db), {waitingOnDays: _threshold, ...older} = initial.values;
  await db.query('UPDATE pulse.settings SET values=$1', [JSON.stringify(older)]);
  const before = (await db.query('SELECT * FROM pulse.settings')).rows;
  assert.deepEqual(await readSettings(db), initial);
  assert.deepEqual((await db.query('SELECT * FROM pulse.settings')).rows, before);
  assert.equal((await db.query('SELECT 1 FROM pulse.audit_log')).rowCount, 0);
});

test('waiting threshold saves through its additive audit CHECK and migration replay preserves the value', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const initial = await readSettings(db), values = {...initial.values, waitingOnDays: 10};
  const saved = await saveSettings(db, {version: initial.version, values}, 'invented-waiting-device');
  assert.deepEqual(saved.changedFields, ['waitingOnDays']);
  assert.deepEqual((await db.query<{field: string}>('SELECT field FROM pulse.settings_changes ORDER BY field')).rows,
    [{field: 'waitingOnDays'}]);
  const directory = new URL('../migrations/', import.meta.url);
  const name = (await readdir(directory)).find(name => /^073_/.test(name))!;
  await db.query(await readFile(new URL(name, directory), 'utf8'));
  assert.deepEqual(await readSettings(db), {version: saved.version, values: saved.values});
  const definition = (await db.query<{definition: string}>(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE conrelid='pulse.settings_changes'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%goalOrdersPerDay%'`)).rows[0]!.definition;
  assert.equal((definition.match(/'waitingOnDays'/g) ?? []).length, 1);
});
