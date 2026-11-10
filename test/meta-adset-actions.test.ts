import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import type {Auth} from '../src/auth.js';
import {registerAdSets} from '../src/meta-adsets/routes.js';
import {MetaActionsClient} from '../src/meta-adsets/actions-client.js';
import {readMetaActions} from '../src/meta-adsets/actions.js';
import {parseAdSet,readAdSets,saveAdSets} from '../src/meta-adsets/catalogue.js';
import {readSettings,saveSettings} from '../src/settings.js';
import {adSetCards,adSetTable} from '../src/meta-adsets/view.js';
import {sampleAdSetsView} from '../src/meta-adsets/presentation.js';
import {createTestDatabase} from './helpers/database.js';
import {AdError} from '../src/ad-spend/model.js';
import {parsePauseUncertainty,pauseMayHaveApplied,pauseUncertaintyCode} from '../src/meta-adsets/pause-uncertainty.js';
import {auditPage} from '../src/views.js';
test('Act endpoint enforces flag, ownership, cap, audit and 24-hour undo; token stays out of every log and response',async t=>{
 const db=await createTestDatabase();t.after(()=>db.close());
 const secret=randomBytes(24).toString('hex'),original=process.env.META_ACCESS_TOKEN;process.env.META_ACCESS_TOKEN=secret;
 t.after(()=>{if(original===undefined)delete process.env.META_ACCESS_TOKEN;else process.env.META_ACCESS_TOKEN=original;});
 const logs:string[]=[],responses:string[]=[],info=console.info,error=console.error;console.info=(...args)=>logs.push(args.join(' '));console.error=(...args)=>logs.push(args.join(' '));t.after(()=>{console.info=info;console.error=error;});
 const initial=await readSettings(db),settings={...initial.values,metaAdAccountId:'900000000801',metaOwners:[{campaignId:'900000000802',owner:'ours' as const},{campaignId:'900000000803',owner:'freelancer' as const}]};
 await saveSettings(db,{...initial,values:settings},'invented-credential');
 let now=new Date('2026-10-16T12:00:00Z'),calls=0,refuse=false;
 const raw={id:'900000000804',campaign_id:'900000000802',name:'Invented UK Alder',status:'ACTIVE',effective_status:'ACTIVE',daily_budget:'2000',created_time:'2026-10-01T08:00:00Z',updated_time:'2026-10-01T08:00:00Z'};
 await saveAdSets(db,settings.metaAdAccountId,[parseAdSet(raw,'GBP',settings),parseAdSet({...raw,id:'900000000805',campaign_id:'900000000803'},'GBP',settings)],settings,now);
 const catalogueRead=now.toISOString();now=new Date(now.getTime()+30_000);
 const fetcher:typeof fetch=async(url,init)=>{
  calls++;assert.equal((init?.headers as Record<string,string>).Authorization,`Bearer ${secret}`);
  if(init?.method==='POST'){
   assert.equal((await db.query("SELECT id FROM pulse.meta_actions WHERE result='pending'")).rowCount,1,'audit reservation commits before outbound call');
   if(refuse)return Response.json({error:{code:100,message:secret}},{status:400});
   const body=new URLSearchParams(String(init.body));if(body.has('status'))raw.status=raw.effective_status=body.get('status')!;if(body.has('daily_budget'))raw.daily_budget=body.get('daily_budget')!;
   return Response.json({success:true});
  }
  assert.ok(String(url).includes(raw.id));return Response.json(raw);
 };
 let authenticated=true;
 const auth={session:async()=>authenticated?'invented-credential':null} as unknown as Auth;
 const make=(on:boolean)=>{const app=Fastify({logger:false});registerAdSets(app,db,auth,{META_ACTIONS_ENABLED:on?'true':'false',META_ACCESS_TOKEN:secret},()=>now,{fetch:fetcher,sleep:async()=>{}});t.after(()=>app.close());return app;};
 const off=make(false),app=make(true);
 const post=async(server:typeof app,id:string,payload:unknown)=>{const r=await server.inject({method:'POST',url:`/api/meta/adset/${id}`,headers:{'content-type':'application/json'},payload:JSON.stringify(payload)});responses.push(r.body);return r;};
 assert.equal((await post(off,raw.id,{action:'pause'})).statusCode,404);assert.equal(calls,0);
 authenticated=false;assert.equal((await post(app,raw.id,{action:'pause'})).statusCode,401);authenticated=true;
 assert.equal((await post(app,'900000000805',{action:'pause'})).statusCode,403);assert.equal(calls,0);
 assert.equal((await post(app,raw.id,{action:'budget',value:26.01})).statusCode,400);
 assert.equal((await post(app,raw.id,{action:'budget',value:0.99})).statusCode,400);assert.equal(calls,0);
 const paused=await post(app,raw.id,{action:'pause'});assert.equal(paused.statusCode,200);assert.equal(calls,2);
 assert.equal(new Date((await db.query('SELECT last_read FROM pulse.meta_ad_set_sync')).rows[0]!.last_read as string).toISOString(),catalogueRead,'one-set action refresh does not certify the full catalogue');
 const actions=await readMetaActions(db);assert.equal(actions[0]!.result,'success');assert.equal(actions[0]!.oldValue,'ACTIVE');
 assert.equal((await db.query("SELECT who FROM pulse.meta_actions WHERE result='success'")).rows[0]!.who,'invented-credential');
 assert.equal((await db.query('SELECT * FROM pulse.meta_ad_set_changes')).rowCount,0,'own write is not external');
 now=new Date('2026-10-16T12:01:00Z');
 assert.equal((await post(app,raw.id,{action:'undo',value:paused.json().id})).statusCode,200);assert.equal(raw.status,'ACTIVE');
 assert.ok((await readMetaActions(db)).find(a=>a.id===paused.json().id)!.undoneAt);
 assert.equal((await post(app,raw.id,{action:'undo',value:paused.json().id})).statusCode,409);
 now=new Date('2026-10-16T12:02:00Z');const budget=await post(app,raw.id,{action:'budget',value:26});assert.equal(budget.statusCode,200);assert.equal(raw.daily_budget,'2600');
 now=new Date('2026-10-17T12:03:00Z');assert.equal((await post(app,raw.id,{action:'undo',value:budget.json().id})).statusCode,409);
 refuse=true;assert.equal((await post(app,raw.id,{action:'pause'})).statusCode,502);
 assert.ok((await readMetaActions(db)).some(a=>a.errorCode==='http 400, meta 100'));
 assert.equal(logs.join('\n').includes(secret),false);assert.equal(responses.join('\n').includes(secret),false);
 assert.deepEqual(Object.getOwnPropertyNames(MetaActionsClient.prototype).sort(),['constructor','pause','resume','setDailyBudget']);
 const view=sampleAdSetsView(settings);assert.doesNotMatch(adSetCards(view)+adSetTable(view),/data-adset-act/);
 view.actionsEnabled=true;const table=adSetTable(view);assert.equal((table.match(/data-adset-act/g)??[]).length,6);
});

test('flat budget endpoint saves only our local flag, audits it and survives catalogue refresh with actions off',async t=>{
 const {readAdSets}=await import('../src/meta-adsets/catalogue.js');
 const {adSetSheet}=await import('../src/meta-adsets/view.js');
 const db=await createTestDatabase();t.after(()=>db.close());
 const initial=await readSettings(db),settings={...initial.values,metaAdAccountId:'900000009101',metaOwners:[{campaignId:'900000009102',owner:'ours' as const}]};
 await saveSettings(db,{...initial,values:settings},'invented-credential');
 const now=new Date('2026-10-16T12:00:00Z');
 const row=parseAdSet({id:'900000009103',campaign_id:'900000009102',name:'Invented UK Cedar',status:'ACTIVE',effective_status:'ACTIVE',daily_budget:'2000',created_time:now.toISOString(),updated_time:now.toISOString()},'GBP',settings);
 await saveAdSets(db,settings.metaAdAccountId,[row,{...row,id:'900000009104',campaignId:'900000009105'}],settings,now);
 let signedIn=true,calls=0;
 const app=Fastify({logger:false});t.after(()=>app.close());
 registerAdSets(app,db,{session:async()=>signedIn?'invented-credential':null} as unknown as Auth,{},()=>now,{fetch:async()=>{calls++;throw new Error('No source call allowed');}});
 const post=(id:string,payload:unknown)=>app.inject({method:'POST',url:`/api/meta/adset/${id}/flags`,headers:{'content-type':'application/json'},payload:JSON.stringify(payload)});
 signedIn=false;assert.equal((await post(row.id,{flatBudget:true})).statusCode,401);signedIn=true;
 assert.equal((await post('900000009104',{flatBudget:true})).statusCode,403);
 assert.equal((await post(row.id,{flatBudget:true,dailyBudget:3000})).statusCode,400);
 assert.equal((await post(row.id,{flatBudget:'true'})).statusCode,400);
 const before=(await readAdSets(db,settings.metaAdAccountId,settings)).find(r=>r.id===row.id)!;
 assert.equal(before.flatBudget,null);
 assert.equal((await post(row.id,{flatBudget:true})).statusCode,200);
 const after=(await readAdSets(db,settings.metaAdAccountId,settings)).find(r=>r.id===row.id)!;
 assert.deepEqual(after,{...before,flatBudget:true});
 const audit=(await db.query<any>("SELECT * FROM pulse.audit_log WHERE event LIKE 'ad set flat budget%'")).rows;
 assert.equal(audit.length,1);assert.match(audit[0].event,/null → true/);assert.equal(audit[0].credential_id,'invented-credential');
 await saveAdSets(db,settings.metaAdAccountId,[row],settings,new Date(now.getTime()+1800000));
 assert.equal((await readAdSets(db,settings.metaAdAccountId,settings))[0]!.flatBudget,true);
 assert.equal((await post(row.id,{flatBudget:false})).statusCode,200);assert.equal(calls,0);
 const sample=sampleAdSetsView(settings),flat=sample.rows.filter(r=>r.set.flatBudget);
 assert.equal(flat.length,1);assert.match(adSetSheet(flat[0]!,sample),/name="flatBudget" checked/);
 assert.doesNotMatch(adSetSheet(sample.rows.find(r=>r.set.owner==='freelancer')!,sample),/Flat budget, no schedule/);
});

async function concurrentActions(t: import('node:test').TestContext,
  transport: (init: RequestInit | undefined, raw: Record<string,string>) => Promise<Response>) {
 const db=await createTestDatabase();
 const secret=randomBytes(24).toString('hex'),previous=process.env.META_ACCESS_TOKEN;
 process.env.META_ACCESS_TOKEN=secret;
 t.after(()=>{if(previous===undefined)delete process.env.META_ACCESS_TOKEN;else process.env.META_ACCESS_TOKEN=previous;});
 const initial=await readSettings(db),settings={...initial.values,metaAdAccountId:'120000000000019001',
  metaOwners:[{campaignId:'120000000000019002',owner:'ours' as const}]};
 await saveSettings(db,{...initial,values:settings},'invented-device');
 const raw={id:'120000000000019003',campaign_id:'120000000000019002',name:'Invented Fern UK',
  status:'ACTIVE',effective_status:'ACTIVE',daily_budget:'2000',created_time:'2032-04-01T08:00:00Z',updated_time:'2032-04-01T08:00:00Z'};
 let now=new Date('2032-04-07T08:00:00Z');
 await saveAdSets(db,settings.metaAdAccountId,[parseAdSet(raw,'GBP',settings)],settings,now);
 const app=Fastify({logger:false});
 t.after(async()=>{await app.close();await db.close();});
 registerAdSets(app,db,{session:async()=> 'invented-device'} as unknown as Auth,
  {META_ACTIONS_ENABLED:'true',META_ACCESS_TOKEN:secret},()=>now,{fetch:async(_url,init)=>transport(init,raw),sleep:async()=>{}});
 return {db,raw,settings,setNow:(at:string)=>{now=new Date(at);},
  poll:(at:string,status:string)=>saveAdSets(db,settings.metaAdAccountId,
   [parseAdSet({...raw,status,effective_status:status},'GBP',settings)],settings,new Date(at)),
  post:(payload:object)=>app.inject({method:'POST',url:`/api/meta/adset/${raw.id}`,
  headers:{'content-type':'application/json'},payload:JSON.stringify(payload)}),
  stored:async()=> (await readAdSets(db,settings.metaAdAccountId,settings))[0]!};
}

test('a second device cannot repeat a pending or confirmed pause even when the optional read still says ACTIVE',async t=>{
 let release!:()=>void,entered!:()=>void,writes=0;
 const blocked=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
 t.after(()=>release());
 const h=await concurrentActions(t,async(init,raw)=>{
  if(init?.method==='POST'){writes++;entered();await blocked;return Response.json({success:true});}
  return Response.json({...raw,name:'Invented Fern UK refreshed'});
 });
 const first=h.post({action:'pause'});
 await started;
 assert.equal((await h.db.query("SELECT id FROM pulse.meta_actions WHERE result='pending'")).rowCount,1);
 assert.equal((await h.post({action:'pause'})).statusCode,409);
 assert.equal(writes,1,'The pending audit prevents a second outbound write');
 release();
 assert.equal((await first).statusCode,200);
 const stored=await h.stored();
 assert.equal(stored.status,'PAUSED','A stale optional read cannot reverse the confirmed local write');
 assert.equal(stored.name,'Invented Fern UK refreshed','Unrelated catalogue metadata still refreshes');
 assert.equal((await h.post({action:'pause'})).statusCode,409);
 assert.equal(writes,1,'A reload or another device cannot send the confirmed pause again');
 assert.equal((await readMetaActions(h.db)).filter(row=>row.result==='success').length,1);
});

test('only an explicit provider refusal is a definite failed pause',()=>{
 for(const error of [new AdError('timeout'),new AdError('http',200),new AdError('http',502),new AdError('http',408,100),new AdError('http',400),new Error('invented')])
  assert.equal(pauseMayHaveApplied(error),true);
 for(const error of [new AdError('http',400,100),new AdError('http',403,200),new AdError('unauthorized'),new AdError('invalid')])
  assert.equal(pauseMayHaveApplied(error),false);
 assert.equal(parsePauseUncertainty('timeout'),null);
 assert.equal(parsePauseUncertainty('pause-uncertain-v1|waiting|invalid|timeout'),null);
});

test('a lost pause acknowledgement keeps its reservation until a later poll confirms PAUSED, then normal undo works',async t=>{
 let writes=0,reads=0;
 const h=await concurrentActions(t,async(init,raw)=>{
  if(init?.method==='POST'){
   writes++;const body=new URLSearchParams(String(init.body));
   raw.status=raw.effective_status=body.get('status')!;
   if(writes===1){h.setNow('2032-04-07T08:00:15Z');throw new Error('invented lost acknowledgement');}
   return Response.json({success:true});
  }
  reads++;return Response.json(raw);
 });
 const first=await h.post({action:'pause'});
 assert.equal(first.statusCode,502);assert.match(first.json().error,/result is uncertain.*next Meta read.*no retry/i);
 let actions=await readMetaActions(h.db,h.settings.metaAdAccountId);
 const id=actions[0]!.id;
 assert.equal(actions[0]!.result,'pending');
 assert.equal(parsePauseUncertainty(actions[0]!.errorCode)?.finishedAt,'2032-04-07T08:00:15.000Z');
 assert.equal((await h.post({action:'pause'})).statusCode,409);
 assert.equal((await h.post({action:'budget',value:24})).statusCode,409);
 assert.equal(writes,1);assert.equal(reads,0,'An uncertain response adds no source read or retry');
 await h.poll('2032-04-07T08:00:10Z','ACTIVE');
 assert.equal((await readMetaActions(h.db))[0]!.result,'pending','A poll begun before the failed acknowledgement cannot release the barrier');
 assert.equal((await h.post({action:'pause'})).statusCode,409);assert.equal(writes,1);
 await h.poll('2032-04-07T08:01:00Z','PAUSED');
 actions=await readMetaActions(h.db,h.settings.metaAdAccountId);
 assert.equal(actions[0]!.result,'success');assert.equal(parsePauseUncertainty(actions[0]!.errorCode)?.phase,'paused');
 assert.equal((await h.stored()).status,'PAUSED');
 assert.equal((await h.db.query('SELECT * FROM pulse.meta_ad_set_changes')).rowCount,0,'Reconciliation is our saved pause, not an invented external change');
 h.setNow('2032-04-07T08:02:00Z');
 assert.equal((await h.post({action:'undo',value:id})).statusCode,200);
 assert.equal((await h.stored()).status,'ACTIVE');assert.equal(writes,2);assert.equal(reads,1);
 assert.ok((await readMetaActions(h.db)).find(action=>action.id===id)!.undoneAt);
});

test('an uncertain pause observed ACTIVE becomes an individual decision and permits a deliberate later action',async t=>{
 let writes=0;
 const h=await concurrentActions(t,async(init,raw)=>{
  if(init?.method==='POST'){
   writes++;if(writes===1){h.setNow('2032-04-07T08:00:15Z');return new Response('invented incomplete response',{status:200});}
   raw.status=raw.effective_status=new URLSearchParams(String(init.body)).get('status')!;
   return Response.json({success:true});
  }
  return Response.json(raw);
 });
 assert.equal((await h.post({action:'pause'})).statusCode,502);
 assert.equal((await h.post({action:'pause'})).statusCode,409);assert.equal(writes,1);
 await h.poll('2032-04-07T08:01:00Z','ACTIVE');
 const observed=(await readMetaActions(h.db))[0]!;
 assert.equal(observed.result,'failed');assert.equal(parsePauseUncertainty(observed.errorCode)?.phase,'active');
 assert.equal((await h.stored()).status,'ACTIVE');
 const html=auditPage([], [observed]);assert.match(html,/Review individually; the next Meta read showed Active/);assert.doesNotMatch(html,/pause-uncertain-v1/);
 h.setNow('2032-04-07T08:02:00Z');
 assert.equal((await h.post({action:'pause'})).statusCode,200);assert.equal(writes,2);
});

test('unresolved pauses stay visible beyond the recent fifty actions and do not cross account scope',async t=>{
 const h=await concurrentActions(t,async()=>{throw new Error('No source call expected');});
 const marker=pauseUncertaintyCode('waiting',new Date('2032-04-07T07:00:15Z'),'timeout');
 await h.db.query(`INSERT INTO pulse.meta_actions(id,time,account_id,ad_set_id,action,old_value,new_value,who,result,error_code)
  SELECT 'invented-recent-'||n,'2032-04-07T08:00:00Z'::timestamptz+n*interval '1 second',$1,'invented-other-set-'||n,
   'budget','2000','2400','invented-device','success',NULL FROM generate_series(1,55) n`,[h.settings.metaAdAccountId]);
 for(const [id,account,phase,result] of [['invented-waiting',h.settings.metaAdAccountId,'waiting','pending'],
  ['invented-observed-active',h.settings.metaAdAccountId,'active','failed'],['invented-other-account','120000000000029001','waiting','pending']] as const)
  await h.db.query(`INSERT INTO pulse.meta_actions(id,time,account_id,ad_set_id,action,old_value,new_value,who,result,error_code)
   VALUES($1,'2032-04-07T07:00:00Z',$2,$1,'pause','ACTIVE','PAUSED','invented-device',$3,$4)`,
   [id,account,result,phase==='waiting'?marker:pauseUncertaintyCode(phase,new Date('2032-04-07T07:00:15Z'),'timeout')]);
 const actions=await readMetaActions(h.db,h.settings.metaAdAccountId);
 assert.equal(actions.length,52);assert.ok(actions.some(action=>action.id==='invented-waiting'));
 assert.ok(actions.some(action=>action.id==='invented-observed-active'));
 assert.equal(actions.some(action=>action.id==='invented-other-account'),false);
 const html=auditPage([],actions);assert.match(html,/Waiting for the next Meta read; the pause result is uncertain/);assert.doesNotMatch(html,/pause-uncertain-v1/);
});

test('a delayed action refresh preserves a later action on the other mutable field',async t=>{
 for(const firstAction of ['pause','budget'] as const)await t.test(firstAction,async t=>{
  let release!:()=>void,entered!:()=>void,reads=0,writes=0;
  const blocked=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
  t.after(()=>release());
  const h=await concurrentActions(t,async(init,raw)=>{
   if(init?.method==='POST'){
    writes++;const body=new URLSearchParams(String(init.body));
    if(body.has('status'))raw.status=raw.effective_status=body.get('status')!;
    if(body.has('daily_budget'))raw.daily_budget=body.get('daily_budget')!;
    return Response.json({success:true});
   }
   const captured={...raw};
   if(++reads===1){entered();await blocked;}
   return Response.json(captured);
  });
  const pause={action:'pause'},budget={action:'budget',value:24};
  const first=h.post(firstAction==='pause'?pause:budget);
  await started;
  const second=h.post(firstAction==='pause'?budget:pause);
  // The reader serializes GETs, so wait for the later write's committed audit,
  // not its response (which also waits for the first optional GET).
  for(let attempt=0;attempt<200;attempt++){
   if((await readMetaActions(h.db)).filter(row=>row.result==='success').length===2)break;
   await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.equal((await readMetaActions(h.db)).filter(row=>row.result==='success').length,2);
  release();assert.equal((await first).statusCode,200);assert.equal((await second).statusCode,200);
  const stored=await h.stored();
  assert.equal(stored.status,'PAUSED');assert.equal(stored.dailyBudget,2400);
  assert.equal(writes,2);assert.equal(reads,2,'Each existing action keeps only its usual optional read');
  assert.equal((await h.db.query('SELECT * FROM pulse.meta_ad_set_changes')).rowCount,0,'Stale refreshes do not invent an external change');
 });
});
