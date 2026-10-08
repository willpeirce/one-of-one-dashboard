import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { ShopifyWorker } from '../src/shopify/worker.js';
import { createApp } from '../src/app.js';
import { readRuntime } from '../src/runtime.js';
import { createTestDatabase } from './helpers/database.js';

const config=readRuntime({NODE_ENV:'test',DATABASE_URL:'postgresql://localhost/pulse_test',APP_ORIGIN:'http://localhost:3000'});

test('createApp and listen finish while the single background rebuild is blocked; failure leaves health working',async t=>{
  const db=await createTestDatabase();
  let release!:()=>void;
  const blocked=new Promise<void>(resolve=>{release=resolve;});
  let failRebuild=false;
  let reads=0,started!:()=>void;
  const entered=new Promise<void>(resolve=>{started=resolve;});
  const wrapped={...db,query:async <Row extends Record<string,unknown>>(text:string,values?:unknown[])=>{
    if (text==='SELECT DISTINCT mode FROM pulse.fulfilment_parcels') {
      reads++;started();await blocked;failRebuild=true;
      return {rows:[{mode:'live'}] as unknown as Row[],rowCount:1};
    }
    return db.query<Row>(text,values);
  },transaction:async <T>(fn:(tx:typeof db)=>Promise<T>):Promise<T>=>{
    if (failRebuild) throw Object.assign(new Error('invented-private-error'),{code:'XX000'});
    return db.transaction(fn);
  }};
  // Live mode avoids sample seeding and any real source calls (worker stays stopped).
  const env={SHOPIFY_CLIENT_ID:randomBytes(16).toString('hex'),SHOPIFY_CLIENT_SECRET:randomBytes(32).toString('hex')};
  t.mock.method(ShopifyWorker.prototype,'start',()=>{});
  const app=await createApp(wrapped,config,env);
  t.after(async()=>{release();await app.close();await db.close();});
  assert.equal(reads,0,'createApp must not start the rebuild');
  await app.listen({host:'127.0.0.1',port:0});
  const logs:string[]=[];
  t.mock.method(console,'error',(message:string)=>logs.push(message));
  const run=app.startBackgroundWork();
  assert.equal(app.startBackgroundWork(),run);
  await entered;
  assert.equal((await app.inject('/health')).statusCode,200);
  release();await run;
  assert.equal(reads,1);
  assert.deepEqual(logs,['Startup fulfilment rebuild failed (code: XX000).']);
  assert.deepEqual((await app.inject('/health')).json(),{status:'ok'});
});
