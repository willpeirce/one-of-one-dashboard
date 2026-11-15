import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {defaultSettings,readSettings,saveSettings,validateSettings,SettingsValidationError} from '../src/settings.js';
import {createTestDatabase} from './helpers/database.js';

test('alert quiet hours default to the UK night and require exact valid clock values', () => {
  const defaults=defaultSettings();
  assert.deepEqual(defaults.alertQuietHours,{start:'22:00',end:'07:00'});
  for(const quiet of [{start:'21:30',end:'06:45'},{start:'00:00',end:'00:00'}])
    assert.deepEqual(validateSettings({...defaults,alertQuietHours:quiet}).alertQuietHours,quiet);
  for(const quiet of [null,[],{}, {start:'22:00'},{start:'24:00',end:'07:00'},
    {start:'22:00',end:'07:60'},{start:' 22:00',end:'07:00'},{start:'22:00',end:'7:00'},
    {start:'22:00',end:'07:00',extra:true}])
    assert.throws(()=>validateSettings({...defaults,alertQuietHours:quiet}),SettingsValidationError);
});

test('older Settings acquire quiet hours without a write, and the audit allowlist migration replays safely', async t => {
  const db=await createTestDatabase(); t.after(()=>db.close());
  const initial=await readSettings(db),{alertQuietHours:_quiet,...older}=initial.values;
  await db.query('UPDATE pulse.settings SET values=$1',[JSON.stringify(older)]);
  assert.deepEqual((await readSettings(db)).values.alertQuietHours,{start:'22:00',end:'07:00'});
  assert.deepEqual((await db.query<{values:object}>('SELECT values FROM pulse.settings')).rows[0]!.values,older);
  assert.equal((await db.query('SELECT 1 FROM pulse.audit_log')).rowCount,0);
  await db.query(await readFile(new URL('../migrations/071_push_alerts.sql',import.meta.url),'utf8'));
  const values={...initial.values,alertQuietHours:{start:'21:30',end:'06:45'}};
  const saved=await saveSettings(db,{version:initial.version,values},'invented-alert-device');
  assert.deepEqual(saved.changedFields,['alertQuietHours.start','alertQuietHours.end']);
  assert.deepEqual((await db.query<{field:string}>('SELECT field FROM pulse.settings_changes ORDER BY field')).rows.map(row=>row.field),
    ['alertQuietHours.end','alertQuietHours.start']);
  const check=(await db.query<{definition:string}>(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE conrelid='pulse.settings_changes'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%goalOrdersPerDay%'`)).rows[0]!;
  assert.equal((check.definition.match(/'alertQuietHours'/g)??[]).length,1);
});
