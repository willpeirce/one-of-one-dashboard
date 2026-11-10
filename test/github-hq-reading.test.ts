import assert from 'node:assert/strict';
import test from 'node:test';
import { addDays } from '../src/hero-range.js';
import { readTest, strictReading } from '../src/github-hq/reading.js';
import type { HQStoredTestRow } from '../src/github-hq/model.js';

const now=new Date('2032-04-20T10:00:00Z');
const status='Reading 2032-04-20: A 12% n=40; B 17% n=43; ahead B; sure 96%; mornings 2';
function row(overrides:Partial<HQStoredTestRow>={}):HQStoredTestRow {
  return {id:'T1',section:'live',cells:['T1 Invented button','Site','Invented question','A: one; B: two','Invented bar',
    '2032-04-10 (invented start)','Waiting','Invented report',status],
  firstSeenAt:'2032-04-10T10:00:00Z',sectionFirstSeenAt:'2032-04-10T10:00:00Z',initiallySeen:false,...overrides};
}
function readingRow(value:string,started='2032-04-10'):HQStoredTestRow {
  const result=row();result.cells[8]=value;result.cells[5]=started;return result;
}

test('strict readings accept numeric, pound and percent arms inside prose and preserve the supplied counts and confidence',()=>{
  const reading=strictReading(`Invented context. ${status}. Continue observing.`)!;
  assert.equal(reading.day,'2032-04-20');assert.equal(reading.ahead,'b');assert.equal(reading.sure,96);assert.equal(reading.mornings,2);
  assert.deepEqual(reading.arms,[{key:'a',value:12,formatted:'12%',count:40,unit:'%'},{key:'b',value:17,formatted:'17%',count:43,unit:'%'}]);
  const money=strictReading(status.replace('12%','£-2.50').replace('17%','£3.75'))!;
  assert.equal(money.arms[0].value,-2.5);assert.equal(money.arms[0].unit,'£');
  assert.equal(strictReading(status.replace('12%','123456.75').replace('17%','123460'))!.arms[0].unit,'');
  assert.equal(strictReading(status.replace('sure 96%','sure 95.5%'))!.sure,95.5);
  assert.equal(strictReading(status.replace('ahead B','ahead none'))!.ahead,null);
});

test('partial, ambiguous, impossible and out-of-range reading fields remain unknown',()=>{
  for (const malformed of [
    status.replace('2032-04-20','2032-02-30'),status.replace('12%','£12%'),status.replace('12%','NaN'),
    status.replace('12%','1e3'),status.replace('12%','1,000'),status.replace('n=40','n=-1'),
    status.replace('n=40','n=3.5'),status.replace('n=40','n=9007199254740992'),
    status.replace('ahead B','ahead C'),status.replace('sure 96%','sure 101%'),
    status.replace('sure 96%','sure -1%'),status.replace('mornings 2','mornings 10'),
    status.replace('mornings 2','mornings 2.5'),status.replace('mornings 2','mornings many'),
    status.replace('; B',' B'),`${status}\n${status}`,status.slice(0,-1),
  ]) assert.equal(strictReading(malformed),null,malformed);
});

test('A/B Call requires every supplied stopping condition independently',()=>{
  assert.equal(readTest(row(),now).answer,'b');
  assert.equal(readTest(readingRow(status.replace('ahead B','ahead A')),now).answer,'a');
  assert.equal(readTest(readingRow(status.replace('2032-04-20','2032-04-19')),now).answer,'b');
  assert.equal(readTest(readingRow(status.replace('sure 96%','sure 95%').replace('n=40','n=30').replace('n=43','n=30'),'2032-04-13'),now).answer,'b');
  const refused=[
    readingRow('No reading'),readingRow(status.replace('2032-04-20','2032-04-18')),
    readingRow(status.replace('2032-04-20','2032-04-21')),readingRow(status.replace('sure 96%','sure 94.99%')),
    readingRow(status.replace('mornings 2','mornings 1')),readingRow(status.replace('n=40','n=29')),
    readingRow(status.replace('n=43','n=29')),readingRow(status,'2032-04-14'),readingRow(status,'unknown'),
    readingRow(status.replace('ahead B','ahead none')),readingRow(`${status}. cApPeD At lEaNiNg`),
  ];
  for (const value of refused) {const check=readTest(value,now);assert.equal(check.answer,null);assert.ok(check.reasons.length);}
  assert.equal(readTest(row({section:'queue'}),now).answer,null);
});

test('Call reuses the shared spike calendar for either market, including the end of a month',()=>{
  for (const day of ['2032-04-24','2032-04-25','2032-04-26','2032-05-01','2032-05-15','2032-04-29','2032-04-30']) {
    const value=readingRow(status.replaceAll('2032-04-20',day),addDays(day,-10));
    const assessment=readTest(value,new Date(`${day}T10:00:00Z`));
    assert.equal(assessment.answer,null,day);assert.ok(assessment.reasons.includes('The reading falls on a spike day.'));
  }
});

test('UK-day freshness crosses summer and winter midnight independently of the host timezone',()=>{
  for (const [day,before,after] of [
    ['2032-06-19','2032-06-20T22:59:00Z','2032-06-20T23:01:00Z'],
    ['2032-12-19','2032-12-20T23:59:00Z','2032-12-21T00:01:00Z'],
  ]) {
    const value=readingRow(status.replace('2032-04-20',day!),addDays(day!,-10));
    assert.equal(readTest(value,new Date(before!)).answer,'b');
    assert.equal(readTest(value,new Date(after!)).answer,null);
  }
});

test('day 28 offers a draw without inventing a measurement; an eligible A/B answer still wins',()=>{
  const at27=readingRow('No reading',addDays('2032-04-20',-27));
  assert.equal(readTest(at27,now).answer,null);
  const at28=readingRow('No reading',addDays('2032-04-20',-28));
  const draw=readTest(at28,now);assert.equal(draw.answer,'draw');assert.equal(draw.daysRun,28);assert.equal(draw.reading,null);
  at28.cells[8]=status;assert.equal(readTest(at28,now).answer,'b');
  at28.cells[8]=`${status}. Capped at Leaning`;assert.equal(readTest(at28,now).answer,'draw');
  assert.equal(readTest({...at28,section:'history'},now).answer,null);
});

test('new verdicts use three UK calendar days since entry into History and exclude the initial register baseline',()=>{
  const history=row({section:'history',cells:['H1 Invented test','Question','Draw','Rule','Evidence'],
    firstSeenAt:'2032-02-10T12:00:00Z',sectionFirstSeenAt:'2032-04-18T23:30:00Z'});
  assert.equal(readTest(history,new Date('2032-04-19T10:00:00Z')).verdictUntilDay,'2032-04-22');
  assert.equal(readTest(history,new Date('2032-04-21T10:00:00Z')).verdictUntilDay,'2032-04-22');
  assert.equal(readTest(history,new Date('2032-04-22T00:00:00Z')).verdictUntilDay,null);
  assert.equal(readTest({...history,initiallySeen:true},now).verdictUntilDay,null);
  assert.equal(readTest({...history,sectionFirstSeenAt:'2032-04-21T10:00:00Z'},now).verdictUntilDay,null);
  assert.equal(readTest({...history,sectionFirstSeenAt:'invalid'},now).verdictUntilDay,null);
});
