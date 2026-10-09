import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  defaultSettings, readSettings, saveSettings, validateSettings, SettingsConflictError,
  SettingsValidationError, SETTINGS_KEY_NAMES, type Settings,
} from '../src/settings.js';
import { createTestDatabase } from './helpers/database.js';

test('settings initialize once with specified defaults, unknowns unset and no default-change audit', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  const first = await readSettings(db);
  assert.equal(first.version, 0);
  assert.deepEqual(first.values, validateSettings(defaultSettings()));
  assert.equal(first.values.goalOrdersPerDay, 100);
  assert.equal(first.values.goalNetMarginPercent, 20);
  assert.equal(first.values.cppUkBreakEvenGbp, 18.56);
  assert.equal(first.values.cppUsBreakEvenGbp, 22.70);
  assert.equal(first.values.blendedMetaTripwireGbp, 28);
  assert.equal(first.values.safetyWeeks, 3);
  assert.deepEqual(first.values.overheads, []);
  assert.equal(first.values.paymentFeePercent, null);
  assert.equal(first.values.markersPerKit, null);
  assert.equal(first.values.pencilsPerKit, null);
  assert.equal(first.values.seasonalMultiplier, null);
  assert.equal(first.values.morningSummaryEnabled, false);
  assert.equal(first.values.brand, 'one-of-one');
  assert.deepEqual((await readSettings(db)).values, first.values);
  assert.equal((await db.query('SELECT * FROM pulse.settings')).rowCount, 1);
  assert.equal((await db.query('SELECT * FROM pulse.audit_log')).rowCount, 0);
  assert.deepEqual((await db.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")).rows, []);
});

test('changed settings persist across service instances and audit every field without its value', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  const initial = await readSettings(db);
  const values: Settings = structuredClone(initial.values);
  values.goalOrdersPerDay = 150;
  values.overheads = [{ name: 'Sample workspace', monthlyGbp: 250, startMonth: '', endMonth: '' }];
  values.cppUkTargetGbp = 16;
  values.creatorRules.assetCapGbp = 250;
  values.startingCogs[0]!.unitCostGbp = 7.50;
  values.keyExpiryDates = [{ keyName: 'GITHUB_HQ_TOKEN', expiresOn: '2027-01-01' }];
  values.waitingContacts = [{ business: 'Sample Factory', role: 'Account manager' }];
  const credentialId = randomUUID();
  const result = await saveSettings(db, { version: initial.version, values }, credentialId);
  assert.equal(result.version, 1);
  assert.deepEqual(result.values, values);
  assert.deepEqual(result.changedFields.sort(), [
    'goalOrdersPerDay', 'overheads', 'cppUkTargetGbp', 'creatorRules.assetCapGbp',
    'startingCogs.0.unitCostGbp', 'keyExpiryDates.0.keyName', 'keyExpiryDates.0.expiresOn',
    'waitingContacts.0.business', 'waitingContacts.0.role',
  ].sort());

  const restartedServiceDatabase = { ...db };
  assert.deepEqual(await readSettings(restartedServiceDatabase), { version: 1, values });
  const audit = (await db.query(`
    SELECT a.event, a.credential_id, c.field FROM pulse.audit_log a
    JOIN pulse.settings_changes c ON c.audit_id = a.id ORDER BY a.id
  `)).rows;
  assert.equal(audit.length, 9);
  assert.ok(audit.every((row) => row.event === 'settings_changed' && row.credential_id === credentialId));
  assert.deepEqual(audit.map((row) => row.field).sort(), result.changedFields);
  assert.ok(!JSON.stringify(audit).includes('Sample Factory'));
  assert.ok(!JSON.stringify(audit).includes('GITHUB_HQ_TOKEN'));
  assert.deepEqual((await db.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'pulse' AND table_name = 'settings_changes' ORDER BY ordinal_position
  `)).rows, [{ column_name: 'audit_id' }, { column_name: 'field' }]);
});

test('the database audit CHECK covers every Settings key plus named retired keys and preserves field path limits', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  const checks = await db.query<{ definition: string }>(`
    SELECT pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.conrelid = 'pulse.settings_changes'::regclass
      AND c.contype = 'c' AND a.attname = 'field'
  `);
  assert.equal(checks.rows.length, 1);
  const allowedKeys = [...checks.rows[0]!.definition.matchAll(/'([a-zA-Z][a-zA-Z0-9]*)'/g)]
    .map((match) => match[1]!);
  const settingsKeys = Object.keys(defaultSettings()).sort();
  const retiredSettingsKeys = ['monthlyOverheadsGbp'];
  assert.deepEqual(allowedKeys.sort(), [...settingsKeys, ...retiredSettingsKeys].sort());

  const insert = (field: string) => db.query(`
    WITH entry AS (
      INSERT INTO pulse.audit_log (event) VALUES ('settings_changed') RETURNING id
    )
    INSERT INTO pulse.settings_changes (audit_id, field) SELECT id, $1 FROM entry
  `, [field]);
  for (const key of [...settingsKeys, ...retiredSettingsKeys]) assert.equal((await insert(key)).rowCount, 1);
  assert.equal((await insert('overheads.0.monthlyGbp')).rowCount, 1);
  assert.equal((await insert('startingCogs.0.unitCostGbp')).rowCount, 1);
  assert.equal((await insert(`brand.${'a'.repeat(154)}`)).rowCount, 1);
  const auditCount = (await db.query('SELECT * FROM pulse.audit_log')).rowCount;
  for (const field of [
    '', 'unknownSetting', 'brand.', '.brand', '1brand', 'brand..child', 'brand.bad_path',
    `brand.${'a'.repeat(155)}`,
  ]) {
    await assert.rejects(insert(field), (error: unknown) => {
      assert.equal((error as { code?: string }).code, '23514');
      return true;
    });
  }
  assert.equal((await db.query('SELECT * FROM pulse.audit_log')).rowCount, auditCount);
});

test('fulfilment exchange rate and every ad account ID save with one value-free audit row each', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  const credentialId = randomUUID();
  // These sample account identifiers and exchange rate are invented.
  const edits = [
    { field: 'jjGbpPerUsd', value: 0.812345, stored: 0.812345 },
    { field: 'metaAdAccountId', value: '9000000001', stored: '9000000001' },
    { field: 'googleCustomerId', value: '900-000-0002', stored: '9000000002' },
    { field: 'googleLoginCustomerId', value: '9000000003', stored: '9000000003' },
    { field: 'tiktokAdvertiserId', value: '9000000004', stored: '9000000004' },
  ] as const;
  let snapshot = await readSettings(db);
  for (const { field, value, stored } of edits) {
    const result = await saveSettings(db, {
      version: snapshot.version, values: { ...snapshot.values, [field]: value },
    }, credentialId);
    assert.equal(result.version, snapshot.version + 1);
    assert.deepEqual(result.changedFields, [field]);
    assert.equal(result.values[field], stored);
    snapshot = await readSettings(db);
    assert.deepEqual(snapshot, { version: result.version, values: result.values });
    const audit = await db.query<{ event: string; credential_id: string; field: string }>(`
      SELECT a.event, a.credential_id, c.field FROM pulse.audit_log a
      JOIN pulse.settings_changes c ON c.audit_id = a.id WHERE c.field = $1
    `, [field]);
    assert.deepEqual(audit.rows, [{ event: 'settings_changed', credential_id: credentialId, field }]);
  }
  const audit = await db.query(`
    SELECT a.*, c.field FROM pulse.audit_log a
    JOIN pulse.settings_changes c ON c.audit_id = a.id ORDER BY a.id
  `);
  assert.equal(audit.rowCount, edits.length);
  const serializedAudit = JSON.stringify(audit.rows);
  for (const { value, stored } of edits) {
    assert.ok(!serializedAudit.includes(String(value)));
    assert.ok(!serializedAudit.includes(String(stored)));
  }
});

test('unchanged saves do not bump version or write audit; stale editors cannot overwrite a newer save', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  const initial = await readSettings(db);
  const credentialId = randomUUID();
  assert.deepEqual(await saveSettings(db, initial, credentialId), { ...initial, changedFields: [] });
  assert.equal((await db.query('SELECT * FROM pulse.audit_log')).rowCount, 0);
  const first = { version: 0, values: { ...initial.values, blendedMetaTripwireGbp: 31 } };
  const second = { version: 0, values: { ...initial.values, blendedMetaTripwireGbp: 32 } };
  const results = await Promise.allSettled([saveSettings(db, first, credentialId), saveSettings(db, second, credentialId)]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = results.find((result) => result.status === 'rejected');
  assert.ok(rejected?.status === 'rejected' && rejected.reason instanceof SettingsConflictError);
  assert.equal((await readSettings(db)).version, 1);
  assert.equal((await db.query('SELECT * FROM pulse.audit_log')).rowCount, 1);
  const persisted = await readSettings(db);
  await saveSettings(db, persisted, credentialId);
  assert.equal((await db.query('SELECT * FROM pulse.audit_log')).rowCount, 1);
});

test('overheads validate trimmed unique names, calendar months, penny amounts and the list limit', () => {
  const defaults = defaultSettings();
  const overhead = { name: '  Sample subscriptions  ', monthlyGbp: 123.45 };
  assert.deepEqual(validateSettings({ ...defaults, overheads: [overhead] }).overheads, [
    { name: 'Sample subscriptions', monthlyGbp: 123.45, startMonth: '', endMonth: '' },
  ]);
  assert.deepEqual(validateSettings({ ...defaults, overheads: [
    { name: 'Sample zero cost', monthlyGbp: 0, startMonth: '2026-02', endMonth: '2026-02' },
    { name: 'Sample maximum', monthlyGbp: 1_000_000, startMonth: '2026-03', endMonth: '' },
  ] }).overheads.map((row) => row.monthlyGbp), [0, 1_000_000]);
  const valid = { name: 'Sample subscription', monthlyGbp: 10, startMonth: '', endMonth: '' };
  const invalidLists: unknown[] = [
    null, {}, [{ ...valid, name: '' }], [{ ...valid, name: '   ' }], [{ ...valid, name: 'a'.repeat(61) }],
    [{ ...valid, name: null }], [{ ...valid, monthlyGbp: -1 }], [{ ...valid, monthlyGbp: 1_000_000.01 }],
    [{ ...valid, monthlyGbp: 0.001 }], [{ ...valid, monthlyGbp: '10' }], [{ ...valid, monthlyGbp: Infinity }],
    [{ ...valid, startMonth: '2026-00' }], [{ ...valid, startMonth: '2026-13' }],
    [{ ...valid, startMonth: '2026-2' }], [{ ...valid, endMonth: '2026-02-01' }],
    [{ ...valid, startMonth: '2026-03', endMonth: '2026-02' }], [{ ...valid, startMonth: null }],
    [valid, { ...valid, name: '  SAMPLE SUBSCRIPTION  ' }],
    Array.from({ length: 51 }, (_, index) => ({ ...valid, name: `Sample item ${index}` })),
    [{ ...valid, unknown: true }], [{ name: valid.name }],
  ];
  for (const overheads of invalidLists) {
    assert.throws(() => validateSettings({ ...defaults, overheads }), SettingsValidationError);
  }
  const { overheads: _overheads, ...legacy } = defaults;
  assert.throws(() => validateSettings({ ...legacy, monthlyOverheadsGbp: 10 }), SettingsValidationError);
});

test('legacy overhead values read before migration and normalize before save audit comparison', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  const { overheads: _overheads, ...legacy } = defaultSettings();
  // All amounts and item names in these cases are invented.
  for (const monthlyOverheadsGbp of [123.45, null, 0]) {
    await db.query(`
      INSERT INTO pulse.settings (values, version) VALUES ($1, 4)
      ON CONFLICT (singleton) DO UPDATE SET values = EXCLUDED.values, version = EXCLUDED.version
    `, [JSON.stringify({ ...legacy, monthlyOverheadsGbp })]);
    const expected = typeof monthlyOverheadsGbp === 'number' && monthlyOverheadsGbp > 0
      ? [{ name: 'Overheads', monthlyGbp: monthlyOverheadsGbp, startMonth: '', endMonth: '' }] : [];
    const read = await readSettings(db);
    assert.deepEqual(read.values.overheads, expected);
    assert.ok(!Object.hasOwn(read.values, 'monthlyOverheadsGbp'));
    assert.equal(read.version, 4);
    const saved = await saveSettings(db, { ...read, values: { ...read.values, goalOrdersPerDay: 101 } }, randomUUID());
    assert.deepEqual(saved.changedFields, ['goalOrdersPerDay']);
    assert.equal(saved.version, 5);
    assert.deepEqual((await readSettings(db)).values.overheads, expected);
    const stored = (await db.query<{ values: Record<string, unknown> }>('SELECT values FROM pulse.settings')).rows[0]!.values;
    assert.ok(!Object.hasOwn(stored, 'monthlyOverheadsGbp'));
  }
  assert.deepEqual((await db.query('SELECT field FROM pulse.settings_changes')).rows, [
    { field: 'goalOrdersPerDay' }, { field: 'goalOrdersPerDay' }, { field: 'goalOrdersPerDay' },
  ]);
});

test('the old valid overhead limit survives reads before and after migration while new saves stay strict', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  const { overheads: _overheads, ...legacy } = defaultSettings();
  // This deliberately large amount is invented to exercise the retired scalar's limit.
  await db.query('INSERT INTO pulse.settings (values, version) VALUES ($1, 4)', [
    JSON.stringify({ ...legacy, monthlyOverheadsGbp: 2_000_000.01 }),
  ]);
  const before = await readSettings(db);
  assert.deepEqual(before.values.overheads, [
    { name: 'Overheads', monthlyGbp: 2_000_000.01, startMonth: '', endMonth: '' },
  ]);
  assert.throws(() => validateSettings(before.values), SettingsValidationError);
  await assert.rejects(saveSettings(db, { version: before.version, values: before.values }, randomUUID()), SettingsValidationError);
  assert.deepEqual(await readSettings(db), before);

  await db.query(await readFile(new URL('../migrations/011_monthly_overheads.sql', import.meta.url), 'utf8'));
  const migrated = (await db.query<{ values: Record<string, unknown> }>('SELECT values FROM pulse.settings')).rows[0]!.values;
  assert.ok(!Object.hasOwn(migrated, 'monthlyOverheadsGbp'));
  assert.deepEqual(migrated.overheads, before.values.overheads);
  assert.deepEqual(await readSettings(db), before);
  await assert.rejects(saveSettings(db, {
    version: before.version, values: { ...before.values, goalOrdersPerDay: 101 },
  }, randomUUID()), SettingsValidationError);

  const corrected = { ...before.values, overheads: [{ ...before.values.overheads[0]!, monthlyGbp: 1_000_000 }] };
  const saved = await saveSettings(db, { version: before.version, values: corrected }, randomUUID());
  assert.deepEqual(saved.changedFields, ['overheads.0.monthlyGbp']);
  assert.equal(saved.version, 5);
  assert.deepEqual((await readSettings(db)).values, corrected);
  assert.equal((await db.query('SELECT * FROM pulse.settings_changes')).rowCount, 1);

  // The stored compatibility exception is limited to the migration's exact row shape.
  for (const row of [
    { ...before.values.overheads[0]!, name: 'Sample renamed item' },
    { ...before.values.overheads[0]!, startMonth: '2026-01' },
    { ...before.values.overheads[0]!, endMonth: '2026-12' },
  ]) {
    await db.query('UPDATE pulse.settings SET values = $1', [JSON.stringify({ ...corrected, overheads: [row] })]);
    await assert.rejects(readSettings(db), SettingsValidationError);
  }
});

test('overhead row additions and removals audit the list, while edits audit field paths without values', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  const credentialId = randomUUID();
  let snapshot = await readSettings(db);
  const first = { name: 'Sample subscription', monthlyGbp: 31, startMonth: '', endMonth: '' };
  let saved = await saveSettings(db, { version: snapshot.version, values: { ...snapshot.values, overheads: [first] } }, credentialId);
  assert.deepEqual(saved.changedFields, ['overheads']);
  snapshot = saved;
  saved = await saveSettings(db, { version: snapshot.version, values: { ...snapshot.values, overheads: [
    { ...first, monthlyGbp: 62, startMonth: '2026-09', endMonth: '2026-12' },
  ] } }, credentialId);
  assert.deepEqual(saved.changedFields, ['overheads.0.monthlyGbp', 'overheads.0.startMonth', 'overheads.0.endMonth']);
  snapshot = saved;
  saved = await saveSettings(db, { version: snapshot.version, values: { ...snapshot.values, overheads: [
    ...snapshot.values.overheads, { ...first, name: 'Sample workspace' },
  ] } }, credentialId);
  assert.deepEqual(saved.changedFields, ['overheads']);
  snapshot = saved;
  saved = await saveSettings(db, { version: snapshot.version, values: { ...snapshot.values, overheads: [] } }, credentialId);
  assert.deepEqual(saved.changedFields, ['overheads']);
  const rows = (await db.query('SELECT field FROM pulse.settings_changes ORDER BY audit_id')).rows;
  assert.deepEqual(rows, [
    { field: 'overheads' }, { field: 'overheads.0.monthlyGbp' }, { field: 'overheads.0.startMonth' },
    { field: 'overheads.0.endMonth' }, { field: 'overheads' }, { field: 'overheads' },
  ]);
  assert.ok(!JSON.stringify(rows).includes('Sample subscription'));
  assert.deepEqual((await readSettings(db)).values.overheads, []);
});

test('a failed audit insertion rolls back the settings, version and all audit rows', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  const initial = await readSettings(db);
  await db.query(`
    CREATE FUNCTION pulse.reject_second_setting() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.field = 'overheads' THEN RAISE EXCEPTION 'Audit insert rejected'; END IF;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER reject_second_setting BEFORE INSERT ON pulse.settings_changes
      FOR EACH ROW EXECUTE FUNCTION pulse.reject_second_setting();
  `);
  await assert.rejects(saveSettings(db, {
    version: initial.version,
    values: { ...initial.values, goalOrdersPerDay: 120, overheads: [{ name: 'Sample workspace', monthlyGbp: 100, startMonth: '', endMonth: '' }] },
  }, randomUUID()));
  assert.deepEqual(await readSettings(db), initial);
  assert.equal((await db.query('SELECT * FROM pulse.audit_log')).rowCount, 0);
  assert.equal((await db.query('SELECT * FROM pulse.settings_changes')).rowCount, 0);
});

test('settings reject unknown fields, secret inputs, invalid types, duplicates and inconsistent values', async () => {
  const defaults = defaultSettings();
  const cases: unknown[] = [
    null, [], {}, { ...defaults, unknown: true }, { ...defaults, goalOrdersPerDay: '100' },
    { ...defaults, goalOrdersPerDay: 1.5 }, { ...defaults, overheads: [{ name: 'Sample workspace', monthlyGbp: -1 }] },
    { ...defaults, paymentFeePercent: 101 }, { ...defaults, seasonalMultiplier: 0 },
    { ...defaults, markersPerKit: 2.5 }, { ...defaults, dispatchCutoffUk: '24:00' },
    { ...defaults, cppUkTargetGbp: defaults.cppUkBreakEvenGbp + 1 },
    { ...defaults, cppUsTargetGbp: defaults.cppUsBreakEvenGbp + 1 },
    { ...defaults, goalNetMarginPercent: Number.NaN },
    { ...defaults, blendedMetaTripwireGbp: Infinity },
    { ...defaults, overheads: [{ name: 'Sample workspace', monthlyGbp: 0.001 }] },
    { ...defaults, brand: 'kinda-rare' }, { ...defaults, morningSummaryEnabled: 'true' },
    { ...defaults, creatorRules: { ...defaults.creatorRules, rawNotes: 'not permitted' } },
    { ...defaults, creatorRules: { ...defaults.creatorRules, briefPaymentPercent: 60 } },
    { ...defaults, startingCogs: [{ sku: 'REFILL', unitCostGbp: 1 }, { sku: 'refill', unitCostGbp: 2 }] },
    { ...defaults, expectedGoogleCampaigns: [{ name: 'Sample campaign', market: 'unknown' }] },
    { ...defaults, metaOwners: [{ campaignId: 'not-an-id', owner: 'ours' }] },
    { ...defaults, metaOwners: [{ campaignId: '123', owner: 'unknown' }] },
    { ...defaults, deadlines: [{ label: 'Sample deadline', date: '2026-02-30' }] },
    { ...defaults, keyExpiryDates: [{ keyName: 'unknown', expiresOn: '2027-01-01' }] },
    { ...defaults, keyExpiryDates: [{ keyName: SETTINGS_KEY_NAMES[0], expiresOn: '2027-01-01', value: randomBytes(32).toString('hex') }] },
    { ...defaults, waitingContacts: [{ business: 'Sample Factory', role: 'sample@example.invalid' }] },
    { ...defaults, waitingContacts: [{ business: 'Sample Factory', role: '+44 7700 900000' }] },
    { ...defaults, waitingContacts: [{ business: 'Sample Factory', role: 'Supplier', email: 'sample@example.invalid' }] },
    { ...defaults, deadlines: [{ label: randomBytes(32).toString('hex'), date: '2027-01-01' }] },
    { ...defaults, DASHBOARD_SETUP_CODE: randomBytes(32).toString('hex') },
    JSON.parse(JSON.stringify(defaults).replace('"goalOrdersPerDay":100', '"__proto__":{},"goalOrdersPerDay":100')),
  ];
  for (const input of cases) assert.throws(() => validateSettings(input), SettingsValidationError);
});

test('validation failure stores nothing and never reflects untrusted values or field names', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  const marker = randomBytes(32).toString('hex');
  const initial = await readSettings(db);
  const invalidInput = { version: 0, values: { ...initial.values, [marker]: marker } };
  await assert.rejects(saveSettings(db, invalidInput, randomUUID()), (error: unknown) => {
    assert.ok(error instanceof SettingsValidationError);
    assert.ok(!error.message.includes(marker));
    assert.ok(!error.fields.includes(marker));
    return true;
  });
  assert.deepEqual(await readSettings(db), initial);
  assert.equal((await db.query('SELECT * FROM pulse.audit_log')).rowCount, 0);
});
