import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {defaultSettings,readSettings,saveSettings,validateSettings} from '../src/settings.js';
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
