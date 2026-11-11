import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { Database } from '../src/db.js';
import type { SourceMode } from '../src/sources.js';
import { fulfilmentOverview, fulfilmentSummary } from '../src/fulfilment/store.js';
import { fulfilmentNeeds, glance } from '../src/fulfilment/view.js';
import { createTestDatabase } from './helpers/database.js';

// Every date, order number, charge and label here is invented.
const now = new Date('2036-06-04T10:00:00Z');
async function upload(db: Database, mode: SourceMode, at: string, coverageFrom: string | null = null, coverageTo: string | null = null) {
  const id = randomUUID();
  await db.query(`INSERT INTO pulse.fulfilment_uploads(id,mode,source_id,file_name,row_count,saved_count,despatch_from,despatch_to,
    uploaded_at,gbp_per_usd,error_pence,error_count,changes,coverage_from,coverage_to)
    VALUES($1::uuid,$2,$1::text,'invented-overview.csv',12,12,'2036-05-01 00:00:00','2036-05-31 23:59:59',$3,0.29,17,2,$4,$5,$6)`,
  [id,mode,at,JSON.stringify(['Invented rate observation']),coverageFrom,coverageTo]);
  return id;
}
async function parcel(db: Database, mode: SourceMode, uploadId: string, index: number, options: {
  at: string; warehouse?: 'uk' | 'us' | 'unknown'; amount?: number; pickPack?: number; rate?: number;
  service?: string; centre?: string; flags?: string[];
}) {
  const warehouse = options.warehouse ?? 'uk', currency = warehouse === 'unknown' ? null : warehouse === 'uk' ? 'GBP' : 'USD';
  const result = await db.query<{id:string}>(`INSERT INTO pulse.fulfilment_parcels(mode,source_id,fetched_at,order_number,order_id,
    despatched_at,warehouse,centre,service,carrier,country,boxed_grams,currency,postage_minor,pick_pack_minor,
    customer_paid_pence,gbp_per_usd,upload_id,replaced_estimate_pence,rate_baseline_pence,flags)
    VALUES($1,$2,$3,$2,NULL,$4,$5,$6,$7,'Invented Carrier','Invented Destination',320,$8,$9,$10,0,$11,$12,NULL,NULL,$13)
    RETURNING id`, [mode,String(980000 + index),now,options.at,warehouse,options.centre ?? 'Invented Centre',
    options.service ?? 'Invented Service',currency,options.amount ?? 200,options.pickPack ?? 0,options.rate ?? 0.29,uploadId,JSON.stringify(options.flags ?? [])]);
  return String(result.rows[0]!.id);
}
async function sameOverview(db: Database, mode: SourceMode, at = now) {
  const [full, compact] = await Promise.all([fulfilmentSummary(db,mode,at),fulfilmentOverview(db,mode,at)]);
  const {averages,lastUpload,needs} = full;
  assert.deepEqual(compact,{mode,averages,lastUpload,needs});
  assert.equal(glance(compact),glance(full));
  assert.equal(fulfilmentNeeds(compact),fulfilmentNeeds(full));
  assert.deepEqual(Object.keys(compact).sort(),['averages','lastUpload','mode','needs']);
  return {full,compact};
}

test('empty compact fulfilment preserves both labelled modes and Home markup', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  for (const mode of ['sample','live'] as const) {
    const {compact} = await sameOverview(db,mode);
    assert.equal(compact.lastUpload,null);
    assert.ok(compact.averages.every(row=>row.count===0&&row.gbpPence===null&&row.exportedMinor===null));
  }
});

test('compact fulfilment keeps UK month boundaries, invoice rounding and ordered historical flags without full detail reads', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  for (const mode of ['sample','live'] as const) {
    const firstUpload = await upload(db,mode,'2036-06-01T07:00:00Z','2036-05-01','2036-05-31');
    await upload(db,mode,'2036-06-03T11:00:00Z');
    await parcel(db,mode,firstUpload,1,{at:'2036-05-31 23:59:59',amount:9900});
    await parcel(db,mode,firstUpload,2,{at:'2036-06-01 00:00:00',amount:300,pickPack:50});
    await parcel(db,mode,firstUpload,3,{at:'2036-07-01 00:00:00',amount:9900});
    await parcel(db,mode,firstUpload,4,{at:'2036-05-31 18:59:59',warehouse:'us',amount:9900});
    await parcel(db,mode,firstUpload,5,{at:'2036-05-31 19:00:00',warehouse:'us',amount:50,rate:0.29});
    await parcel(db,mode,firstUpload,6,{at:'2036-06-30 18:59:59',warehouse:'us',amount:500,rate:0.754});
    await parcel(db,mode,firstUpload,7,{at:'2036-06-30 19:00:00',warehouse:'us',amount:9900});
    // The import refuses credits, but preserve the established result for a stored negative charge too.
    await parcel(db,mode,firstUpload,8,{at:'2036-06-02 12:00:00',warehouse:'us',amount:-51,rate:0.29});
    const early = await parcel(db,mode,firstUpload,9,{at:'2034-04-12 12:00:00',warehouse:'unknown',
      centre:'Invented West',service:'Invented Amber',flags:['Unknown service','Unknown fulfilment centre','Wrong warehouse for destination']});
    const middle = await parcel(db,mode,firstUpload,10,{at:'2036-06-02 12:00:00',warehouse:'unknown',
      centre:'Invented West',service:'Invented Amber',flags:['Unknown service','Unknown fulfilment centre','Invented review flag']});
    await parcel(db,mode,firstUpload,11,{at:'2036-06-03 12:00:00',warehouse:'unknown',
      centre:'Invented East',service:'Invented Blue',flags:['Unknown fulfilment centre','Unknown service']});
    const {full,compact} = await sameOverview(db,mode);
    assert.equal(compact.lastUpload!.uploadedAt,'2036-06-03T11:00:00.000Z');
    assert.deepEqual(compact.averages, [
      {warehouse:'uk',count:1,currency:'GBP',exportedMinor:350,gbpPence:350},
      {warehouse:'us',count:3,currency:'USD',exportedMinor:499/3,gbpPence:376/3},
    ]);
    assert.equal(Math.round(50*0.29),14,'The fixture pins the JS rounding boundary');
    assert.deepEqual(compact.needs.map(row=>row.id),[
      `parcel:${early}:Wrong warehouse for destination`, `parcel:${middle}:Invented review flag`,
      'unknown:["Unknown service","Invented Amber"]', 'unknown:["Unknown fulfilment centre","Invented West"]',
      'unknown:["Unknown fulfilment centre","Invented East"]', 'unknown:["Unknown service","Invented Blue"]',
    ]);
    assert.match(compact.needs[2]!.why,/2 parcels/);
    assert.equal(full.unmatched.length,11); assert.equal(full.recent.length,11);
    assert.ok('model' in full && 'orderCount' in full,'Detail still has its complete data');
  }
  const reads: {sql:string;fields:string[]}[] = [];
  const observed: Database = { ...db, async query<Row extends Record<string,unknown>>(sql:string,values?:unknown[]) {
    assert.match(sql.trim(),/^SELECT\b/);
    assert.doesNotMatch(sql,/SELECT\s+\*|fulfilment_models|shopify_records/);
    const result = await db.query<Row>(sql,values);
    reads.push({sql,fields:Object.keys(result.rows[0]??{}).sort()});
    return result;
  }};
  await fulfilmentOverview(observed,'live',now);
  const parcelReads=reads.filter(read=>read.sql.includes('FROM pulse.fulfilment_parcels'));
  assert.equal(parcelReads.length,2);
  assert.deepEqual(parcelReads.map(read=>read.fields).sort((a,b)=>a.join().localeCompare(b.join())),[
    ['centre','flags','id','order_number','service'],
    ['currency','gbp_per_usd','pick_pack_minor','postage_minor','warehouse'],
  ]);
});

test('compact monthly coverage accepts split complete ranges, ignores unrelated ranges and exposes gaps', async t => {
  const db=await createTestDatabase(); t.after(()=>db.close());
  await upload(db,'live','2036-06-01T07:00:00Z','2036-04-01','2036-05-15');
  const second=await upload(db,'live','2036-06-02T07:00:00Z','2036-05-16','2036-06-02');
  await upload(db,'live','2036-06-03T07:00:00Z','2035-01-01','2035-02-01');
  await upload(db,'live','2036-06-04T07:00:00Z','2036-07-01','2036-07-31');
  assert.equal((await sameOverview(db,'live')).compact.needs.some(row=>row.id==='jj-monthly'),false);
  await db.query('UPDATE pulse.fulfilment_uploads SET coverage_from=$2 WHERE id=$1',[second,'2036-05-17']);
  assert.equal((await sameOverview(db,'live')).compact.needs[0]?.id,'jj-monthly');
  assert.equal((await sameOverview(db,'live',new Date('2036-06-01T07:59:59Z'))).compact.needs.some(row=>row.id==='jj-monthly'),false);
});

test('US autumn month-end uses the changed UK offset and sample rows do not enter the live overview', async t => {
  const db=await createTestDatabase(); t.after(()=>db.close());
  const id=await upload(db,'live','2036-11-03T08:00:00Z');
  await parcel(db,'live',id,1,{at:'2036-10-31 19:59:59',warehouse:'us',amount:9900});
  await parcel(db,'live',id,2,{at:'2036-10-31 20:00:00',warehouse:'us',amount:100,rate:0.31});
  const sampleId=await upload(db,'sample','2036-11-03T08:00:00Z');
  await parcel(db,'sample',sampleId,3,{at:'2036-11-02 12:00:00',warehouse:'us',amount:9900});
  const {compact}=await sameOverview(db,'live',new Date('2036-11-04T10:00:00Z'));
  assert.equal(compact.averages[1]!.count,1);
  assert.equal(compact.averages[1]!.gbpPence,31);
  assert.equal((await sameOverview(db,'sample',new Date('2036-11-04T10:00:00Z'))).compact.averages[1]!.count,1);
});
