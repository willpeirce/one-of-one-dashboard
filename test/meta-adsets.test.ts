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
