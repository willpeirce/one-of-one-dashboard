import { addDays, dayCount, spikeMarkets, ukToday } from '../hero-range.js';
import { HQ_TRUNCATED_STATUS_MARKER, hqDate, type HQReading, type HQReadingArm, type HQStoredTestRow, type HQTestAssessment } from './model.js';

const number='-?\\d+(?:\\.\\d+)?';
const value=`(?:£${number}|${number}%?)`;
const protocol=new RegExp(`\\bReading[ \\t]+(\\d{4}-\\d{2}-\\d{2}):[ \\t]+A[ \\t]+(${value})[ \\t]+n=(\\d+);[ \\t]+B[ \\t]+(${value})[ \\t]+n=(\\d+);[ \\t]+ahead[ \\t]+(A|B|none);[ \\t]+sure[ \\t]+(\\d+(?:\\.\\d+)?)%;[ \\t]+mornings[ \\t]+([0-9])(?![\\d]|\\.\\d)(?=$|[\\s.;<])`,'g');

/** One complete protocol may sit inside Status prose; partial or ambiguous readings stay unknown. */
export function strictReading(status: string): HQReading | null {
  if (status.includes(HQ_TRUNCATED_STATUS_MARKER)) return null;
  const starts=status.match(/\bReading[ \t]+\d{4}-\d{2}-\d{2}/g) ?? [];
  const matches=[...status.matchAll(protocol)];
  if (starts.length!==1 || matches.length!==1) return null;
  const row=matches[0]!, day=row[1]!, sure=Number(row[7]), mornings=Number(row[8]);
  if (!hqDate(day) || !Number.isFinite(sure) || sure<0 || sure>100) return null;
  const arm=(key:'a'|'b',formatted:string,rawCount:string):HQReadingArm|null=>{
    const amount=Number(formatted.replace(/^£|%$/g,'')),count=Number(rawCount);
    if (!Number.isFinite(amount) || !Number.isSafeInteger(count) || count<0) return null;
    return {key,value:amount,formatted,count,unit:formatted.startsWith('£')?'£':formatted.endsWith('%')?'%':''};
  };
  const a=arm('a',row[2]!,row[3]!),b=arm('b',row[4]!,row[5]!);
  return a && b ? {day,arms:[a,b],ahead:row[6]==='none'?null:row[6]==='A'?'a':'b',sure,mornings} : null;
}

/** Assess only a supplied register reading; this function never measures a test. */
export function readTest(row: HQStoredTestRow, now: Date): HQTestAssessment {
  const today=ukToday(now), status=row.section==='live'?row.cells[8] ?? '':'';
  const date=/^(\d{4}-\d{2}-\d{2})(?=$|[\s(])/.exec(row.section==='live'?row.cells[5] ?? '':'')?.[1];
  const startedDay=date && hqDate(date)?date:null;
  const daysRun=startedDay?Math.max(0,dayCount(startedDay,today)-1):null;
  const reading=row.section==='live'?strictReading(status):null,reasons:string[]=[];
  let answer:HQTestAssessment['answer']=null,verdictUntilDay:string|null=null;
  if (row.section==='live') {
    if (!reading) reasons.push('No well-formed reading is available.');
    else {
      if (reading.day!==today && reading.day!==addDays(today,-1)) reasons.push('The reading must be from today or yesterday in the UK.');
      if (reading.sure<95) reasons.push('The reading has not reached 95% sure.');
      if (reading.mornings<2) reasons.push('The reading needs at least two mornings.');
      if (reading.arms.some(arm=>arm.count<30)) reasons.push('Each arm needs at least 30 counted events.');
      if (!startedDay || dayCount(startedDay,reading.day)-1<7) reasons.push('At least seven full UK days must pass before the reading.');
      if (spikeMarkets(reading.day).length) reasons.push('The reading falls on a spike day.');
      if (reading.ahead===null) reasons.push('Neither arm is ahead.');
    }
    if (/capped[ \t]+at[ \t]+Leaning/i.test(status)) reasons.push('This test is capped at Leaning.');
    if (reading && reasons.length===0) answer=reading.ahead;
    else if (daysRun!==null && daysRun>=28) answer='draw';
  } else reasons.push('Only Live tests can be called.');
  if (row.section==='history' && !row.initiallySeen) {
    const firstSeen=new Date(row.sectionFirstSeenAt);
    if (Number.isFinite(firstSeen.getTime())) {
      const firstDay=ukToday(firstSeen),until=addDays(firstDay,3);
      if (firstDay<=today && today<until) verdictUntilDay=until;
    }
  }
  return {reading,startedDay,daysRun,answer,reasons,verdictUntilDay};
}
