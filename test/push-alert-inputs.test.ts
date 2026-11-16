import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type {Auth} from '../src/auth.js';
import {appConfig} from '../src/config.js';
import {readAlertEvaluation} from '../src/push/alert-inputs.js';
import {alertDestination,registerAlertLinks} from '../src/push/alert-links.js';
import {createTestDatabase} from './helpers/database.js';

const now=new Date('2032-05-03T08:00:00Z');
const modes={shopify:'live' as const,hq:'live' as const,anyLive:true};
const checks=[{id:'orders',name:'Orders flowing',status:'tripped',why:'No paid order for 3 hours.',link:'/sources'},
  {id:'ads_check',name:'Ads check',status:'pass',why:'Stored check is readable.',link:'/morning'},
  {id:'self',name:'Self-check',status:'pass',why:'No repeated failures.',link:'/sources'}];

test('alert ticks read one existing evaluation, suppress stale/sample inputs and use the existing upload need boundary',async t=>{
  const db=await createTestDatabase();t.after(()=>db.close());
  await db.query('INSERT INTO pulse.shopify_watchdog_state(mode,fetched_at,data) VALUES($1,$2,$3)',
    ['live',now,JSON.stringify({checks,alertEvaluatedAt:now.toISOString()})]);
  const first=await readAlertEvaluation(db,modes,now),again=await readAlertEvaluation(db,modes,new Date(+now+60_000));
  assert.equal(first.evaluationId,again.evaluationId,'Repeated reads are not a second watchdog evaluation');
  assert.equal(first.checks.find(row=>row.id==='orders')?.status,'tripped');
  assert.equal(first.checks.some(row=>row.id==='us_cart'),false);
  assert.equal(first.monthlyUploadOpen,true);
  const stale=await readAlertEvaluation(db,modes,new Date(+now+120_001));
  assert.ok(stale.checks.every(row=>row.status==='unknown'));
  assert.equal(stale.evaluationId,`stale:${now.toISOString()}`);
  assert.ok((await readAlertEvaluation(db,modes,new Date(+now-1))).checks.every(row=>row.status==='unknown'));
  assert.equal((await readAlertEvaluation(db,modes,new Date('2032-05-03T07:59:59Z'))).monthlyUploadOpen,false);
  await db.query(`INSERT INTO pulse.fulfilment_uploads(id,mode,source_id,file_name,row_count,saved_count,despatch_from,
    despatch_to,uploaded_at,gbp_per_usd,coverage_from,coverage_to) VALUES
    ('00000000-0000-4000-8000-000000000071','live','invented-upload','invented.csv',1,1,
    '2032-04-01','2032-04-30',$1,1,'2032-04-01','2032-04-30')`,[now]);
  assert.equal((await readAlertEvaluation(db,modes,now)).monthlyUploadOpen,false);
  await db.query("INSERT INTO pulse.shopify_watchdog_state(mode,fetched_at,data) SELECT 'sample',fetched_at,data FROM pulse.shopify_watchdog_state WHERE mode='live'");
  const mixed=await readAlertEvaluation(db,{shopify:'sample',hq:'live',anyLive:true},now);
  assert.equal(mixed.checks.find(row=>row.id==='orders')?.status,'unknown');
  assert.equal(mixed.checks.find(row=>row.id==='ads_check')?.status,'pass');
  assert.equal(mixed.checks.find(row=>row.id==='self')?.status,'pass');
  assert.equal(mixed.monthlyUploadOpen,false);
  const sample=await readAlertEvaluation(db,{shopify:'sample',hq:'sample',anyLive:false},now);
  assert.ok(sample.checks.every(row=>row.status==='unknown'));
});

test('alert links authenticate before reading and only follow the existing local or configured Shopify destination',async t=>{
  const db=await createTestDatabase(),app=Fastify({logger:false});t.after(async()=>{await app.close();await db.close();});
  const auth={session:async(request:{headers:Record<string,unknown>})=>request.headers.authorization==='invented-session'?'invented-device':null} as unknown as Auth;
  let reads=0;const guarded={...db,query:async(...args:Parameters<typeof db.query>)=>{reads++;return db.query(...args);}} as typeof db;
  registerAlertLinks(app,guarded,auth,'live');
  const anonymous=await app.inject('/alerts/check/orders');
  assert.equal(anonymous.statusCode,302);assert.equal(anonymous.headers.location,'/login');assert.equal(reads,0);
  const headers={authorization:'invented-session'};
  assert.equal((await app.inject({url:'/alerts/check/arbitrary',headers})).statusCode,404);assert.equal(reads,0);
  await db.query('INSERT INTO pulse.shopify_watchdog_state(mode,fetched_at,data) VALUES($1,$2,$3)',
    ['live',now,JSON.stringify({checks})]);
  const response=await app.inject({url:'/alerts/check/ads_check',headers});
  assert.equal(response.headers.location,'/morning');assert.equal(response.headers['cache-control'],'no-store');
  const source=`https://admin.shopify.com/store/${appConfig.shopify.storeDomain.split('.')[0]}/orders`;
  assert.equal(alertDestination(source),source);
  for(const unsafe of ['https://example.test/private','//example.test/private','javascript:alert(1)',
    'https://admin.shopify.com/store/invented-other/orders','https://invented@admin.shopify.com/',null])
    assert.equal(alertDestination(unsafe),'/sources');
});
