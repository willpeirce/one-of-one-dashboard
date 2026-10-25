import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import test from 'node:test';
import {AdError} from '../src/ad-spend/model.js';
import {SpendWorker} from '../src/ad-spend/worker.js';
import type {CreativeReader} from '../src/creatives/model.js';
import {CreativeWorker} from '../src/creatives/worker.js';
import {saveCatalogue,saveInsights} from '../src/creatives/store.js';
import {repairThruPlays,thruPlayHealth,thruPlayLine} from '../src/creatives/thruplay-repair.js';
import {defaultSettings} from '../src/settings.js';
import {syncSourceHealth} from '../src/sources.js';
import {createTestDatabase} from './helpers/database.js';
import {creativeAd,creativeGroup,creativeInsight} from './helpers/creatives.js';

// Invented account, media and day counts only.
const now=new Date('2026-10-16T12:00:00Z'),days=['2026-10-14','2026-10-15','2026-10-16'];
const source=(overrides:Partial<CreativeReader>={}):CreativeReader=>({
 readCatalogue:async function*(){yield []},readInsights:async()=>[],imageBytes:async()=>new Uint8Array(),videoFrames:async()=>[],videoSource:async()=>'',
 readThruPlays:async(_,from,to)=>days.filter(day=>day>=from&&day<=to).map(day=>({adId:'invented-report-ad',day,plays:140,thruPlays:28,holdThreeSecondPlays:70})),...overrides,
});
async function setup(db:Awaited<ReturnType<typeof createTestDatabase>>,account:string){
 const settings={...defaultSettings(),metaAdAccountId:account,creativeDefaultWindow:'3d' as const};
 await saveCatalogue(db,account,[{ad:creativeAd('invented-report-ad','invented-report-video',{accountId:account}),media:{...creativeGroup('invented-report-video'),thumbnail:null,poster:null,frames:[]}}],now);
 await saveInsights(db,account,days[0]!,days[2]!,days.map(day=>creativeInsight('invented-report-ad',{day,plays:null,thruPlays:null})),now);
 await db.query('INSERT INTO pulse.creative_jobs(account_id,backfill_done,nightly_day) VALUES($1,true,$2)',[account,'2026-10-16']);
 return settings;
}
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done});return {resolve,promise};}

test('ThruPlay report counts distinct tried days across splitting and persists two filled plus one refusal',async t=>{
 const db=await createTestDatabase();t.after(()=>db.close());const account='invented-repair-report';await setup(db,account);
 t.mock.method(console,'error',()=>{});
 const success=source();
 await repairThruPlays(db,source({readThruPlays:async(account,from,to)=>{
  if(from<='2026-10-15'&&to>='2026-10-15')throw new AdError('http',400,2,1504044);
  return success.readThruPlays!(account,from,to);
 }}),account,now,'3d');
 const health=await thruPlayHealth(db,account,now,'3d');
 assert.deepEqual(health.lastRunReport,{tried:3,filled:2,refused:1,waiting:1,codes:[{code:'http 400, meta 2/1504044 at backfill',count:1}]});
 assert.equal(health.lastRunAt,now.toISOString());
 assert.match(thruPlayLine(health),/2 of 3 days complete; 1 day wait until 00:00 UK \(meta 1504044\).*3 days read, 2 filled, 1 refused, 1 waiting/);
 const saved=(await db.query('SELECT thruplay_run_report FROM pulse.creative_jobs WHERE account_id=$1',[account])).rows[0]!.thruplay_run_report;
 assert.deepEqual(saved,health.lastRunReport);
 assert.equal(await repairThruPlays(db,success,account,new Date('2026-10-16T12:05:00Z'),'3d',{onlyDue:true}),null);
 assert.deepEqual((await thruPlayHealth(db,account,now,'3d')).lastRunReport,saved,'a no-op tail preserves the report and honors the refused-day cooldown');
 await repairThruPlays(db,success,account,new Date('2026-10-16T12:10:00Z'),'3d');
 const idle=await thruPlayHealth(db,account,now,'3d');
 assert.deepEqual(idle.lastRunReport,{tried:0,filled:0,refused:0,waiting:1,codes:[]});
 assert.equal(idle.failures.length,1,'no due reads must not erase the outstanding refused day');
});

test('first startup tick runs reset video repair even when the persisted spend poll is too recent',async t=>{
 const db=await createTestDatabase();t.after(()=>db.close());const account='900000008101';const settings=await setup(db,account);
 const env={META_ACCESS_TOKEN:randomBytes(16).toString('hex')};await syncSourceHealth(db,env);
 await db.query('INSERT INTO pulse.settings(values) VALUES($1)',[JSON.stringify(settings)]);
 await db.query("INSERT INTO pulse.ad_spend_jobs(source,account_id,backfill_done,last_poll_at) VALUES('meta',$1,true,$2)",[account,new Date(now.getTime()-30_000)]);
 let money=0,insights=0,repairs=0,clock=now;const success=source();
 const worker=new SpendWorker(db,env,{clock:()=>clock,readers:{meta:{read:async()=>{money++;return []}}},creativeReader:source({
  readInsights:async()=>{insights++;return []},readThruPlays:async(...args)=>{repairs++;return success.readThruPlays!(...args)},
 })});t.after(()=>worker.stop());
 await worker.tick('meta');await worker.waitForThruPlayRepair();
 assert.equal(money,0);assert.equal(insights,0);assert.equal(repairs,1);
 assert.deepEqual((await thruPlayHealth(db,account,now,'3d')).lastRunReport,{tried:3,filled:3,refused:0,waiting:0,codes:[]});
 clock=new Date(now.getTime()+30_000);await worker.tick('meta');await worker.waitForThruPlayRepair();
 assert.equal(repairs,1,'repair keeps its own thirty-minute cadence');
});

test('video repair completes while the full insight step waits and retains its report when that step fails',async t=>{
 const db=await createTestDatabase();const release=deferred(),started=deferred();let worker:SpendWorker|undefined;
 t.after(async()=>{release.resolve();await worker?.stop();await db.close()});
 const account='900000008102',settings=await setup(db,account),env={META_ACCESS_TOKEN:randomBytes(16).toString('hex')};
 await syncSourceHealth(db,env);await db.query('INSERT INTO pulse.settings(values) VALUES($1)',[JSON.stringify(settings)]);
 await db.query("INSERT INTO pulse.ad_spend_jobs(source,account_id,backfill_done) VALUES('meta',$1,true)",[account]);
 t.mock.method(console,'error',()=>{});
 worker=new SpendWorker(db,env,{clock:()=>now,readers:{meta:{read:async()=>[]}},creativeReader:source({readInsights:async()=>{
  started.resolve();await release.promise;throw new AdError('timeout');
 }})});
 await worker.tick('meta');await started.promise;await worker.waitForThruPlayRepair();
 assert.deepEqual((await thruPlayHealth(db,account,now,'3d')).lastRunReport,{tried:3,filled:3,refused:0,waiting:0,codes:[]});
 release.resolve();await worker.waitForCreatives();
 assert.deepEqual((await thruPlayHealth(db,account,now,'3d')).lastRunReport,{tried:3,filled:3,refused:0,waiting:0,codes:[]},'the full-read tail must not run a duplicate repair');
 assert.equal((await db.query('SELECT insights_error FROM pulse.creative_jobs WHERE account_id=$1',[account])).rows[0]!.insights_error,'timeout at insights');
});

test('a slower full import with missing video counts receives a due-only repair after its save',async t=>{
 const db=await createTestDatabase();const release=deferred(),started=deferred();let worker:SpendWorker|undefined;
 t.after(async()=>{release.resolve();await worker?.stop();await db.close()});
 const account='900000008103',settings=await setup(db,account),env={META_ACCESS_TOKEN:randomBytes(16).toString('hex')};
 await syncSourceHealth(db,env);await db.query('INSERT INTO pulse.settings(values) VALUES($1)',[JSON.stringify(settings)]);
 await db.query("INSERT INTO pulse.ad_spend_jobs(source,account_id,backfill_done) VALUES('meta',$1,true)",[account]);
 const repairs:string[][]=[],success=source();
 worker=new SpendWorker(db,env,{clock:()=>now,readers:{meta:{read:async()=>[]}},creativeReader:source({
  readThruPlays:async(account,from,to)=>{repairs.push([from,to]);return success.readThruPlays!(account,from,to)},
  readInsights:async(_,from,to)=>{started.resolve();await release.promise;return days.filter(day=>day>=from&&day<=to).map(day=>creativeInsight('invented-report-ad',{day,plays:null,thruPlays:null}))},
 })});
 await worker.tick('meta');await started.promise;await worker.waitForThruPlayRepair();
 assert.equal((await thruPlayHealth(db,account,now,'3d')).completed,3);
 release.resolve();await worker.waitForCreatives();
 assert.deepEqual(repairs,[[days[0],days[2]],[days[1],days[2]]]);
 const health=await thruPlayHealth(db,account,now,'3d');
 assert.equal(health.completed,3);assert.deepEqual(health.lastRunReport,{tried:2,filled:2,refused:0,waiting:0,codes:[]});
});

test('video repair preserves an unmarked retry failure after the forward backfill already finished',async t=>{
 const db=await createTestDatabase();t.after(()=>db.close());const account='invented-finished-retry';const settings=await setup(db,account);
 t.mock.method(console,'error',()=>{});
 await db.query(`INSERT INTO pulse.creative_insight_days(account_id,day,completed,error_code,retry_after,fetched_at)
  VALUES($1,'2026-10-10',false,'http 400, meta 2/1504044 at backfill',$2,$2)`,[account,new Date('2026-10-15T23:00:00Z')]);
 const worker=new CreativeWorker(db,source({readInsights:async(_,from,to)=>{
  if(from==='2026-10-10'&&to===from)throw new AdError('timeout');return [];
 }}));
 await worker.runInsights(account,settings,now);
 assert.deepEqual((await db.query('SELECT backfill_done,error_code,insights_error FROM pulse.creative_jobs WHERE account_id=$1',[account])).rows[0],
  {backfill_done:true,error_code:'timeout at backfill',insights_error:'timeout at backfill'});
 assert.equal((await thruPlayHealth(db,account,now,'3d')).lastRunAt,now.toISOString(),'the independent repair ran without clearing the owner failure');
});
