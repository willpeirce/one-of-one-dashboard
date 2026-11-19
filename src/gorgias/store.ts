import {readFile} from 'node:fs/promises';
import type {Database} from '../db.js';
import {ukToday} from '../hero-range.js';
import {GORGIAS_SAMPLE_NOW, gorgiasFreshMs, gorgiasOldestFirst, gorgiasWeekStart,
  type GorgiasFacts, type GorgiasPollInput, type GorgiasPollResult, type GorgiasSelection, type GorgiasTicket} from './model.js';
import {gorgiasTicketId, normalizeGorgiasIntent, parseGorgiasTicket} from './privacy.js';
import {gorgiasScope, gorgiasSource} from './scope.js';

const iso = (value: Date | string | null): string | null => value ? new Date(value).toISOString() : null;
export interface GorgiasSync {
  lastAttemptAt: string;
  lastSuccessAt: string | null;
  nextRunAt: string;
  lastError: string | null;
  failures: number;
}
export async function readGorgiasSync(db: Database, scope: string): Promise<GorgiasSync | null> {
  const row = (await db.query<{last_attempt_at: Date | string; last_success_at: Date | string | null;
    next_run_at: Date | string; last_error: string | null; failures: number}>(
    'SELECT last_attempt_at,last_success_at,next_run_at,last_error,failures FROM pulse.gorgias_sync WHERE scope=$1', [scope])).rows[0];
  return row ? {lastAttemptAt: iso(row.last_attempt_at)!, lastSuccessAt: iso(row.last_success_at), nextRunAt: iso(row.next_run_at)!,
    lastError: row.last_error, failures: row.failures} : null;
}
export async function readKnownGorgiasTickets(db: Database, scope: string): Promise<GorgiasPollInput['knownTickets']> {
  const result = await db.query<{ticket_id: string; status: GorgiasTicket['status']; in_handover: boolean}>(
    'SELECT ticket_id,status,in_handover FROM pulse.gorgias_tickets WHERE scope=$1 ORDER BY ticket_id', [scope]);
  return result.rows.map(row => ({id: row.ticket_id, status: row.status, inHandover: row.in_handover}));
}

/** Only recent, unchecked retained rows in this exact handover selection may receive optional intent-only reads. */
export async function readGorgiasIntentBackfillIds(db: Database, scope: string, now: Date): Promise<string[]> {
  const result = await db.query<{ticket_id: string}>(`SELECT ticket_id FROM pulse.gorgias_tickets
    WHERE scope=$1 AND ai_intent IS NULL
      AND created_at >= ((date_trunc('month',$2::timestamptz AT TIME ZONE 'Europe/London') - INTERVAL '1 month') AT TIME ZONE 'Europe/London')
      AND (ai_intent_checked_at IS NULL OR ai_intent_checked_at <= $2::timestamptz - INTERVAL '24 hours')
    ORDER BY created_at,ticket_id LIMIT 20`, [scope, now]);
  return result.rows.map(row => row.ticket_id);
}

interface TicketRow extends Record<string, unknown> {
  ticket_id: string; status: GorgiasTicket['status']; channel: string; tags: string[]; in_handover: boolean; view_id: string | null;
  created_at: Date | string; updated_at: Date | string | null; last_customer_message_at: Date | string | null; customer: string; subject: string; ai_intent: string | null;
}
const ticket = (row: TicketRow): GorgiasTicket => ({id: row.ticket_id, status: row.status, channel: row.channel, tags: row.tags,
  inHandover: row.in_handover, viewId: row.view_id, createdAt: iso(row.created_at)!, updatedAt: iso(row.updated_at),
  lastCustomerMessageAt: iso(row.last_customer_message_at), customer: row.customer, subject: row.subject, aiIntent: normalizeGorgiasIntent(row.ai_intent)});

let sampleRead: Promise<GorgiasFacts> | undefined;
async function sampleFacts(): Promise<GorgiasFacts> {
  sampleRead ??= (async (): Promise<GorgiasFacts> => {
    const [ticketText, fieldText] = await Promise.all(['tickets.json', 'custom-fields.json'].map(file =>
      readFile(new URL(`../../test/fixtures/gorgias/${file}`, import.meta.url), 'utf8')));
    const raw = JSON.parse(ticketText!) as {data?: unknown[]}, fields = JSON.parse(fieldText!) as {data?: unknown[]};
    if (!Array.isArray(raw.data) || raw.data.length !== 4 || !Array.isArray(fields.data)) throw new Error('Invalid sample');
    let fieldId: string | null = null;
    for (const value of fields.data) {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) continue;
      const field = value as Record<string, unknown>;
      if (field.managed_type === 'ai_intent' && field.object_type === 'Ticket' && field.deactivated_datetime == null) {
        fieldId = gorgiasTicketId(field.id); break;
      }
    }
    const tickets = raw.data.map(row => parseGorgiasTicket(row, {inHandover: true, viewId: null}, fieldId));
    const weekStart = gorgiasWeekStart(new Date(GORGIAS_SAMPLE_NOW));
    return {mode: 'sample', status: 'sample', domain: 'invented-helpdesk', checkedAt: GORGIAS_SAMPLE_NOW, asOf: GORGIAS_SAMPLE_NOW,
      weekStart, openedThisWeek: tickets.filter(row => row.createdAt >= weekStart && row.createdAt <= GORGIAS_SAMPLE_NOW).length,
      closedThisWeek: 0, tickets: gorgiasOldestFirst(tickets)};
  })().catch(() => {
    try { console.error('Gorgias sample unavailable (code: fixture).'); } catch { /* Diagnostics are non-fatal. */ }
    return {mode: 'sample', status: 'unavailable', domain: 'invented-helpdesk', checkedAt: null, asOf: GORGIAS_SAMPLE_NOW,
      weekStart: gorgiasWeekStart(new Date(GORGIAS_SAMPLE_NOW)), openedThisWeek: null, closedThisWeek: null, tickets: []};
  });
  return structuredClone(await sampleRead);
}

async function facts(db: Database, env: NodeJS.ProcessEnv, selection: GorgiasSelection, now: Date, history: boolean): Promise<GorgiasFacts> {
  const source = gorgiasSource(env);
  if (source.mode === 'sample') return sampleFacts();
  const weekStart = gorgiasWeekStart(now), base: GorgiasFacts = {...source, status: 'pending', checkedAt: null, asOf: now.toISOString(),
    weekStart, openedThisWeek: null, closedThisWeek: null, tickets: []};
  if (!source.domain) return {...base, status: 'unavailable'};
  const scope = gorgiasScope(source.domain, selection);
  const [sync, rows, counts] = await Promise.all([
    readGorgiasSync(db, scope),
    db.query<TicketRow>(`SELECT ticket_id,status,channel,tags,in_handover,view_id,created_at,updated_at,last_customer_message_at,customer,subject,ai_intent
      FROM pulse.gorgias_tickets WHERE scope=$1 AND ($2::boolean OR (status='open' AND in_handover))
      ORDER BY COALESCE(last_customer_message_at,created_at),created_at,ticket_id`, [scope, history]),
    db.query<{opened: string; closed_count: number | null}>(`SELECT
      (SELECT count(*) FROM pulse.gorgias_tickets WHERE scope=$1 AND created_at >= $2 AND created_at <= $3) AS opened,
      (SELECT closed_count FROM pulse.gorgias_weekly WHERE scope=$1 AND week_start=$4::date) AS closed_count`,
    [scope, weekStart, now, ukToday(new Date(weekStart))]),
  ]);
  const age = sync?.lastSuccessAt ? now.getTime() - Date.parse(sync.lastSuccessAt) : null;
  const status = sync?.lastError || sync?.failures || age !== null && (age < 0 || age > gorgiasFreshMs(selection))
    ? 'unavailable' : sync?.lastSuccessAt ? 'live' : 'pending';
  return {...base, status, checkedAt: sync?.lastSuccessAt ?? null, tickets: rows.rows.map(ticket),
    openedThisWeek: sync?.lastSuccessAt ? Number(counts.rows[0]?.opened ?? 0) : null,
    closedThisWeek: counts.rows[0]?.closed_count ?? null};
}
/** Current open members for the signed-in page and needs projection. */
export function readGorgiasFacts(db: Database, env: NodeJS.ProcessEnv, selection: GorgiasSelection, now: Date): Promise<GorgiasFacts> {
  return facts(db, env, selection, now, false);
}
/** Every retained row was observed in the selected handover scope; former/closed members stay available to Issues. */
export function readGorgiasHistory(db: Database, env: NodeJS.ProcessEnv, selection: GorgiasSelection, now: Date): Promise<GorgiasFacts> {
  return facts(db, env, selection, now, true);
}

/** Only a complete successful source poll can replace current membership or certify weekly counts. */
export async function saveGorgiasPoll(db: Database, scope: string, result: GorgiasPollResult,
  options: {weekStart: string; finishedAt: Date; nextRun: Date; isCurrent?: (tx: Database) => Promise<boolean>}): Promise<boolean> {
  if (!Number.isSafeInteger(result.closedThisWeek) || result.closedThisWeek < 0) throw new Error('Invalid Gorgias aggregate');
  const ids = new Set<string>();
  const rows = result.tickets.map(row => {
    if (ids.has(row.id)) throw new Error('Duplicate Gorgias ticket');
    ids.add(row.id);
    // Explicit columns stop accidental extra fields, including transient closure times, at the storage boundary.
    return {ticket_id: row.id, status: row.status, channel: row.channel, tags: row.tags, in_handover: row.inHandover,
      view_id: row.viewId, created_at: row.createdAt, updated_at: row.updatedAt, last_customer_message_at: row.lastCustomerMessageAt,
      customer: row.customer, subject: row.subject, ai_intent: result.intentFieldAvailable ? normalizeGorgiasIntent(row.aiIntent) : null};
  });
  return db.transaction(async tx => {
    if (options.isCurrent && !await options.isCurrent(tx)) return false;
    await tx.query(`UPDATE pulse.gorgias_tickets SET in_handover=false WHERE scope=$1 AND in_handover
      AND NOT(ticket_id=ANY($2::text[]))`, [scope, result.tickets.filter(row => row.inHandover && row.status === 'open').map(row => row.id)]);
    await tx.query(`INSERT INTO pulse.gorgias_tickets(scope,ticket_id,status,channel,tags,in_handover,view_id,
      created_at,updated_at,last_customer_message_at,customer,subject,fetched_at,ai_intent,ai_intent_checked_at)
      SELECT $1,ticket_id,status,channel,tags,in_handover,view_id,created_at,updated_at,last_customer_message_at,customer,subject,$3,ai_intent,
        CASE WHEN $4::boolean THEN $3::timestamptz ELSE NULL END
      FROM jsonb_to_recordset($2::jsonb) AS r(ticket_id text,status text,channel text,tags jsonb,in_handover boolean,view_id text,
        created_at timestamptz,updated_at timestamptz,last_customer_message_at timestamptz,customer text,subject text,ai_intent text)
      ON CONFLICT(scope,ticket_id) DO UPDATE SET status=EXCLUDED.status,channel=EXCLUDED.channel,tags=EXCLUDED.tags,
        in_handover=EXCLUDED.in_handover,view_id=EXCLUDED.view_id,created_at=EXCLUDED.created_at,updated_at=EXCLUDED.updated_at,
        last_customer_message_at=EXCLUDED.last_customer_message_at,customer=EXCLUDED.customer,subject=EXCLUDED.subject,fetched_at=EXCLUDED.fetched_at,
        ai_intent=COALESCE(EXCLUDED.ai_intent,gorgias_tickets.ai_intent),
        ai_intent_checked_at=COALESCE(EXCLUDED.ai_intent_checked_at,gorgias_tickets.ai_intent_checked_at)`,
    [scope, JSON.stringify(rows), options.finishedAt, result.intentFieldAvailable === true]);
    if (result.intentFieldAvailable && result.intentBackfill?.length) {
      const backfill = result.intentBackfill.slice(0, 20).map(row => ({ticket_id: row.id, ai_intent: normalizeGorgiasIntent(row.aiIntent)}));
      // These reads cannot change membership, statuses, source timestamps or the observed weekly aggregate.
      await tx.query(`UPDATE pulse.gorgias_tickets AS t
        SET ai_intent=COALESCE(r.ai_intent,t.ai_intent),ai_intent_checked_at=$3
        FROM jsonb_to_recordset($2::jsonb) AS r(ticket_id text,ai_intent text)
        WHERE t.scope=$1 AND t.ticket_id=r.ticket_id`, [scope, JSON.stringify(backfill), options.finishedAt]);
    }
    await tx.query(`INSERT INTO pulse.gorgias_weekly(scope,week_start,closed_count,fetched_at) VALUES($1,$2,$3,$4)
      ON CONFLICT(scope,week_start) DO UPDATE SET closed_count=GREATEST(gorgias_weekly.closed_count,EXCLUDED.closed_count),fetched_at=EXCLUDED.fetched_at`,
    [scope, ukToday(new Date(options.weekStart)), result.closedThisWeek, options.finishedAt]);
    await tx.query(`INSERT INTO pulse.gorgias_sync(scope,last_attempt_at,last_success_at,next_run_at)
      VALUES($1,$2,$2,$3) ON CONFLICT(scope) DO UPDATE SET last_attempt_at=EXCLUDED.last_attempt_at,
        last_success_at=EXCLUDED.last_success_at,next_run_at=EXCLUDED.next_run_at,last_error=NULL,failures=0`,
    [scope, options.finishedAt, options.nextRun]);
    await tx.query(`UPDATE pulse.source_health SET status='healthy',last_success_at=$1,last_attempt_at=$1,
      consecutive_failures=0,updated_at=$1 WHERE source='gorgias' AND mode='live'`, [options.finishedAt]);
    return true;
  });
}

export async function recordGorgiasFailure(db: Database, scope: string, now: Date, nextRun: Date, code: string,
  options: {isCurrent?: (tx: Database) => Promise<boolean>} = {}): Promise<boolean> {
  return db.transaction(async tx => {
    const current = options.isCurrent ? await options.isCurrent(tx) : true;
    await tx.query(`INSERT INTO pulse.gorgias_sync(scope,last_attempt_at,next_run_at,last_error,failures) VALUES($1,$2,$3,$4,1)
      ON CONFLICT(scope) DO UPDATE SET last_attempt_at=EXCLUDED.last_attempt_at,next_run_at=EXCLUDED.next_run_at,
        last_error=EXCLUDED.last_error,failures=gorgias_sync.failures+1`, [scope, now, nextRun, code]);
    if (current) await tx.query(`UPDATE pulse.source_health SET status='error',last_attempt_at=$1,consecutive_failures=$2,updated_at=$1
      WHERE source='gorgias' AND mode='live'`, [now, (await readGorgiasSync(tx, scope))!.failures]);
    return current;
  });
}

/** Restore stored health after listen, without a source call or a successful-read claim. */
export async function restoreGorgiasHealth(db: Database, scope: string, now: Date, selection: GorgiasSelection): Promise<GorgiasSync | null> {
  const sync = await readGorgiasSync(db, scope);
  if (!sync) {
    await db.query(`UPDATE pulse.source_health SET status='not_implemented',last_attempt_at=NULL,last_success_at=NULL,
      consecutive_failures=0,updated_at=$1 WHERE source='gorgias' AND mode='live'`, [now]);
    return null;
  }
  const age = sync.lastSuccessAt ? now.getTime() - Date.parse(sync.lastSuccessAt) : null;
  const healthy = age !== null && age >= 0 && age <= gorgiasFreshMs(selection) && !sync.lastError && !sync.failures;
  await db.query(`UPDATE pulse.source_health SET status=$1,last_attempt_at=$2,last_success_at=$3,consecutive_failures=$4,
    updated_at=$5 WHERE source='gorgias' AND mode='live'`,
  [healthy ? 'healthy' : 'error', sync.lastAttemptAt, sync.lastSuccessAt, sync.failures, now]);
  return sync;
}
