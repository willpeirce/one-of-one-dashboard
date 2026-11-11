import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {defaultSettings,readSettings,saveSettings,validateSettings,SettingsValidationError} from '../src/settings.js';
import {breakEven,isSpikeDay,weekdayBudget} from '../src/meta-adsets/settings.js';
import {settingsPage} from '../src/settings-view.js';
import {createTestDatabase} from './helpers/database.js';
test('Ad rules save, audit and round trip; override applies through its date and then expires',async t=>{
 const db=await createTestDatabase();t.after(()=>db.close());
 const s=await readSettings(db);s.values.adRules.uk.overrideGbp=22;s.values.adRules.uk.overrideUntil='2026-10-18';
 s.values.adRules.us.upliftPercent=20;s.values.metaOwners=[{campaignId:'900000000801',owner:'ours',test:true}];
 const saved=await saveSettings(db,s,randomUUID());assert.deepEqual((await readSettings(db)).values,saved.values);
 assert.ok(saved.changedFields.includes('adRules.uk.overrideGbp'));
 assert.equal((await db.query('SELECT * FROM pulse.settings_changes')).rowCount,saved.changedFields.length);
 assert.deepEqual(breakEven(saved.values,'uk','2026-10-18'),{value:22,note:'override to 2026-10-18'});
 assert.deepEqual(breakEven(saved.values,'uk','2026-10-19'),{value:20,note:''});
 assert.match(settingsPage(saved,[],'sample',new Date('2026-10-19T12:00:00Z')),/Expired 2026-10-18/);
 assert.equal(weekdayBudget(2500,'us','2026-10-18',saved.values),25);
 assert.equal(weekdayBudget(2500,'us','2026-10-19',saved.values),30);
 assert.throws(()=>validateSettings({...saved.values,metaOwners:[{campaignId:'900000000801',owner:'freelancer',test:true}]}));
 assert.equal(defaultSettings().cppUsBreakEvenGbp,25);
});
test('one spike-date function handles UK 24–26, US 1/15, month ends and leap February',()=>{
 for(const market of ['uk','us'] as const) for(const month of ['2026-10','2026-02','2028-02','2026-04']) {
   const end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).getUTCDate();
   for(let d=1;d<=end;d++) assert.equal(isSpikeDay(market,`${month}-${String(d).padStart(2,'0')}`),d>=end-1 || (market==='uk'?d>=24&&d<=26:d===1||d===15));
 }
});

test('flat-test judgement spend defaults to sixty pounds and validates the same money limits as ad-rule floors', () => {
  const defaults = defaultSettings();
  assert.equal(defaults.adRules.flatJudgeGbp, 60);
  for (const value of [0.01, 60, 72.35, 100_000]) {
    const values = validateSettings({...defaults, adRules: {...defaults.adRules, flatJudgeGbp: value}});
    assert.equal(values.adRules.flatJudgeGbp, value);
  }
  for (const value of [0, -1, 100_000.01, 1.001, NaN, Infinity, '60', null, undefined, true]) {
    assert.throws(() => validateSettings({...defaults, adRules: {...defaults.adRules, flatJudgeGbp: value}}),
      (error: unknown) => error instanceof SettingsValidationError && error.fields.includes('adRules.flatJudgeGbp'));
  }
  const html = settingsPage({version: 0, values: defaults}, [], 'sample', new Date('2032-04-07T08:00:00Z'));
  assert.match(html, /<label for="setting-adRules-flatJudgeGbp">Flat test judgement spend \(£\)<\/label>/);
  assert.match(html, /name="adRules.flatJudgeGbp"[^>]*type="number" value="60" required min="0.01" step="0.01" max="100000"/);
  assert.ok(html.indexOf('name="adRules.killFloorGbp"') < html.indexOf('name="adRules.flatJudgeGbp"'));
  assert.ok(html.indexOf('name="adRules.flatJudgeGbp"') < html.indexOf('name="adRules.slippingFloorGbp"'));
});

test('older stored ad rules gain only the missing flat-test default without writes, then save and audit the nested field', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const initial = await readSettings(db);
  const oldRules: Record<string, unknown> = {...initial.values.adRules, killFloorGbp: 82, freelancerTriggerGbp: 36,
    uk: {...initial.values.adRules.uk, atcBarGbp: 17}};
  delete oldRules.flatJudgeGbp;
  const stored = {...initial.values, adRules: oldRules};
  await db.query('UPDATE pulse.settings SET values=$1', [JSON.stringify(stored)]);
  const loaded = await readSettings(db, {seed: false});
  assert.equal(loaded.version, initial.version);
  assert.deepEqual(loaded.values.adRules, {...oldRules, flatJudgeGbp: 60});
  assert.deepEqual((await db.query('SELECT values FROM pulse.settings')).rows[0]!.values, stored);
  assert.equal((await db.query('SELECT 1 FROM pulse.audit_log')).rowCount, 0);
  assert.equal((await db.query('SELECT 1 FROM pulse.settings_changes')).rowCount, 0);
  const saved = await saveSettings(db, {version: loaded.version,
    values: {...loaded.values, adRules: {...loaded.values.adRules, flatJudgeGbp: 68.25}}}, randomUUID());
  assert.equal(saved.version, initial.version + 1);
  assert.deepEqual(saved.changedFields, ['adRules.flatJudgeGbp']);
  assert.deepEqual((await readSettings(db)).values, saved.values);
  assert.deepEqual((await db.query('SELECT field FROM pulse.settings_changes')).rows, [{field: 'adRules.flatJudgeGbp'}]);
  assert.deepEqual((await db.query('SELECT event FROM pulse.audit_log')).rows, [{event: 'settings_changed'}]);
  await db.query("UPDATE pulse.settings SET values=jsonb_set(values,'{adRules,flatJudgeGbp}','null'::jsonb)");
  await assert.rejects(readSettings(db, {seed: false}),
    (error: unknown) => error instanceof SettingsValidationError && error.fields.includes('adRules.flatJudgeGbp'));
});
