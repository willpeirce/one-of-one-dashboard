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
