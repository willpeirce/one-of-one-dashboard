import assert from 'node:assert/strict';
import test from 'node:test';
import {randomBytes} from 'node:crypto';
import {parseActivity,readActivity,syncActivity,ACTIVITY_FIELDS} from '../src/meta-adsets/activity.js';
import {MetaSpend} from '../src/ad-spend/clients.js';
import {AdError} from '../src/ad-spend/model.js';
import {defaultSettings} from '../src/settings.js';
import {createTestDatabase} from './helpers/database.js';
import {activityStat} from '../src/meta-adsets/view.js';
import {sampleAdSetsView} from '../src/meta-adsets/presentation.js';
// Every identity, name and figure is invented.
const now=new Date('2026-10-26T15:00:00Z'),account='invented-activity-account';
const raw={event_type:'update_ad_set_budget',event_time:'2026-10-25T12:00:00Z',actor_id:'990001',actor_name:'Invented operator',application_name:'Invented app',object_id:'invented-object',object_name:'Invented object',object_type:'AD_SET',extra_data:JSON.stringify({old_value:{type:'payment_amount',currency:'GBP',old_value:2000},new_value:{type:'payment_amount',currency:'GBP',new_value:2600,additional_value:'Per day'},type:'composite_data'})};
test('activity parses nested pence and status, ignores every other type and follows GET paging',async()=>{
 const budget=parseActivity(raw)!;assert.equal(budget.oldPence,2000);assert.equal(budget.newPence,2600);assert.equal(budget.budgetLabel,'Per day');assert.equal(budget.value,'GBP 26.00 · Per day');
 const status=parseActivity({...raw,event_type:'update_campaign_run_status',extra_data:JSON.stringify({old_value:'ACTIVE',new_value:'PAUSED'})})!;
 assert.equal(status.old,'ACTIVE');assert.equal(status.value,'PAUSED');
 for(const type of ['billing_event','update_campaign_high_demand_periods','update_campaign_budget_scheduling_state','update_campaign_group_high_demand_periods','update_campaign_group_budget_scheduling_state','invented_other'])assert.equal(parseActivity({...raw,event_type:type}),null);
 let calls=0;const reader=new MetaSpend(randomBytes(16).toString('hex'),{sleep:async()=>{},fetch:async(input,init)=>{
  assert.equal(init?.method,'GET');const url=new URL(String(input));assert.equal(url.searchParams.get('fields'),ACTIVITY_FIELDS);assert.equal(url.searchParams.get('since'),'1234');
  if(++calls===1)return Response.json({data:[raw],paging:{cursors:{after:'invented-next'},next:'https://graph.facebook.com/ignored'}});
  assert.equal(url.searchParams.get('after'),'invented-next');return Response.json({data:[{...raw,event_type:'billing_event'}]});
 }});assert.equal((await reader.readActivities(account,1234)).length,1);assert.equal(calls,2);
});
test('activity saves once, resumes inclusively, empty actors count all and read refusals have their own line',async t=>{
 const db=await createTestDatabase();t.after(()=>db.close());t.mock.method(console,'error',()=>{});
 const event=parseActivity(raw)!,settings=defaultSettings();let since=0;
 const read=async(s:number)=>{since=s;return [event,event];};
 await syncActivity(db,account,read,now);assert.equal(since,(now.getTime()-30*86400000)/1000);
 await syncActivity(db,account,read,now);assert.equal(since,Date.parse(event.time)/1000);
 let view=await readActivity(db,account,settings,now);assert.equal(view.events.length,1);assert.equal(view.notOurs,1);
 settings.ourActors=[{actorId:raw.actor_id}];view=await readActivity(db,account,settings,now);assert.equal(view.notOurs,0);assert.equal(view.events[0]!.ours,true);
 assert.match(activityStat({...sampleAdSetsView(settings),mode:'live',activity:view}),/Changes not by us · last 7 days/);
 await syncActivity(db,account,async()=>{throw new AdError('http',403,200);},now);
 assert.match((await readActivity(db,account,settings,now)).line,/Meta activity: read refused · http 403, meta 200/);
 await syncActivity(db,account,read,now);assert.doesNotMatch((await readActivity(db,account,settings,now)).line,/refused/);
});
