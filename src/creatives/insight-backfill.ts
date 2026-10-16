import type {Database} from '../db.js';
import type {CreativeReader} from './model.js';
import {AdError, adErrorCode} from '../ad-spend/model.js';
import {addDays} from '../hero-range.js';
import {scanRetryAt} from './scan.js';
import {saveInsights} from './store.js';

const tooMuchData = (error: unknown) => error instanceof AdError && error.providerSubcode === 1504044;

/** A budget slot is one original chunk, including its smaller retries. */
export async function readInsightChunk(db: Database, reader: CreativeReader, account: string,
  from: string, to: string, now: Date, options: {advance?: boolean; markRefused?: boolean} = {}): Promise<void> {
  const cooling=(await db.query<{day:string}>(`SELECT day::text FROM pulse.creative_insight_days
    WHERE account_id=$1 AND day BETWEEN $2 AND $3 AND NOT completed AND error_code IS NOT NULL
      AND retry_after>$4 ORDER BY day`,[account,from,to,now])).rows;
  if(cooling.length){
    let start=from;
    for(const {day} of cooling){
      if(start<day) await readInsightChunk(db,reader,account,start,addDays(day,-1),now,options);
      // This refusal is already durable. Do not re-read it through a nightly overlap.
      if(options.advance) await db.query('UPDATE pulse.creative_jobs SET backfill_next=$2 WHERE account_id=$1',[account,addDays(day,1)]);
      start=addDays(day,1);
    }
    if(start<=to) await readInsightChunk(db,reader,account,start,to,now,options);
    return;
  }
  await db.query(`INSERT INTO pulse.creative_insight_days(account_id,day,fetched_at,completed)
    SELECT $1,day,$4,false FROM generate_series($2::date,$3::date,interval '1 day') day
    ON CONFLICT(account_id,day) DO UPDATE SET completed=false`, [account,from,to,now]);
  let rows;
  try {
    try { rows = await reader.readInsights(account,from,to); }
    catch (error) {
      if (!tooMuchData(error) || from !== to) throw error;
      // The hourly breakdown supports cursor paging. Halve its page size rather
      // than relying on unsupported hour-bucket filters or async insights POSTs.
      rows = await reader.readInsights(account,from,to,{hourlyLimit:250});
    }
  } catch (error) {
    if (!tooMuchData(error)) throw error;
    if (from !== to) {
      const days = Math.round((Date.parse(to)-Date.parse(from))/86_400_000)+1;
      const middle = addDays(from,Math.floor(days/2)-1);
      await readInsightChunk(db,reader,account,from,middle,now,options);
      await readInsightChunk(db,reader,account,addDays(middle,1),to,now,options);
      return;
    }
    if (!options.markRefused) throw error;
    await db.transaction(async tx => {
      await tx.query('SELECT pg_advisory_xact_lock(1668244582,hashtext($1))',[`live:${account}`]);
      await tx.query(`UPDATE pulse.creative_insight_days SET completed=false,error_code=$3,retry_after=$4
        WHERE account_id=$1 AND day=$2`,[account,from,adErrorCode(error,'meta'),scanRetryAt(now)]);
      if (options.advance) await tx.query('UPDATE pulse.creative_jobs SET backfill_next=$2 WHERE account_id=$1',[account,addDays(to,1)]);
    });
    return;
  }
  // Each successful subrange retains the existing atomic rows-and-cursor save.
  await saveInsights(db,account,from,to,rows,now,options.advance?addDays(to,1):undefined);
}
