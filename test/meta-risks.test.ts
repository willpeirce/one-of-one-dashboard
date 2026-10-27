import assert from 'node:assert/strict';
import test from 'node:test';
import {randomBytes} from 'node:crypto';
import {decisionsHtml} from '../src/decisions/view.js';
import {metaRisks} from '../src/ad-spend/risks.js';
import {spendMarket} from '../src/ad-spend/placement.js';
import {defaultSettings} from '../src/settings.js';
import {type SpendRow} from '../src/ad-spend/model.js';
import {parseActivity} from '../src/meta-adsets/activity.js';
import {parseAdSet,saveAdSets,readAdSets,AD_SET_FIELDS} from '../src/meta-adsets/catalogue.js';
import {MetaSpend} from '../src/ad-spend/clients.js';
import {saveSpend,spendFacts} from '../src/ad-spend/store.js';
import {createTestDatabase} from './helpers/database.js';
// All identities, names and amounts are invented.
const today='2026-10-26',now=new Date(today+'T14:30:00Z'),settings={...defaultSettings(),metaAdAccountId:'invented-risk-account',blendedMetaTripwireGbp:30};
const row:SpendRow={source:'meta',accountId:settings.metaAdAccountId,campaignId:'invented-risk-campaign',campaignName:'Invented UK campaign',adSetId:'invented-risk-set',adSetName:'Invented UK set',owner:'ours',market:'uk',day:'2026-10-25',amount:'90',currency:'GBP'};
const days=['2026-10-23','2026-10-24','2026-10-25'].map(date=>({date,net:0,o:1,uk:1,us:0,sess:0,ukS:0,ukM:0,usM:0,g:0,ours:0}));
const facts=(rows:SpendRow[])=>({mode:'live' as const,rows,days:days.map(d=>({source:'meta' as const,day:d.date})),sources:[{source:'meta' as const,live:true,ready:true,status:'live',fetchedAt:now.toISOString()}]});
test('risk thresholds are strict and windows, owners and actors stay read-only',()=>{
 const risk=(rows:SpendRow[],events:ReturnType<typeof parseActivity>[]=[])=>(metaRisks(facts(rows),days,events.filter(e=>e!==null),settings,today));
 assert.ok(!risk([row]).some(n=>n.id==='meta-cpo:uk'));assert.ok(risk([{...row,amount:'90.01'}]).some(n=>n.id==='meta-cpo:uk'));
 assert.ok(!risk([{...row,day:'2026-10-22',amount:'1000'}]).some(n=>n.id==='meta-cpo:uk'));
 assert.ok(!risk([]).length);assert.ok(risk([row]).some(n=>n.id.startsWith('meta-unassigned')));
 assert.ok(!risk([{...row,day:'2026-10-19'}]).length);
 const assigned={...settings,metaOwners:[{campaignId:row.campaignId,owner:'freelancer' as const}]};
 assert.ok(!metaRisks(facts([row]),days,[],assigned,today).some(n=>n.id.startsWith('meta-unassigned')));
 const event=(next:number)=>parseActivity({event_type:'update_campaign_budget',event_time:now.toISOString(),actor_id:'invented-actor',object_id:row.campaignId,object_name:'Invented freelancer budget',extra_data:JSON.stringify({old_value:{old_value:1000,currency:'GBP'},new_value:{new_value:next,currency:'GBP'}})})!;
 for(const next of [800,1200])assert.ok(!risk([], [event(next)]).length);
 for(const next of [799,1201])assert.ok(risk([], [event(next)]).some(n=>n.id.startsWith('meta-budget')));
 assert.ok(!metaRisks(facts([]),days,[event(1201)],{...assigned,ourActors:[{actorId:'invented-actor'}]},today).length);
 const unnamed={...row,campaignName:'Invented campaign',adSetName:'Invented set',targetCountries:['GB','JE']};
 assert.ok(risk([unnamed]).some(n=>n.id.startsWith('meta-name')));assert.ok(risk([{...unnamed,targetCountries:['GB','US']}]).some(n=>n.title.includes('UK or US')));assert.ok(!risk([row]).some(n=>n.id.startsWith('meta-name')));
 for(const [countries,market] of [[['GB','JE'],'uk'],[['US'],'us'],[['GB','US'],'unknown']] as const)assert.equal(spendMarket({...unnamed,targetCountries:countries}),market);
 assert.equal(spendMarket({...row,targetCountries:['US']}),'uk');
});
test('only countries survive catalogue parsing and reach current and historical spend storage',async t=>{
 const db=await createTestDatabase();t.after(()=>db.close());
 assert.match(AD_SET_FIELDS,/targeting\{geo_locations\}/);
 const set=parseAdSet({id:row.adSetId,campaign_id:row.campaignId,name:'Invented neutral set',status:'ACTIVE',effective_status:'ACTIVE',created_time:now.toISOString(),updated_time:now.toISOString(),targeting:{geo_locations:{countries:['GB','JE'],cities:[{key:'invented-city'}]},age_min:30}},'GBP',settings);
 await saveAdSets(db,settings.metaAdAccountId,[set],settings,now);
 const sets=await readAdSets(db,settings.metaAdAccountId,settings);assert.deepEqual(sets[0]!.targetCountries,['GB','JE']);assert.equal(sets[0]!.market,'uk');assert.ok(!JSON.stringify(sets).includes('invented-city'));
 const reader=new MetaSpend(randomBytes(16).toString('hex'),{sleep:async()=>{},fetch:async input=>{
  const url=new URL(String(input));if(!url.pathname.endsWith('/insights'))return Response.json({currency:'GBP',timezone_name:'Europe/London'});
  const day=JSON.parse(url.searchParams.get('time_range')!).since;
  return Response.json({data:[{campaign_id:row.campaignId,campaign_name:'Invented neutral campaign',adset_id:row.adSetId,adset_name:set.name,date_start:day,spend:'17',hourly_stats_aggregated_by_advertiser_time_zone:'14:00:00 - 14:59:59'}]});
 }});reader.setTargetCountries(sets);
 for(const day of ['2026-08-01',today]){
  const rows=await reader.read(settings.metaAdAccountId,day,day,settings,now);assert.equal(rows[0]!.market,'uk');
  await saveSpend(db,'meta',settings.metaAdAccountId,day,day,rows,now);
  const saved=await spendFacts(db,settings,{META_ACCESS_TOKEN:randomBytes(16).toString('hex')},'live',day,day,now);
  assert.equal(saved.rows[0]!.market,'uk');assert.deepEqual(saved.rows[0]!.targetCountries,['GB','JE']);
 }
});


test('Meta CPO warns for positive spend with no counted orders and exposes a display figure', () => {
 const noOrders = days.map(day => ({...day, o: 0, uk: 0, us: 0}));
 const zero = metaRisks(facts([row]), noOrders, [], settings, today).find(need => need.id === 'meta-cpo:uk')!;
 assert.equal(zero.source, 'meta'); assert.equal(zero.state, 'warn');
 assert.deepEqual(zero.figure, {value: '£90.00', label: 'spent · 0 orders'});
 assert.match(zero.why, /0 counted orders/);
 assert.ok(!metaRisks(facts([{...row, amount: '0'}]), noOrders, [], settings, today).some(need => need.id.startsWith('meta-cpo:')));
 const ordinary = metaRisks(facts([{...row, amount: '120'}]), days, [], settings, today).find(need => need.id === 'meta-cpo:uk')!;
 assert.deepEqual(ordinary.figure, {value: '£40.00', label: 'an order · 3 days'});
 const html = decisionsHtml({shopify: {mode: 'live', needs: [zero, ordinary], checks: [], stock: [], detail: {},
   live: {lastOrder: '', dispatch: '', carts: ''}}});
 assert.doesNotMatch(html, /Shopify/); assert.match(html, /Meta/);
 assert.ok(metaRisks(facts([row]), days, [], settings, today).every(need => need.source === 'meta'));
});
