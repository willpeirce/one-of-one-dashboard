import type { Database } from '../db.js';
import { addDays, ukToday } from '../hero-range.js';
import type { SourceMode } from '../sources.js';
import { hqTargetInfo, HQReadError, type HQErrorCode, type HQTarget } from './client.js';
import { HQ_REGISTER_PARSER_VERSION, hqCut, hqDate, HQ_CELL_LIMIT, HQ_ITEM_LIMIT, HQ_ITEM_TEXT_LIMIT, HQ_SECTION_ROW_LIMIT,
  type HQBriefEntry, type HQFacts, type HQRegisterResult, type HQStoredBriefEntry, type HQStoredTestRow } from './model.js';

export interface HQSync {
  key: string; etag: string | null; lastAttemptAt: string | null; lastSuccessAt: string | null;
  errorCode: HQErrorCode | null; retryAfterAt: string | null; parsedAvailable: boolean; readable: boolean;
  initialized: boolean; skippedRows: number; cappedRows: number; parserVersion: number; headingsComplete: boolean;
}
interface SyncRow extends Record<string, unknown> {
  target_key: string; etag: string | null; last_attempt_at: Date | string | null; last_success_at: Date | string | null;
  error_code: HQErrorCode | null; retry_after_at: Date | string | null; parsed_available: boolean; readable: boolean;
  initialized: boolean; skipped_rows: number; capped_rows: number; parser_version: number; headings_complete: boolean;
}
const iso = (value: Date | string | null): string | null => value ? new Date(value).toISOString() : null;
const sync = (row: SyncRow): HQSync => ({key: row.target_key, etag: row.etag, lastAttemptAt: iso(row.last_attempt_at),
  lastSuccessAt: iso(row.last_success_at), errorCode: row.error_code, retryAfterAt: iso(row.retry_after_at),
  parsedAvailable: row.parsed_available, readable: row.readable, initialized: row.initialized, skippedRows: row.skipped_rows, cappedRows: row.capped_rows, parserVersion: row.parser_version, headingsComplete: row.headings_complete});

export async function readHQSync(db: Database, targets: readonly HQTarget[]): Promise<Map<string, HQSync>> {
  const keys = targets.map(target => hqTargetInfo(target).key);
  const result = await db.query<SyncRow>('SELECT * FROM pulse.github_hq_reads WHERE target_key = ANY($1::text[])', [keys]);
  return new Map(result.rows.map(row => [row.target_key, sync(row)]));
}
export async function hqRateLimited(db: Database, now: Date): Promise<boolean> {
  return (await db.query('SELECT 1 FROM pulse.github_hq_reads WHERE retry_after_at>$1 ORDER BY retry_after_at DESC LIMIT 1', [now])).rowCount > 0;
}
export async function beginHQRead(db: Database, target: HQTarget, now: Date): Promise<void> {
  const {key, path, ref} = hqTargetInfo(target);
  await db.query(`INSERT INTO pulse.github_hq_reads(target_key,path,ref,last_attempt_at) VALUES($1,$2,$3,$4)
    ON CONFLICT(target_key) DO UPDATE SET last_attempt_at=EXCLUDED.last_attempt_at`, [key, path, ref, now]);
}
async function success(db: Database, target: HQTarget, etag: string | null, now: Date, skippedRows = 0, initialized = true): Promise<void> {
  const {key, path, ref} = hqTargetInfo(target);
  await db.query(`INSERT INTO pulse.github_hq_reads(target_key,path,ref,etag,last_attempt_at,last_success_at,
      parsed_available,readable,initialized,skipped_rows) VALUES($1,$2,$3,$4,$5,$5,true,true,$7,$6)
    ON CONFLICT(target_key) DO UPDATE SET etag=EXCLUDED.etag,last_attempt_at=EXCLUDED.last_attempt_at,
      last_success_at=EXCLUDED.last_success_at,error_code=NULL,retry_after_at=NULL,parsed_available=true,
      readable=true,initialized=EXCLUDED.initialized,skipped_rows=EXCLUDED.skipped_rows`, [key, path, ref, etag, now, skippedRows, initialized]);
}
export async function failHQRead(db: Database, target: HQTarget, error: HQReadError, now: Date): Promise<void> {
  const {key} = hqTargetInfo(target);
  const delay = Math.min(Math.max(0, error.retryAfterMs), 365 * 86_400_000);
  const retryAt = delay ? new Date(now.getTime() + delay) : null;
  await db.query('UPDATE pulse.github_hq_reads SET error_code=$2,retry_after_at=$3 WHERE target_key=$1', [key, error.code, retryAt]);
}
export async function saveHQMonth(db: Database, target: Extract<HQTarget, {kind: 'month'}>, entries: readonly HQBriefEntry[], etag: string | null, now: Date): Promise<void> {
  const {path, ref} = hqTargetInfo(target);
  // The file's target month is authoritative; an unrelated heading cannot replace another month.
  const last = new Map(entries.filter(row => hqDate(row.day) && row.day.startsWith(`${target.month}-`)).map(row => [row.day, row]));
  await db.transaction(async tx => {
    await tx.query('DELETE FROM pulse.github_hq_reports WHERE path=$1 AND ref=$2', [path, ref]);
    for (const row of last.values()) {
      const items = row.items.slice(0, HQ_ITEM_LIMIT).map(item => ({text: hqCut(item.text, HQ_ITEM_TEXT_LIMIT),
        ...(item.label ? {label: hqCut(item.label, HQ_ITEM_TEXT_LIMIT)} : {})}));
      const lines = row.status === 'unreadable' ? row.firstLines.slice(0, 3).map(line => hqCut(line, HQ_ITEM_TEXT_LIMIT)) : [];
      await tx.query(`INSERT INTO pulse.github_hq_reports(report_day,run_label,status,item_count,items,first_lines,ref,path,read_at)
        VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9)
        ON CONFLICT(report_day,ref) DO UPDATE SET run_label=EXCLUDED.run_label,status=EXCLUDED.status,item_count=EXCLUDED.item_count,
          items=EXCLUDED.items,first_lines=EXCLUDED.first_lines,path=EXCLUDED.path,read_at=EXCLUDED.read_at`,
      [row.day, hqCut(row.runLabel, 100), row.status, Math.min(2_147_483_647, Math.max(0, Math.floor(row.count))), JSON.stringify(items), JSON.stringify(lines), ref, path, now]);
    }
    await success(tx, target, etag, now);
  });
}
export async function saveHQRegister(db: Database, result: HQRegisterResult, etag: string | null, now: Date): Promise<void> {
  const target: HQTarget = {kind: 'register'};
  if (!result.readable) {
    await db.query(`INSERT INTO pulse.github_hq_reads(target_key,path,ref,etag,last_attempt_at,error_code,parsed_available,readable,parser_version,headings_complete)
      VALUES('register','ops/tests/register.md','main',$1,$2,'unreadable',true,false,$3,false)
      ON CONFLICT(target_key) DO UPDATE SET etag=EXCLUDED.etag,last_attempt_at=EXCLUDED.last_attempt_at,
        error_code='unreadable',parsed_available=true,readable=false,parser_version=$3,headings_complete=false,skipped_rows=0,capped_rows=0`, [etag, now, HQ_REGISTER_PARSER_VERSION]);
    return;
  }
  await db.transaction(async tx => {
    const previous = (await tx.query<{initialized: boolean}>('SELECT initialized FROM pulse.github_hq_reads WHERE target_key=$1 FOR UPDATE', ['register'])).rows[0];
    const initial = !previous?.initialized, ids: string[] = [], seen = new Set<string>();
    const skipped = new Set((result.skippedCells ?? []).map(cell => hqCut(cell, HQ_CELL_LIMIT).split(/\s+/)[0]).filter(Boolean));
    const existing = new Map((await tx.query<{test_id: string; section: string}>(
      'SELECT test_id,section FROM pulse.github_hq_tests')).rows.map(row => [row.test_id, row.section]));
    const retainedIds = [...existing.keys()].filter(id => skipped.has(id));
    const candidates = (['live', 'queue', 'history'] as const).flatMap(section =>
      result.rows.filter(row => row.section === section).slice(0, HQ_SECTION_ROW_LIMIT)).flatMap(row => {
      const id = hqCut(row.id, HQ_CELL_LIMIT);
      if (!id || seen.has(id) || skipped.has(id)) return [];
      seen.add(id); return [{...row, id}];
    });
    // Reserve present stored identities first. A full destination leaves a moving row in its old section.
    const occupied = new Map([...existing].filter(([id]) => seen.has(id) || skipped.has(id)));
    const count = (section: string): number => [...occupied.values()].filter(value => value === section).length;
    const accepted = new Set<string>();
    let cappedRows = result.cappedRows ?? 0;
    for (const known of [true, false]) for (const row of candidates) {
      if (existing.has(row.id) !== known) continue;
      if (occupied.get(row.id) !== row.section && count(row.section) >= HQ_SECTION_ROW_LIMIT) {
        if (known) retainedIds.push(row.id);
        cappedRows++; continue;
      }
      occupied.set(row.id, row.section); accepted.add(row.id);
    }
    for (const [order, row] of candidates.entries()) {
      if (!accepted.has(row.id)) continue;
      const {id, section} = row; ids.push(id);
      await tx.query(`INSERT INTO pulse.github_hq_tests(test_id,section,row_order,cells,first_seen_at,section_first_seen_at,initially_seen)
        VALUES($1,$2,$3,$4::jsonb,$5,$5,$6)
        ON CONFLICT(test_id) DO UPDATE SET section=EXCLUDED.section,row_order=EXCLUDED.row_order,cells=EXCLUDED.cells,
          section_first_seen_at=CASE WHEN github_hq_tests.section=EXCLUDED.section THEN github_hq_tests.section_first_seen_at ELSE EXCLUDED.section_first_seen_at END,
          initially_seen=CASE WHEN $6 THEN true WHEN github_hq_tests.section=EXCLUDED.section THEN github_hq_tests.initially_seen ELSE false END`,
      [id, section, order, JSON.stringify(row.cells.map(cell => hqCut(cell, HQ_CELL_LIMIT))), now, initial]);
    }
    const complete = result.complete ?? true;
    if (complete) await tx.query('DELETE FROM pulse.github_hq_tests WHERE NOT(test_id = ANY($1::text[]))', [[...ids, ...retainedIds]]);
    else await tx.query(`DELETE FROM pulse.github_hq_tests WHERE test_id IN (SELECT test_id FROM (
      SELECT test_id,row_number() OVER(PARTITION BY section ORDER BY (test_id=ANY($3::text[])) DESC,(test_id=ANY($1::text[])) DESC,row_order,test_id) AS position
      FROM pulse.github_hq_tests) ranked WHERE position>$2)`, [ids, HQ_SECTION_ROW_LIMIT, retainedIds]);
    await success(tx, target, etag, now, result.skippedRows, !initial || complete);
    await tx.query(`UPDATE pulse.github_hq_reads SET parser_version=$1,capped_rows=$2,headings_complete=$3 WHERE target_key='register'`,
      [HQ_REGISTER_PARSER_VERSION, cappedRows, complete]);
  });
}
export async function touchHQRead(db: Database, target: HQTarget, etag: string | null, now: Date): Promise<void> {
  const {key, path, ref} = hqTargetInfo(target);
  await db.transaction(async tx => {
    const previous = (await readHQSync(tx, [target])).get(key);
    if (target.kind === 'register' && previous?.parserVersion !== HQ_REGISTER_PARSER_VERSION) throw new HQReadError('invalid', 304);
    if (!previous?.parsedAvailable) throw new HQReadError('invalid', 304);
    if (!previous.readable) throw new HQReadError('unreadable', 304);
    await success(tx, target, etag ?? previous.etag, now, previous.skippedRows, previous.initialized);
    if (target.kind === 'month') await tx.query('UPDATE pulse.github_hq_reports SET read_at=$3 WHERE path=$1 AND ref=$2', [path, ref, now]);
  });
}
interface ReportRow extends Record<string, unknown> {
  report_day: string; run_label: string; status: HQBriefEntry['status']; item_count: number; items: HQBriefEntry['items'];
  first_lines: string[]; ref: HQStoredBriefEntry['ref']; path: string; read_at: Date | string;
}
export async function readHQReports(db: Database, day: string): Promise<HQStoredBriefEntry[]> {
  const result = await db.query<ReportRow>(`SELECT report_day::text,run_label,status,item_count,items,first_lines,ref,path,read_at
    FROM pulse.github_hq_reports WHERE report_day=$1 ORDER BY CASE ref WHEN 'main' THEN 0 ELSE 1 END LIMIT 2`, [day]);
  return result.rows.map(row => ({day: row.report_day, runLabel: row.run_label, status: row.status, count: row.item_count,
    items: row.items, firstLines: row.first_lines, ref: row.ref, path: row.path, readAt: iso(row.read_at)!}));
}
export async function readHQFacts(db: Database, now: Date, sourceMode: SourceMode): Promise<HQFacts> {
  if (sourceMode === 'sample') return {sourceMode, report: null, tests: [], registerReadAt: null, registerReadOk: false, registerSkippedRows: 0, monthReadAt: null};
  const day = addDays(ukToday(now), -1), month = day.slice(0, 7);
  const targets: HQTarget[] = [{kind: 'month', month, ref: 'main'}, {kind: 'month', month, ref: 'claude/ads-daily'}, {kind: 'register'}];
  const [reports, reads, tests] = await Promise.all([
    readHQReports(db, day), readHQSync(db, targets),
    db.query<{test_id: string; section: HQStoredTestRow['section']; cells: string[]; first_seen_at: Date | string;
      section_first_seen_at: Date | string; initially_seen: boolean}>(`SELECT test_id,section,cells,first_seen_at,section_first_seen_at,initially_seen
      FROM pulse.github_hq_tests ORDER BY row_order,test_id LIMIT 120`),
  ]);
  const register = reads.get('register');
  const report = (reads.get(`month:${month}:main`)?.errorCode === 'not_found'
    ? reports.find(row => row.ref === 'claude/ads-daily') ?? reports[0] : reports[0]) ?? null;
  const registerReadOk = sourceMode === 'live' && !!register?.initialized && register.readable && register.errorCode === null
    && register.headingsComplete && register.parserVersion === HQ_REGISTER_PARSER_VERSION && !!register.lastSuccessAt && register.lastSuccessAt === register.lastAttemptAt;
  const monthReadAt = report?.readAt ?? [reads.get(`month:${month}:main`)?.lastSuccessAt, reads.get(`month:${month}:claude/ads-daily`)?.lastSuccessAt]
    .filter((value): value is string => !!value).sort().at(-1) ?? null;
  return {sourceMode, report, registerReadAt: register?.lastSuccessAt ?? null, registerReadOk,
    registerSkippedRows: register?.skippedRows ?? 0, registerCappedRows: register?.cappedRows ?? 0, registerHeadingsComplete: register?.parsedAvailable ? register.headingsComplete : undefined, monthReadAt,
    tests: tests.rows.map(row => ({id: row.test_id, section: row.section, cells: row.cells, firstSeenAt: iso(row.first_seen_at)!,
      sectionFirstSeenAt: iso(row.section_first_seen_at)!, initiallySeen: row.initially_seen}))};
}
