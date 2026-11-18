import type {Database} from '../db.js';
import type {SourceMode} from '../sources.js';
import {KIT_ROW_LIMIT, KIT_ORDER_LIMIT, type KitFacts, type KitFile, type KitFileKind,
  type KitRow, type KitOrderRow, type KitParseResult} from './model.js';
import {sampleKitFacts} from './sample.js';

const iso = (value: Date | string | null): string | null => value ? new Date(value).toISOString() : null;

/** Called within the HQ metadata transaction. Only explicit allowed columns cross this boundary. */
export async function replaceKitFile(db: Database, kind: KitFileKind,
  result: KitParseResult<KitRow> | KitParseResult<KitOrderRow> | null, now: Date): Promise<void> {
  if (result && !result.readable) throw new Error('The kit file could not be read.');
  await db.query('SELECT pg_advisory_xact_lock(1668244583,hashtext($1))', [kind]);
  if (kind === 'kits') {
    await db.query('DELETE FROM pulse.kit_board_kits');
    for (const [order, row] of ((result?.rows ?? []) as KitRow[]).slice(0, KIT_ROW_LIMIT).entries()) {
      await db.query(`INSERT INTO pulse.kit_board_kits(id,row_order,name,series,status,gate,launch_target,launch_label,
        brief_due,milestone,next_action,owner,waiting_with,waiting_since,note)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [row.id, order, row.name, row.series, row.status, row.gate, row.launchTarget, row.launchLabel, row.briefDue,
        row.milestone, row.nextAction, row.owner, row.with, row.waitingSince, row.note]);
    }
  } else {
    await db.query('DELETE FROM pulse.kit_board_orders');
    for (const [order, row] of ((result?.rows ?? []) as KitOrderRow[]).slice(0, KIT_ORDER_LIMIT).entries()) {
      await db.query(`INSERT INTO pulse.kit_board_orders(id,row_order,kit,supplier,item,qty,ordered_date,eta,status)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [row.id, order, row.kit, row.supplier, row.item, row.qty, row.date, row.eta, row.status]);
    }
  }
  await db.query(`INSERT INTO pulse.kit_board_files(kind,status,updated_at,read_at,skipped_rows,capped_rows)
    VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(kind) DO UPDATE SET status=EXCLUDED.status,updated_at=EXCLUDED.updated_at,
      read_at=EXCLUDED.read_at,skipped_rows=EXCLUDED.skipped_rows,capped_rows=EXCLUDED.capped_rows`,
  [kind, result ? 'ready' : 'missing', result?.updatedAt ?? null, now, result?.skippedRows ?? 0, result?.cappedRows ?? 0]);
}

interface FileRow extends Record<string, unknown> {
  kind: KitFileKind; status: 'ready' | 'missing'; updated_at: Date | string | null;
  read_at: Date | string; skipped_rows: number; capped_rows: number;
}
interface StoredKit extends Record<string, unknown> {
  id: string; name: string; series: string; status: string; gate: number;
  launch_target: string | null; launch_label: string | null; brief_due: string | null;
  milestone: string | null; next_action: string; owner: string; waiting_with: string;
  waiting_since: string | null; note: string;
}
interface StoredOrder extends Record<string, unknown> {
  id: string; kit: string; supplier: string; item: string; qty: number | null;
  ordered_date: string | null; eta: string | null; status: string;
}
export async function readKitFacts(db: Database, mode: SourceMode, now: Date): Promise<KitFacts> {
  if (mode === 'sample') return sampleKitFacts(now);
  // One statement sees file metadata and both lists from the same committed snapshot.
  const data = (await db.query<{files: FileRow[]; kits: StoredKit[]; orders: StoredOrder[];
    sync: {target_key: KitFileKind; error_code: string | null}[]}>(`SELECT
    (SELECT COALESCE(jsonb_agg(f),'[]'::jsonb) FROM pulse.kit_board_files f) AS files,
    (SELECT COALESCE(jsonb_agg(k ORDER BY k.row_order),'[]'::jsonb) FROM
      (SELECT id,row_order,name,series,status,gate,launch_target::text,launch_label,brief_due::text,
        milestone,next_action,owner,waiting_with,waiting_since::text,note FROM pulse.kit_board_kits
        ORDER BY row_order LIMIT $1) k) AS kits,
    (SELECT COALESCE(jsonb_agg(o ORDER BY o.row_order),'[]'::jsonb) FROM
      (SELECT id,row_order,kit,supplier,item,qty,ordered_date::text,eta::text,status FROM pulse.kit_board_orders
        ORDER BY row_order LIMIT $2) o) AS orders,
    (SELECT COALESCE(jsonb_agg(s),'[]'::jsonb) FROM
      (SELECT target_key,error_code FROM pulse.github_hq_reads WHERE target_key IN ('kits','kit-orders')) s) AS sync`,
  [KIT_ROW_LIMIT, KIT_ORDER_LIMIT])).rows[0]!;
  function file<T>(kind: KitFileKind, rows: T[]): KitFile<T> {
    const stored = data.files.find(row => row.kind === kind), error = data.sync.find(row => row.target_key === kind)?.error_code;
    return {status: error && error !== 'not_found' ? 'unavailable' : stored?.status ?? 'pending',
      updatedAt: iso(stored?.updated_at ?? null), readAt: iso(stored?.read_at ?? null),
      skippedRows: stored?.skipped_rows ?? 0, cappedRows: stored?.capped_rows ?? 0, rows};
  }
  return {mode, kits: file('kits', data.kits.map(row => ({id: row.id, name: row.name, series: row.series,
    status: row.status, gate: row.gate, launchTarget: row.launch_target, launchLabel: row.launch_label,
    briefDue: row.brief_due, milestone: row.milestone, nextAction: row.next_action, owner: row.owner,
    with: row.waiting_with, waitingSince: row.waiting_since, note: row.note}))),
  orders: file('kit-orders', data.orders.map(row => ({id: row.id, kit: row.kit, supplier: row.supplier,
    item: row.item, qty: row.qty, date: row.ordered_date, eta: row.eta, status: row.status})))};
}
