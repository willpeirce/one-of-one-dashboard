import {createHash} from 'node:crypto';
import type {Database} from '../db.js';
import type {SourceMode} from '../sources.js';
import {ukToday} from '../hero-range.js';
import type {HQWaitingResult} from '../github-hq/parse-waiting.js';
import {WAITING_FILE_ROW_LIMIT, WaitingValidationError, validateWaitingInput,
  waitingDays, waitingDoneUntil, type WaitingInput, type WaitingItem, type WaitingView} from './model.js';

const iso = (value: string | Date): string => new Date(value).toISOString();
export function waitingIdentity(source: 'hq' | 'manual', row: WaitingInput): string {
  return `${source}:${createHash('sha256').update(JSON.stringify([row.contact.trim(), row.subject.trim(), row.since])).digest('hex')}`;
}
async function lock(db: Database): Promise<void> {
  await db.query('SELECT pg_advisory_xact_lock(1668244583,hashtext($1))', ['waiting-on']);
}
async function pruneDone(db: Database, now: Date): Promise<void> {
  await db.query("DELETE FROM pulse.waiting_on_done WHERE (done_at AT TIME ZONE 'Europe/London')::date + 30 <= $1::date", [ukToday(now)]);
}

/** A null result is an authoritative missing file. Failed reads never call this function. */
export async function replaceWaitingFile(db: Database, result: HQWaitingResult | null, now: Date): Promise<void> {
  if (result && !result.readable) throw new WaitingValidationError('The waiting file could not be read.');
  const rows = (result?.rows ?? []).slice(0, WAITING_FILE_ROW_LIMIT);
  await db.transaction(async tx => {
    await lock(tx); await pruneDone(tx, now);
    const ids: string[] = [];
    for (const row of rows) {
      // Defend storage even when called independently of the parser. Future source dates
      // remain readable and show zero days; only manual entries must already have started.
      const valid = validateWaitingInput(row, row.since > ukToday(now) ? new Date(`${row.since}T12:00:00Z`) : now);
      const id = waitingIdentity('hq', valid); ids.push(id);
      await tx.query(`INSERT INTO pulse.waiting_on_items(id,source,contact,subject,since,created_at,updated_at)
        VALUES($1,'hq',$2,$3,$4,$5,$5) ON CONFLICT(id) DO UPDATE SET updated_at=EXCLUDED.updated_at`,
      [id, valid.contact, valid.subject, valid.since, now]);
    }
    await tx.query("DELETE FROM pulse.waiting_on_items WHERE source='hq' AND NOT(id=ANY($1::text[]))", [ids]);
    if (!result || !result.skippedRows && !result.cappedRows) await tx.query(
      "DELETE FROM pulse.waiting_on_done WHERE item_id LIKE 'hq:%' AND NOT(item_id=ANY($1::text[]))", [ids]);
    await tx.query(`INSERT INTO pulse.waiting_on_file(singleton,status,updated_label,read_at,skipped_rows,capped_rows)
      VALUES(true,$1,$2,$3,$4,$5) ON CONFLICT(singleton) DO UPDATE SET status=EXCLUDED.status,updated_label=EXCLUDED.updated_label,
      read_at=EXCLUDED.read_at,skipped_rows=EXCLUDED.skipped_rows,capped_rows=EXCLUDED.capped_rows`,
    [result ? 'ready' : 'missing', result?.updatedLabel ?? null, now, result?.skippedRows ?? 0, result?.cappedRows ?? 0]);
  });
}

export async function readWaitingView(db: Database, mode: SourceMode, now: Date, thresholdDays = 7): Promise<WaitingView> {
  const [items, file, sync] = await Promise.all([
    db.query<{id: string; source: WaitingItem['source']; contact: string; subject: string; since: string}>(
      "SELECT id,source,contact,subject,since::text AS since FROM pulse.waiting_on_items WHERE source='manual' OR $1='live' ORDER BY since,id", [mode]),
    mode === 'live' ? db.query<{status: 'ready' | 'missing'; updated_label: string | null; read_at: string | Date; skipped_rows: number; capped_rows: number}>(
      'SELECT status,updated_label,read_at,skipped_rows,capped_rows FROM pulse.waiting_on_file WHERE singleton') : {rows: [], rowCount: 0},
    mode === 'live' ? db.query<{error_code: string | null}>("SELECT error_code FROM pulse.github_hq_reads WHERE target_key='waiting-on'") : {rows: [], rowCount: 0},
  ]);
  const markers = new Map((await db.query<{item_id: string; done_at: string | Date}>(
    'SELECT item_id,done_at FROM pulse.waiting_on_done WHERE item_id=ANY($1::text[])', [items.rows.map(row => row.id)])).rows.map(row => [row.item_id, iso(row.done_at)]));
  const stored = file.rows[0], error = sync.rows[0]?.error_code;
  const status: WaitingView['status'] = mode === 'sample' ? 'waiting_for_keys' : error && error !== 'not_found' ? 'unavailable'
    : stored?.status ?? 'pending';
  const view: WaitingView = {mode, status, updatedLabel: stored?.updated_label ?? null, readAt: stored ? iso(stored.read_at) : null,
    asOf: now.toISOString(), malformedRows: stored?.skipped_rows ?? 0, cappedRows: stored?.capped_rows ?? 0, thresholdDays, rows: [], done: []};
  for (const row of items.rows) {
    const item = {...row, days: waitingDays(row.since, now)}, doneAt = markers.get(row.id);
    if (doneAt && waitingDoneUntil(doneAt) > ukToday(now)) view.done.push({...item, doneAt, returnsOn: waitingDoneUntil(doneAt)});
    else view.rows.push(item);
  }
  return view;
}

export class WaitingNotFoundError extends Error {
  constructor() {super('That waiting item is no longer listed.');}
}
export async function addWaitingItem(db: Database, input: unknown, credential: string, now: Date): Promise<string> {
  const row = validateWaitingInput(input, now), id = waitingIdentity('manual', row);
  return db.transaction(async tx => {
    await lock(tx); await pruneDone(tx, now);
    if ((await tx.query('SELECT 1 FROM pulse.waiting_on_items WHERE id=$1', [id])).rowCount) return id;
    await tx.query(`INSERT INTO pulse.waiting_on_items(id,source,contact,subject,since,created_at,updated_at)
      VALUES($1,'manual',$2,$3,$4,$5,$5)`, [id, row.contact, row.subject, row.since, now]);
    await tx.query("INSERT INTO pulse.audit_log(event,credential_id,occurred_at) VALUES('Waiting item added',$1,$2)", [credential, now]);
    return id;
  });
}
export async function changeWaitingItem(db: Database, mode: SourceMode, id: string, action: 'done' | 'restore', credential: string, now: Date): Promise<void> {
  await db.transaction(async tx => {
    await lock(tx); await pruneDone(tx, now);
    if (!(await tx.query("SELECT 1 FROM pulse.waiting_on_items WHERE id=$1 AND (source='manual' OR $2='live')", [id, mode])).rowCount)
      throw new WaitingNotFoundError();
    const changed = action === 'done'
      ? await tx.query('INSERT INTO pulse.waiting_on_done(item_id,done_at) VALUES($1,$2) ON CONFLICT(item_id) DO NOTHING RETURNING item_id', [id, now])
      : await tx.query('DELETE FROM pulse.waiting_on_done WHERE item_id=$1 RETURNING item_id', [id]);
    if (changed.rowCount) await tx.query('INSERT INTO pulse.audit_log(event,credential_id,occurred_at) VALUES($1,$2,$3)',
      [action === 'done' ? 'Waiting item done' : 'Waiting item put back', credential, now]);
  });
}
