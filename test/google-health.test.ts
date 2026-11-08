import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { googleHealth, reconcileGoogleSpend } from '../src/google-ads/health.js';
import { googleConversionDays, googleJobKinds, type GoogleFacts } from '../src/google-ads/model.js';
import { parseGoogleDaily, parseGoogleHours } from '../src/google-ads/parsers.js';

const now=new Date('2026-10-27T00:30:00Z');
const from='2026-10-20',to='2026-10-26';
async function facts():Promise<GoogleFacts>{
  const fixture=async(name:string)=>(JSON.parse(await readFile(new URL(`./fixtures/google-ads/${name}.json`,import.meta.url),'utf8')) as {results:unknown[]}[]).flatMap(chunk=>chunk.results);
  return {mode:'live',accountId:'9900000000',currency:'GBP',campaigns:[],networks:[],changes:[],conversions:[],
    hours:parseGoogleHours(await fixture('audit-hours')),daily:parseGoogleDaily(await fixture('audit-daily'),from,to),
    jobs:googleJobKinds.map(kind=>({kind,lastAttemptAt:now.toISOString(),lastSuccessAt:now.toISOString(),error:null,failures:0,
      coverage:{from,to,basis:'gmt'},currency:'GBP'})),quota:{day:'2026-10-27',operations:17,historyOperations:2,limit:200,error:null}};
}

test('API-shaped invented GMT hourly sums reproduce all seven daily figures to the penny across 25 Oct',async()=>{
  const input=await facts(),audit=reconcileGoogleSpend(input,now);
  assert.equal(audit.from,from);assert.equal(audit.to,to);assert.equal(audit.days.length,7);
  assert.ok(audit.days.every(day=>day.status==='match'&&day.differenceMicros==='0'));
  assert.deepEqual(audit.days.map(day=>day.hoursMicros),['4000000','16000000','0','10000000','4500011','12499989','5000000']);
  assert.equal(audit.total.hoursMicros,'52000000');assert.equal(audit.total.dailyMicros,'52000000');
  const health=googleHealth(input,now);
  assert.equal(health.audit.length,8);
  assert.match(health.audit.at(-1)!,/7 GMT days 2026-10-20–2026-10-26 · hours summed GBP 52\.00 · Google daily GBP 52\.00/);
  assert.match(health.audit.at(-1)!,/hours minus Google daily: GBP 0\.00 · match/);
  assert.match(health.line,/lag about 3 hours/);
  // UK rebucketing changes the midnight-adjacent dates; it must not feed this GMT audit.
  const uk25=googleConversionDays(input.hours).filter(row=>row.day==='2026-10-25').reduce((sum,row)=>sum+BigInt(row.spendMicros),0n);
  assert.equal(uk25,17000000n);assert.notEqual(String(uk25),audit.days.find(day=>day.day==='2026-10-25')!.hoursMicros);
});

test('a broken daily fixture names both the day and signed hours-minus-daily difference, including subpenny mismatches',async()=>{
  const input=await facts();input.daily.find(day=>day.day==='2026-10-24')!.spendMicros='4510011';
  let view=googleHealth(input,now),broken=view.reconciliation.days.find(day=>day.day==='2026-10-24')!;
  assert.equal(broken.status,'difference');assert.equal(broken.differenceMicros,'-10000');
  assert.match(view.audit.find(line=>line.startsWith('GMT 2026-10-24'))!,/hours minus Google daily: −GBP 0\.010000 · difference/);
  assert.equal(view.reconciliation.total.differenceMicros,'-10000');
  input.daily.find(day=>day.day==='2026-10-24')!.spendMicros='4500010';view=googleHealth(input,now);
  assert.match(view.audit.find(line=>line.startsWith('GMT 2026-10-24'))!,/hours minus Google daily: \+GBP 0\.000001 · difference/);
});

test('successful empty reads mean zero, while missing or non-GMT coverage never does',async()=>{
  const input=await facts();input.hours=[];input.daily=parseGoogleDaily([],from,to);
  assert.ok(reconcileGoogleSpend(input,now).days.every(day=>day.status==='match'&&day.hoursMicros==='0'&&day.dailyMicros==='0'));
  const hours=input.jobs.find(job=>job.kind==='conversions')!;hours.coverage={from:'2026-10-21',to,basis:'gmt'};
  let audit=reconcileGoogleSpend(input,now);assert.equal(audit.days[0]!.hoursMicros,null);assert.equal(audit.total.hoursMicros,null);
  assert.match(googleHealth(input,now).audit[0]!,/hours summed not read/);
  hours.coverage={from,to,basis:'uk'};audit=reconcileGoogleSpend(input,now);assert.ok(audit.days.every(day=>day.hoursMicros===null));
  hours.coverage={from,to,basis:'gmt'};hours.lastSuccessAt=null;
  assert.ok(reconcileGoogleSpend(input,now).days.every(day=>day.hoursMicros===null));
  input.jobs=input.jobs.filter(job=>job.kind!=='daily');
  assert.equal(reconcileGoogleSpend(input,now).total.dailyMicros,null);assert.match(googleHealth(input,now).line,/waiting for scheduled reads/);
});

test('midnight does not turn a cached partial GMT day into complete hourly coverage', async () => {
  const input = await facts();
  const hours = input.jobs.find(job => job.kind === 'conversions')!;
  hours.lastSuccessAt = '2026-10-26T12:00:00Z';
  hours.coverage = {from, to: '2026-10-26', basis: 'gmt'};
  hours.error = 'timeout';
  const audit = reconcileGoogleSpend(input, now);
  assert.equal(audit.days.at(-1)!.day, '2026-10-26');
  assert.equal(audit.days.at(-1)!.hoursMicros, null);
  assert.equal(audit.days.at(-1)!.dailyMicros, '5000000');
  assert.equal(audit.days.at(-1)!.status, 'missing');
  assert.equal(audit.total.differenceMicros, null);
});

test('currency mismatches and missing currency stay separate instead of producing a comparison',async()=>{
  const input=await facts(),daily=input.jobs.find(job=>job.kind==='daily')!;daily.currency='USD';
  let view=googleHealth(input,now);
  assert.ok(view.reconciliation.days.every(day=>day.status==='currency_mismatch'&&day.differenceMicros===null));
  assert.match(view.audit[0]!,/hours summed GBP 4\.00 · Google daily USD 4\.00/);assert.match(view.audit[0]!,/not compared; currencies differ/);
  assert.equal(view.reconciliation.total.differenceMicros,null);
  daily.currency=null;view=googleHealth(input,now);assert.match(view.audit[0]!,/not compared; currency unavailable/);
});

test('the last seven complete GMT dates exclude the current GMT day even when the UK date has advanced',async()=>{
  const input=await facts();const audit=reconcileGoogleSpend(input,new Date('2026-10-24T23:30:00Z'));
  assert.equal(audit.from,'2026-10-17');assert.equal(audit.to,'2026-10-23');
  assert.ok(audit.days.every(day=>day.day<'2026-10-24'));
  assert.equal(reconcileGoogleSpend(input,new Date('2026-10-25T00:30:00Z')).to,'2026-10-24');
});

test('integer micros preserve large totals and round once, after summing',async()=>{
  const input=await facts();const large='9007199254740991';
  input.hours=[{campaignId:'990000000301',day:from,hour:0,spendMicros:large,conversionValueMicros:'0',conversions:0},
    {campaignId:'990000000302',day:from,hour:1,spendMicros:'6000',conversionValueMicros:'0',conversions:0}];
  input.daily=parseGoogleDaily([{segments:{date:from},metrics:{costMicros:String(BigInt(large)+6000n)}}],from,to);
  const view=googleHealth(input,now);
  assert.equal(view.reconciliation.total.hoursMicros,'9007199254746991');
  assert.match(view.audit.at(-1)!,/hours summed GBP 9007199254\.75 · Google daily GBP 9007199254\.75/);
});

test('quota or one job failure remains visible without throwing away successful stored reconciliation',async()=>{
  const input=await facts();input.jobs.find(job=>job.kind==='conversions')!.error='rate_limit';input.quota.error='daily_cap';input.quota.operations=200;
  const view=googleHealth(input,now);
  assert.match(view.line,/reads paused by the operation budget/);assert.match(view.quota,/200 of 200.*paused \(daily_cap\)/);
  assert.ok(view.jobs.some(line=>/Conversions and GMT hours:.*read failed \(rate_limit\); stored data retained/.test(line)));
  assert.equal(view.reconciliation.total.status,'match');
  input.mode='sample';assert.match(googleHealth(input,now).line,/sample data · waiting for keys/);
});
