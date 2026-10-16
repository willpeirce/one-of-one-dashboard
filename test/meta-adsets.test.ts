import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { MetaSpend } from '../src/ad-spend/clients.js';
import { readAdSets, saveAdSets } from '../src/meta-adsets/catalogue.js';
import { defaultSettings } from '../src/settings.js';
import { createTestDatabase } from './helpers/database.js';
const invented = (id: string) => ({ id,campaign_id:'invented-campaign',name:'Invented — UK — Cedar',status:'ACTIVE',effective_status:'ACTIVE',daily_budget:'2500',lifetime_budget:'0',created_time:'2026-10-01T08:00:00Z',updated_time:'2026-10-02T08:00:00Z',learning_stage_info:{status:'LEARNING',last_sig_edit_ts:1790841600} });
test('ad-set catalogue reads cursor pages without a deleted/status filter, parses budgets and retains vanished rows', async t => {
  const db=await createTestDatabase(); t.after(()=>db.close());
  const settings={...defaultSettings(),metaOwners:[{campaignId:'invented-campaign',owner:'ours' as const}]};
  const seen:URL[]=[];
  const meta=new MetaSpend(randomBytes(16).toString('hex'),{sleep:async()=>{},fetch:async url=>{
    const u=new URL(String(url));seen.push(u);
    return Response.json(u.pathname.endsWith('/adsets') ? (u.searchParams.has('after') ? {data:[invented('invented-b'),{...invented('invented-deleted'),status:'DELETED'}]} : {data:[invented('invented-a')],paging:{next:'ignored',cursors:{after:'invented-next'}}}) : {currency:'GBP'});
  }});
  const rows=await meta.readAdSets('invented-account',settings);
  assert.equal(rows.length,2);assert.equal(rows[0]!.dailyBudget,2500);assert.equal(rows[0]!.learningStage,'LEARNING');
  assert.ok(seen.filter(u=>u.pathname.endsWith('/adsets')).every(u=>!u.searchParams.has('effective_status')&&!u.searchParams.has('filtering')));
  await saveAdSets(db,'invented-account',rows,settings,new Date('2026-10-16T08:00:00Z'));
  await saveAdSets(db,'invented-account',[{...rows[0]!,name:'Invented — UK — Renamed'}],settings,new Date('2026-10-16T08:30:00Z'));
  const stored=await readAdSets(db,'invented-account',settings);
  assert.equal(stored.length,2);assert.equal(stored.find(r=>r.id==='invented-b')!.lastSeen,'2026-10-16T08:00:00.000Z');
  assert.equal(stored.find(r=>r.id==='invented-a')!.firstSeen,'2026-10-16T08:00:00.000Z');
  assert.ok((await readAdSets(db,'invented-account',defaultSettings())).every(r=>r.owner==='unassigned'));
  assert.equal((await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='pulse' AND table_name='meta_ad_sets' AND column_name='owner'")).rowCount,0);
});

test('extended ad-set spend aligns actions into UK days and stores absent actions as null', async t => {
  const { saveSpend }=await import('../src/ad-spend/store.js');
  const db=await createTestDatabase();t.after(()=>db.close());
  const rows=[
    {date_start:'2026-10-24',hourly_stats_aggregated_by_advertiser_time_zone:'23:00:00 - 23:59:59',actions:[{action_type:'omni_purchase',value:'2'},{action_type:'omni_add_to_cart',value:'4'}],action_values:[{action_type:'omni_purchase',value:'80'}]},
    {date_start:'2026-10-25',hourly_stats_aggregated_by_advertiser_time_zone:'02:00:00 - 02:59:59',actions:[{action_type:'omni_purchase',value:'1'},{action_type:'omni_add_to_cart',value:'3'}],action_values:[{action_type:'omni_purchase_values',value:'40'}]},
    {date_start:'2026-10-26',hourly_stats_aggregated_by_advertiser_time_zone:'12:00:00 - 12:59:59'},
  ].map(r=>({...r,campaign_id:'invented-campaign',campaign_name:'Invented UK',adset_id:'invented-set',adset_name:'Invented UK Cedar',spend:'10',impressions:'100',inline_link_clicks:'8'}));
  const meta=new MetaSpend(randomBytes(16).toString('hex'),{sleep:async()=>{},fetch:async url=>{
    const u=new URL(String(url));
    if(!u.pathname.endsWith('/insights'))return Response.json({currency:'GBP',timezone_name:'GMT'});
    assert.equal(u.searchParams.get('level'),'adset');assert.equal(u.searchParams.get('breakdowns'),'hourly_stats_aggregated_by_advertiser_time_zone');
    assert.match(u.searchParams.get('fields')!,/actions,action_values/);
    return Response.json({data:rows});
  }});
  const read=await meta.read('invented-account','2026-10-25','2026-10-26',defaultSettings());
  assert.equal(read.length,2);assert.equal(read[0]!.purchases,3);assert.equal(read[0]!.addsToCart,7);assert.equal(read[0]!.purchaseValue,120);
  assert.equal(read[1]!.purchases,null);assert.equal(read[1]!.addsToCart,null);assert.equal(read[1]!.purchaseValue,null);
  await saveSpend(db,'meta','invented-account','2026-10-25','2026-10-26',read,new Date());
  const stored=await db.query<any>('SELECT purchases,adds_to_cart,purchase_value FROM pulse.ad_spend ORDER BY uk_day');
  assert.equal(Number(stored.rows[0].purchases),3);assert.equal(stored.rows[1].purchases,null);
});

test('changes not by us audit only owned status/budget differences and flow into the sheet',async t=>{
 const {readAdSetsView}=await import('../src/meta-adsets/presentation.js');
 const {adSetSheet}=await import('../src/meta-adsets/view.js');
 const {parseAdSet}=await import('../src/meta-adsets/catalogue.js');
 const db=await createTestDatabase();t.after(()=>db.close());
 const settings={...defaultSettings(),metaAdAccountId:'invented-account',metaOwners:[{campaignId:'invented-campaign',owner:'ours' as const}]};
 const row=parseAdSet(invented('invented-a'),'GBP',settings);
 await saveAdSets(db,settings.metaAdAccountId,[row],settings,new Date('2026-10-14T08:00:00Z'));
 await saveAdSets(db,settings.metaAdAccountId,[{...row,status:'PAUSED',dailyBudget:3000}],settings,new Date('2026-10-15T08:00:00Z'));
 assert.equal((await db.query("SELECT * FROM pulse.audit_log WHERE event='ad set changed outside the app'")).rowCount,2);
 await saveAdSets(db,settings.metaAdAccountId,[{...row,status:'PAUSED',dailyBudget:3000}],settings,new Date('2026-10-15T08:30:00Z'));
 assert.equal((await db.query('SELECT * FROM pulse.meta_ad_set_changes')).rowCount,2);
 const view=await readAdSetsView(db,settings,{META_ACCESS_TOKEN:randomBytes(16).toString('hex')},new Date('2026-10-16T08:00:00Z'));
 assert.match(adSetSheet(view.rows[0]!,view),/daily_budget: 2500 → 3000/);
 await saveAdSets(db,settings.metaAdAccountId,[row],settings,new Date('2026-10-16T08:00:00Z'),{id:row.id,field:'daily_budget',value:'2500'});
 assert.equal((await db.query('SELECT * FROM pulse.meta_ad_set_changes')).rowCount,3,'app budget suppressed; external status still observed');
 await saveAdSets(db,settings.metaAdAccountId,[{...row,dailyBudget:4000}],{...settings,metaOwners:[]},new Date('2026-10-16T08:30:00Z'));
 assert.equal((await db.query('SELECT * FROM pulse.meta_ad_set_changes')).rowCount,3);
});
