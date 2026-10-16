import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import test from 'node:test';
import {defaultSettings} from '../src/settings.js';
import {sampleAdSetsView,decisionRows,readAdSetsView} from '../src/meta-adsets/presentation.js';
import {adSetCards,adSetTable,adSetSheet} from '../src/meta-adsets/view.js';
import {createTestDatabase} from './helpers/database.js';
test('cards order every non-Clear verdict, filter market and distinguish never-read from all clear',()=>{
 const v=sampleAdSetsView(defaultSettings());
 assert.deepEqual(decisionRows(v).map(r=>r.verdict!.verdict),['Kill','Slipping','Delivery','Test share','Step']);
 assert.match(adSetCards({...v,rows:[]}),/Every live set is inside its rules/);
 assert.match(adSetCards({...v,lastRead:null}),/catalogue has never been read/);
 assert.equal(decisionRows(v,'us').length,0);
 assert.doesNotMatch(adSetCards(v),/Clear Fern/);
});
test('/ads sorts owners, gives freelancer trigger comparisons without verdicts, and sheets include daily rows',()=>{
 const v=sampleAdSetsView(defaultSettings()),table=adSetTable(v);
 assert.deepEqual(v.rows.map(r=>r.set.owner),['ours','ours','ours','ours','ours','ours','freelancer','unassigned']);
 const freelancer=v.rows.find(r=>r.set.owner==='freelancer')!;assert.equal(freelancer.verdict,null);
 assert.match(table,/3d under trigger/);assert.match(table,/7d under trigger/);assert.match(table,/ours £/);assert.match(table,/assign in Settings/);assert.match(table,/ad sets add up/);
 const sheet=adSetSheet(v.rows[0]!,v);assert.match(sheet,/Last 7 UK days/);assert.match(sheet,/2026-10-09/);assert.match(sheet,/Adds to cart/);
});
test('live catalogue never silently falls back to sample; its freshness is independent',async t=>{
 const db=await createTestDatabase();t.after(()=>db.close());const s=defaultSettings();s.metaAdAccountId='900000000801';
 const env={META_ACCESS_TOKEN:randomBytes(16).toString('hex')};
 const v=await readAdSetsView(db,s,env,new Date('2026-10-16T12:00:00Z'));assert.equal(v.mode,'live');assert.equal(v.count,0);assert.equal(v.lastRead,null);
 await db.query('INSERT INTO pulse.meta_ad_set_sync(account_id,last_read) VALUES($1,$2)',[s.metaAdAccountId,'2026-10-16T09:59:00Z']);
 assert.equal((await readAdSetsView(db,s,env,new Date('2026-10-16T12:00:00Z'))).stale,true);
});

test('one set-name formatter serves cards, rows, sheet and action review without budget-only headings',async()=>{
 const {adSetName}=await import('../src/meta-adsets/name.js');
 const {actionForm}=await import('../src/meta-adsets/view.js');
 assert.equal(adSetName('Invented type — Cedar grove — £24'),'Cedar grove');
 assert.equal(adSetName('Cedar grove'),'Cedar grove');
 assert.equal(adSetName('Cedar - Grove'),'Cedar - Grove');
 assert.equal(adSetName('Invented - Oak - £24'),'Invented - Oak - £24');
 const view=sampleAdSetsView(defaultSettings()),row=view.rows[0]!;
 row.set.name='Invented type — Cedar grove — £24';
 for(const html of [adSetCards(view),adSetTable(view),adSetSheet(row,view),actionForm(row)]){
  assert.match(html,/Cedar grove/);assert.doesNotMatch(html,/Invented type|£24/);
 }
});

test('freelancer missing purchases have one short explanation instead of two unknown templates',()=>{
 const view=sampleAdSetsView(defaultSettings()),row=view.rows.find(r=>r.set.owner==='freelancer')!;
 row.freelancer[1]!.over=null;row.freelancer[1]!.cpp=null;
 for(const html of [adSetTable({...view,rows:[row]}),adSetSheet(row,view)]){
  assert.equal((html.match(/no purchase data yet/g)??[]).length,1);
  assert.doesNotMatch(html,/3d under trigger|7d unknown|ours Unknown/);
 }
});

test('ad-set API day arrays are oldest first after out-of-order backfills',async t=>{
 const Fastify=(await import('fastify')).default;
 const {registerAdSets}=await import('../src/meta-adsets/routes.js');
 const {saveAdSets,parseAdSet}=await import('../src/meta-adsets/catalogue.js');
 const {saveSpend}=await import('../src/ad-spend/store.js');
 const db=await createTestDatabase();t.after(()=>db.close());
 const account='900000009201',set='900000009202',campaign='900000009203',now=new Date('2026-10-16T12:00:00Z');
 const settings={...defaultSettings(),metaAdAccountId:account,metaOwners:[{campaignId:campaign,owner:'ours' as const}]};
 await db.query('INSERT INTO pulse.settings(values) VALUES($1)',[JSON.stringify(settings)]);
 await saveAdSets(db,account,[parseAdSet({id:set,campaign_id:campaign,name:'Invented UK Linden',status:'ACTIVE',effective_status:'ACTIVE',daily_budget:'2000',created_time:'2026-10-01T08:00:00Z',updated_time:'2026-10-01T08:00:00Z'},'GBP',settings)],settings,now);
 for(const day of ['2026-10-14','2026-10-10','2026-10-12'])await saveSpend(db,'meta',account,day,day,[{source:'meta',accountId:account,campaignId:campaign,campaignName:'Invented UK',adSetId:set,adSetName:'Invented UK Linden',market:'uk',owner:'ours',day,amount:'20',currency:'GBP',purchases:2,addsToCart:4}],now);
 const app=Fastify();t.after(()=>app.close());registerAdSets(app,db,{session:async()=> 'invented-credential'} as unknown as import('../src/auth.js').Auth,{META_ACCESS_TOKEN:randomBytes(16).toString('hex')},()=>now);
 const response=await app.inject('/api/meta/adsets');assert.equal(response.statusCode,200);
 assert.deepEqual(response.json().rows[0].days.map((d:{day:string})=>d.day),['2026-10-10','2026-10-12','2026-10-14']);
});


test('sheet and reasons use the catalogue market even when a campaign name points elsewhere',async t=>{
 const {saveAdSets,parseAdSet}=await import('../src/meta-adsets/catalogue.js');
 const {saveSpend}=await import('../src/ad-spend/store.js');
 const db=await createTestDatabase();t.after(()=>db.close());const account='invented-market-account',campaign='invented-market-campaign';
 const settings={...defaultSettings(),metaAdAccountId:account,metaOwners:[{campaignId:campaign,owner:'ours' as const}],cppUkBreakEvenGbp:21,cppUsBreakEvenGbp:28};
 settings.adRules.us.overrideGbp=31;settings.adRules.us.overrideUntil='2026-10-20';
 const now=new Date('2026-10-16T12:00:00Z');
 for(const market of ['uk','us'] as const){
  const id=`invented-${market}-set`;
  await saveAdSets(db,account,[parseAdSet({id,campaign_id:campaign,name:'Invented Fern',status:'ACTIVE',effective_status:'ACTIVE',daily_budget:'2000',created_time:'2026-10-01T08:00:00Z',updated_time:'2026-10-01T08:00:00Z'},'GBP',settings)],settings,now);
  await db.query('UPDATE pulse.meta_ad_sets SET market=$2 WHERE ad_set_id=$1',[id,market]);
 }
 for(const day of ['2026-10-14','2026-10-15'])await saveSpend(db,'meta',account,day,day,['uk','us'].map(market=>({source:'meta' as const,accountId:account,campaignId:campaign,campaignName:'Invented UK umbrella',adSetId:`invented-${market}-set`,adSetName:'Invented Fern',market:market as 'uk'|'us',owner:'ours' as const,day,amount:'70',currency:'GBP',purchases:1,addsToCart:0})),now);
 const view=await readAdSetsView(db,settings,{META_ACCESS_TOKEN:randomBytes(16).toString('hex')},now);
 const uk=view.rows.find(r=>r.set.market==='uk')!,us=view.rows.find(r=>r.set.market==='us')!;
 assert.match(adSetSheet(uk,view),/Break-even \(UK\): £21/);
 const sheet=adSetSheet(us,view);assert.match(sheet,/Break-even \(US\): £31.*override to 2026-10-20/);assert.match(sheet,/half-budget · US break-even £31/);assert.doesNotMatch(sheet,/UK break-even|Break-even \(UK\)/);
});
