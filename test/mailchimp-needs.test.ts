import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { decisionsHtml } from '../src/decisions/view.js';
import { MAILCHIMP_FRESH_MS, type MailchimpFacts } from '../src/mailchimp/model.js';
import { mailchimpBillingNeeds, nextMailchimpBillingDate } from '../src/mailchimp/needs.js';
import { settingsPage } from '../src/settings-view.js';
import { defaultSettings, readSettings, saveSettings, SettingsValidationError, validateSettings } from '../src/settings.js';
import { createTestDatabase } from './helpers/database.js';

const settings={mailchimpPlanLimit:150,mailchimpBillingDay:30};
const now=new Date('2026-11-23T12:00:00Z');
function facts(at=now):MailchimpFacts{return{mode:'live',status:'live',fetchedAt:at.toISOString(),
  audience:{id:'invented-audience',contacts:173,subscribers:119,unsubscribed:31,cleaned:23},flowCoverage:'unknown',campaigns:[],reports:[],orders:[]};}

test('Mailchimp billing Settings start empty and accept only positive whole plan limits and calendar billing days',()=>{
  const initial=defaultSettings();assert.equal(initial.mailchimpPlanLimit,null);assert.equal(initial.mailchimpBillingDay,null);
  for(const [limit,day] of [[1,1],[173,31],[Number.MAX_SAFE_INTEGER,28],[null,30],[173,null],[null,null]] as const){
    const parsed=validateSettings({...initial,mailchimpPlanLimit:limit,mailchimpBillingDay:day});
    assert.equal(parsed.mailchimpPlanLimit,limit);assert.equal(parsed.mailchimpBillingDay,day);
  }
  for(const limit of [0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'173','']){
    assert.throws(()=>validateSettings({...initial,mailchimpPlanLimit:limit}),error=>error instanceof SettingsValidationError&&error.fields.includes('mailchimpPlanLimit'));
  }
  for(const day of [0,-1,32,1.5,NaN,Infinity,'23','']){
    assert.throws(()=>validateSettings({...initial,mailchimpBillingDay:day}),error=>error instanceof SettingsValidationError&&error.fields.includes('mailchimpBillingDay'));
  }
});

test('older Settings fill empty Mailchimp defaults without a write; ordinary saves persist and audit both keys',async t=>{
  const db=await createTestDatabase();t.after(()=>db.close());const initial=await readSettings(db);
  const {mailchimpPlanLimit:_limit,mailchimpBillingDay:_day,...stored}=initial.values;
  await db.query('UPDATE pulse.settings SET values=$1',[JSON.stringify(stored)]);
  const before=(await db.query('SELECT * FROM pulse.settings')).rows;
  const filled=await readSettings(db);assert.equal(filled.version,initial.version);
  assert.equal(filled.values.mailchimpPlanLimit,null);assert.equal(filled.values.mailchimpBillingDay,null);
  assert.deepEqual((await db.query('SELECT * FROM pulse.settings')).rows,before);
  assert.equal((await db.query('SELECT * FROM pulse.settings_changes')).rowCount,0);
  const saved=await saveSettings(db,{...filled,values:{...filled.values,...settings}},randomUUID());
  assert.deepEqual(saved.changedFields.sort(),['mailchimpBillingDay','mailchimpPlanLimit']);
  assert.deepEqual((await db.query('SELECT field FROM pulse.settings_changes ORDER BY field')).rows,[{field:'mailchimpBillingDay'},{field:'mailchimpPlanLimit'}]);
  assert.equal((await readSettings(db)).values.mailchimpPlanLimit,150);
  const cleared=await saveSettings(db,{version:saved.version,values:{...saved.values,mailchimpPlanLimit:null,mailchimpBillingDay:null}},randomUUID());
  assert.deepEqual(cleared.changedFields.sort(),['mailchimpBillingDay','mailchimpPlanLimit']);
});

test('Settings uses existing nullable controls and explains the short-month billing rule',()=>{
  const html=settingsPage({version:0,values:defaultSettings()});
  assert.match(html,/name="mailchimpPlanLimit"[^>]*type="number" value="" data-nullable="true"[^>]*min="1" step="1"/);
  assert.match(html,/name="mailchimpBillingDay"[^>]*type="number" value="" data-nullable="true"[^>]*min="1" step="1" max="31"/);
  assert.match(html,/Days 29–31 use the last day in shorter months/);
  assert.match(html,/Leave either blank to keep the audience warning off/);
});

test('billing warnings occur only on the seven UK calendar dates before billing, never on the date itself',()=>{
  for(const [day,expected] of [[22,0],[23,1],[29,1],[30,0]] as const){
    const at=new Date(`2026-11-${day}T12:00:00Z`),needs=mailchimpBillingNeeds(facts(at),settings,at);
    assert.equal(needs.length,expected);
    if(expected){assert.equal(needs[0]!.source,'mailchimp');assert.equal(needs[0]!.state,'warn');assert.equal(needs[0]!.link,'/settings');
      assert.deepEqual(needs[0]!.figure,{value:'~23',label:'contacts over plan'});assert.match(needs[0]!.why,/Mailchimp's approximate total is 173 contacts against a plan limit of 150/);}
  }
});

test('next billing dates clamp month ends and roll through leap years and December',()=>{
  for(const [today,day,expected] of [
    ['2026-02-21',31,'2026-02-28'],['2026-02-28',31,'2026-03-31'],['2028-02-22',31,'2028-02-29'],
    ['2028-02-29',29,'2028-03-29'],['2026-04-23',31,'2026-04-30'],['2026-12-28',4,'2027-01-04'],
  ] as const)assert.equal(nextMailchimpBillingDate(today,day),expected);
  for(const [today,day] of [['2026-02-21',31],['2028-02-22',31],['2026-12-28',4]] as const){
    const at=new Date(`${today}T12:00:00Z`);assert.equal(mailchimpBillingNeeds(facts(at),{...settings,mailchimpBillingDay:day},at).length,1);
  }
});

test('billing windows follow UK dates across the October clock change and summer midnight',()=>{
  for(const at of ['2026-10-24T23:30:00Z','2026-10-25T00:30:00Z','2026-10-25T01:30:00Z','2026-06-23T23:30:00Z']){
    const instant=new Date(at),needs=mailchimpBillingNeeds(facts(instant),{...settings,mailchimpBillingDay:1},instant);
    assert.equal(needs.length,1);assert.match(needs[0]!.why,/in 7 UK calendar days/);
  }
  const before=new Date('2026-10-24T22:59:59Z');
  assert.deepEqual(mailchimpBillingNeeds(facts(before),{...settings,mailchimpBillingDay:1},before),[]);
});

test('missing Settings, unhealthy sources, stale reads and non-authoritative audience counts never warn',()=>{
  for(const partial of [{mailchimpPlanLimit:null},{mailchimpBillingDay:null},{mailchimpPlanLimit:null,mailchimpBillingDay:null}])
    assert.deepEqual(mailchimpBillingNeeds(facts(),{...settings,...partial},now),[]);
  for(const partial of [{mode:'sample' as const},{status:'sample' as const},{status:'pending' as const},{status:'unavailable' as const},
    {fetchedAt:null},{fetchedAt:'invented-invalid-time'},{fetchedAt:new Date(now.getTime()+1).toISOString()},
    {fetchedAt:new Date(now.getTime()-MAILCHIMP_FRESH_MS-1).toISOString()},{audience:null}])
    assert.deepEqual(mailchimpBillingNeeds({...facts(),...partial},settings,now),[]);
  assert.equal(mailchimpBillingNeeds({...facts(),fetchedAt:new Date(now.getTime()-MAILCHIMP_FRESH_MS).toISOString()},settings,now).length,1);
  for(const contacts of [null,0,149,150,NaN,Infinity,173.5,-1]){
    const input=facts();input.audience={...input.audience!,contacts,subscribers:999,unsubscribed:999,cleaned:999};
    assert.deepEqual(mailchimpBillingNeeds(input,settings,now),[],'Subscriber and status counts cannot substitute for authoritative contacts');
  }
});

test('one live Mailchimp billing need reaches the existing Watch renderer even when Shopify is sample',()=>{
  const needs=mailchimpBillingNeeds(facts(),settings,now);
  const html=decisionsHtml({shopify:{mode:'sample',stock:[],checks:[],needs,detail:{},live:{lastOrder:'Invented',dispatch:'Invented',carts:'Invented'}}});
  assert.equal((html.match(/class="wrow"/g)??[]).length,1);
  assert.match(html,/<details class="wrow" data-state="warn" data-source="mailchimp"/);
  assert.match(html,/Mailchimp · Email audience over plan/);assert.match(html,/href="\/settings">Open settings/);
  assert.doesNotMatch(html,/data-source="mailchimp"[^>]*data-state="alarm"|data-act=|data-confirm=/);
});
