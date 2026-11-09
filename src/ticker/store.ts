import type { Database } from '../db.js';
import { readSettings } from '../settings.js';
import type { SourceMode } from '../sources.js';
import { sampleKeyDates, tickerEventKey, tickerState, type KeyDate, type PassedDate, type TickerSnapshot } from './model.js';

export class TickerNotFoundError extends Error {
  readonly statusCode = 404;
  constructor() { super('This date is no longer listed.'); }
}

async function dates(db: Database, mode: SourceMode, now: Date): Promise<KeyDate[]> {
  return mode === 'sample' ? sampleKeyDates(now) : (await readSettings(db, { seed: false })).values.keyDates;
}

async function passedDates(db: Database, mode: SourceMode): Promise<PassedDate[]> {
  return (await db.query<{ event_key: string; passed_at: Date | string }>(
    'SELECT event_key, passed_at FROM pulse.ticker_passed WHERE mode=$1 ORDER BY passed_at DESC, event_key', [mode])).rows;
}

export async function readTicker(db: Database, mode: SourceMode, now: Date): Promise<TickerSnapshot> {
  const rows = await dates(db, mode, now);
  return tickerState(rows, await passedDates(db, mode), now, mode);
}

/** Every press changes only local state and its audit, together on one transaction client. */
export async function changeTicker(db: Database, mode: SourceMode, eventKey: string, action: 'next' | 'restore', credentialId: string, now: Date): Promise<TickerSnapshot> {
  return db.transaction(async tx => {
    const rows = await dates(tx, mode, now);
    const row = rows.find(item => tickerEventKey(item) === eventKey);
    if (!row) throw new TickerNotFoundError();
    if (action === 'next') {
      await tx.query(`INSERT INTO pulse.ticker_passed(mode,event_key,passed_at,credential_id) VALUES($1,$2,$3,$4)
        ON CONFLICT(mode,event_key) DO NOTHING`, [mode, eventKey, now, credentialId]);
    } else await tx.query('DELETE FROM pulse.ticker_passed WHERE mode=$1 AND event_key=$2', [mode, eventKey]);
    const event = `Next up ${action === 'next' ? 'passed' : 'put back'}: ${row.name}`;
    await tx.query('INSERT INTO pulse.audit_log(event,credential_id,occurred_at) VALUES($1,$2,$3)',
      [Array.from(event).slice(0, 80).join(''), credentialId, now]);
    return tickerState(rows, await passedDates(tx, mode), now, mode);
  });
}
