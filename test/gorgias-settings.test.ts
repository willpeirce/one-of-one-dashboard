import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import test from 'node:test';
import {defaultSettings, readSettings, saveSettings, validateSettings, SettingsValidationError, type Settings} from '../src/settings.js';
import {createTestDatabase} from './helpers/database.js';

const keys = ['gorgiasHandoverViewId', 'gorgiasHandoverTag', 'gorgiasHandoverWaitHours'] as const;

test('Gorgias Settings default to tag handover and bound view IDs, tag text and finite waiting hours', () => {
  const defaults = defaultSettings();
  assert.equal(defaults.gorgiasHandoverViewId, '');
  assert.equal(defaults.gorgiasHandoverTag, 'ai_handover');
  assert.equal(defaults.gorgiasHandoverWaitHours, 12);
  for (const [input, expected] of [['', ''], ['  ', ''], [' 42 ', '42'], ['9'.repeat(25), '9'.repeat(25)]])
    assert.equal(validateSettings({...defaults, gorgiasHandoverViewId: input}).gorgiasHandoverViewId, expected);
  for (const value of [undefined, null, 42, '0', ' 0 ', '01', '0042', '-1', '1.5', '1e3', '9'.repeat(26), 'invented-view', '4\n2'])
    assert.throws(() => validateSettings({...defaults, gorgiasHandoverViewId: value}),
      (error: unknown) => error instanceof SettingsValidationError && error.fields[0] === 'gorgiasHandoverViewId');
  for (const [input, expected] of [[' invented_handover ', 'invented_handover'], ['Support: handover', 'Support: handover'], ['x'.repeat(80), 'x'.repeat(80)]])
    assert.equal(validateSettings({...defaults, gorgiasHandoverTag: input}).gorgiasHandoverTag, expected);
  for (const value of [undefined, null, false, 42, '', '   ', 'x'.repeat(81), 'invented\nflag', 'invented\u0000flag', 'invented\u007fflag'])
    assert.throws(() => validateSettings({...defaults, gorgiasHandoverTag: value}),
      (error: unknown) => error instanceof SettingsValidationError && error.fields[0] === 'gorgiasHandoverTag');
  for (const hours of [1, 1.125, 12, 720])
    assert.equal(validateSettings({...defaults, gorgiasHandoverWaitHours: hours}).gorgiasHandoverWaitHours, hours);
  for (const value of [undefined, null, '12', false, 0, -1, .99, 720.01, NaN, Infinity, -Infinity])
    assert.throws(() => validateSettings({...defaults, gorgiasHandoverWaitHours: value}),
      (error: unknown) => error instanceof SettingsValidationError && error.fields[0] === 'gorgiasHandoverWaitHours');
  assert.throws(() => validateSettings({...defaults, inventedExtra: true}), SettingsValidationError);
});

test('old stored Settings acquire Gorgias defaults without changing storage, version or audit', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const initial = await readSettings(db), older: Partial<Settings> = {...initial.values};
  for (const key of keys) delete older[key];
  await db.query('UPDATE pulse.settings SET values=$1', [JSON.stringify(older)]);
  const before = (await db.query('SELECT * FROM pulse.settings')).rows;
  const loaded = await readSettings(db);
  assert.equal(loaded.version, initial.version);
  for (const key of keys) assert.equal(loaded.values[key], initial.values[key]);
  assert.deepEqual((await db.query('SELECT * FROM pulse.settings')).rows, before);
  assert.equal((await db.query('SELECT 1 FROM pulse.audit_log')).rowCount, 0);
});

test('Gorgias Settings save through the additive audit allowlist and its replay keeps prior values', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const initial = await readSettings(db);
  const values = {...initial.values, gorgiasHandoverViewId: '41027', gorgiasHandoverTag: 'invented_handover', gorgiasHandoverWaitHours: 18};
  const saved = await saveSettings(db, {version: initial.version, values}, 'invented-handover-device');
  assert.deepEqual(saved.changedFields.slice().sort(), keys.slice().sort());
  assert.deepEqual((await db.query<{field: string}>('SELECT field FROM pulse.settings_changes ORDER BY field')).rows.map(row => row.field), keys.slice().sort());
  const directory = new URL('../migrations/', import.meta.url);
  const name = (await readdir(directory)).find(name => /^072_/.test(name))!;
  await db.query(await readFile(new URL(name, directory), 'utf8'));
  assert.deepEqual(await readSettings(db), {version: saved.version, values: saved.values});
  const definition = (await db.query<{definition: string}>(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE conrelid='pulse.settings_changes'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%goalOrdersPerDay%'`)).rows[0]!.definition;
  for (const key of keys) assert.equal((definition.match(new RegExp(`'${key}'`, 'g')) ?? []).length, 1);
});
