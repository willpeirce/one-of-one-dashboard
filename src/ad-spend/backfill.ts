import type { Database } from '../db.js';
import { addDays, ukToday } from '../hero-range.js';
import type { Settings } from '../settings.js';
import type { SpendReader } from './clients.js';
import { AdError, adErrorCode } from './model.js';
import { readJobs, saveSpend } from './store.js';

/** Bounded history work; each successful window and its cursor commit together. */
export async function backfillMetaSpend(db: Database, reader: SpendReader, account: string, settings: Settings,
  pollAt: Date, intervalMs: number, clock: () => Date, closing: () => boolean): Promise<void> {
  const job = (await readJobs(db)).find(row => row.source === 'meta' && row.account_id === account)!;
  if (job.backfill_done) return;
  const due = new Date(pollAt.getTime() + intervalMs), last = addDays(ukToday(pollAt), -2);
  await db.query("UPDATE pulse.ad_spend_jobs SET backfill_next_run_at=$2 WHERE source='meta' AND account_id=$1", [account, due]);
  let cursor = job.backfill_next, span = job.backfill_window_days;
  const yieldToPoll = () => closing() || clock().getTime() >= due.getTime();
  try {
    for (let chunk = 0; chunk < 4 && cursor <= last && !yieldToPoll(); chunk++) {
      for (;;) {
        if (yieldToPoll()) return;
        const end = [addDays(cursor, span - 1), last].sort()[0]!;
        try {
          const rows = await reader.read(account, cursor, end, settings, pollAt);
          await saveSpend(db, 'meta', account, cursor, end, rows, pollAt, addDays(end, 1));
          cursor = addDays(end, 1); span = 14;
          await db.query("UPDATE pulse.ad_spend_jobs SET backfill_window_days=14,backfill_error=NULL WHERE source='meta' AND account_id=$1", [account]);
          break;
        } catch (error) {
          if (!(error instanceof AdError) || !(error.status === 500 || error.providerCode === 1) || span === 1) throw error;
          // The transport has already applied its retry/backoff policy to this request.
          span = Math.max(1, Math.floor(Math.min(span, Math.round((Date.parse(end)-Date.parse(cursor))/86400000)+1) / 2));
          await db.query("UPDATE pulse.ad_spend_jobs SET backfill_window_days=$2 WHERE source='meta' AND account_id=$1", [account, span]);
        }
      }
    }
    await db.query("UPDATE pulse.ad_spend_jobs SET backfill_done=backfill_next>$2::date,backfill_error=NULL WHERE source='meta' AND account_id=$1", [account, last]);
  } catch (error) {
    const code = adErrorCode(error, 'meta');
    await db.query("UPDATE pulse.ad_spend_jobs SET backfill_error=$2 WHERE source='meta' AND account_id=$1", [account, code]);
    console.error(`Meta spend backfill failed (${code}).`);
  }
}
