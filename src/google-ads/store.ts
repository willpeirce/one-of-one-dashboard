import type { Database } from '../db.js';
import type { Settings } from '../settings.js';
import { getSourceStates } from '../sources.js';
import { addDays } from '../hero-range.js';
import { GOOGLE_OPERATION_LIMIT, googleConversionDays, googleJobKinds, type GoogleCampaign, type GoogleChange, type GoogleCoverage, type GoogleDailyTotal, type GoogleFacts, type GoogleHour, type GoogleJobKind, type GoogleNetworkSlice, type GoogleSyncState } from './model.js';
type GoogleRow = GoogleCampaign | GoogleNetworkSlice | GoogleHour | GoogleChange | GoogleDailyTotal;
const iso = (value: unknown) => value ? new Date(String(value)).toISOString() : null;
export async function googleSync(db: Database, account: string): Promise<GoogleSyncState[]> {
  const result = await db.query<any>("SELECT * FROM pulse.google_sync WHERE mode='live' AND account_id=$1", [account]);
  return result.rows.map(row => ({ kind: row.kind, lastAttemptAt: iso(row.last_attempt_at), lastSuccessAt: iso(row.last_success_at),
    error: row.error, failures: row.failures, coverage: row.coverage, currency: row.currency }));
}
export async function beginGoogleRead(db: Database, account: string, kind: GoogleJobKind, now: Date): Promise<void> {
  await db.query(`INSERT INTO pulse.google_sync(mode,account_id,kind,last_attempt_at) VALUES('live',$1,$2,$3)
    ON CONFLICT(mode,account_id,kind) DO UPDATE SET last_attempt_at=EXCLUDED.last_attempt_at`, [account, kind, now]);
}
export async function failGoogleRead(db: Database, account: string, kind: GoogleJobKind, error: string): Promise<void> {
  await db.query("UPDATE pulse.google_sync SET error=$3,failures=failures+1 WHERE mode='live' AND account_id=$1 AND kind=$2", [account, kind, error]);
}
function identity(kind: GoogleJobKind, row: GoogleRow): string {
  if ('id' in row) return row.id;
  if (kind === 'daily') return (row as GoogleDailyTotal).day;
  const value = row as GoogleNetworkSlice & GoogleHour;
  return JSON.stringify([value.campaignId, value.day, kind === 'networks' ? value.network : value.hour]);
}
export async function saveGoogleRead(db: Database, account: string, kind: GoogleJobKind, rows: GoogleRow[], currency: string, coverage: GoogleCoverage | null, now: Date): Promise<void> {
  const records = rows.map(row => ({ source_id: identity(kind, row), day: 'day' in row ? row.day : 'at' in row ? row.at.slice(0, 10) : null, data: row }));
  await db.transaction(async tx => {
    // Replace successful report windows, including zero rows. Failures never erase the previous report.
    if (kind !== 'changes') {
      if (kind === 'campaigns') await tx.query("DELETE FROM pulse.google_rows WHERE mode='live' AND account_id=$1 AND kind=$2 AND NOT(source_id=ANY($3::text[]))", [account, kind, records.map(r => r.source_id)]);
      else if (coverage) await tx.query("DELETE FROM pulse.google_rows WHERE mode='live' AND account_id=$1 AND kind=$2 AND day BETWEEN $3 AND $4", [account, kind, coverage.from.slice(0, 10), coverage.to.slice(0, 10)]);
    }
    if (records.length) await tx.query(`INSERT INTO pulse.google_rows(mode,account_id,kind,source_id,day,data,fetched_at)
      SELECT 'live',$1,$2,r.source_id,r.day::date,r.data,$3 FROM jsonb_to_recordset($4::jsonb) AS r(source_id text,day text,data jsonb)
      ON CONFLICT(mode,account_id,kind,source_id) DO UPDATE SET day=EXCLUDED.day,data=EXCLUDED.data,fetched_at=EXCLUDED.fetched_at`, [account, kind, now, JSON.stringify(records)]);
    await tx.query("DELETE FROM pulse.google_rows WHERE mode='live' AND account_id=$1 AND kind=$2 AND day<$3", [account, kind, addDays(now.toISOString().slice(0, 10), -14)]);
    await tx.query(`UPDATE pulse.google_sync SET last_success_at=$3,error=NULL,failures=0,currency=$4,coverage=$5
      WHERE mode='live' AND account_id=$1 AND kind=$2`, [account, kind, now, currency, coverage ? JSON.stringify(coverage) : null]);
  });
}
export function emptyGoogleFacts(mode: GoogleFacts['mode'] = 'sample', accountId = ''): GoogleFacts {
  return { mode, accountId, currency: null, campaigns: [], networks: [], hours: [], conversions: [], changes: [], daily: [], jobs: [],
    quota: { day: null, operations: 0, historyOperations: 0, limit: GOOGLE_OPERATION_LIMIT, error: null } };
}
export async function readGoogleFacts(db: Database, settings: Settings, env: NodeJS.ProcessEnv, now = new Date()): Promise<GoogleFacts> {
  const live = !!settings.googleCustomerId && getSourceStates(env).find(s => s.source === 'google-ads')?.mode === 'live';
  if (!live) return emptyGoogleFacts(); // Existing invented Google widgets remain explicitly sample.
  const account = settings.googleCustomerId, facts = emptyGoogleFacts('live', account);
  facts.jobs = await googleSync(db, account);
  const rows = await db.query<{kind:GoogleJobKind;data:any}>("SELECT kind,data FROM pulse.google_rows WHERE mode='live' AND account_id=$1 AND (day IS NULL OR day>=$2)", [account, addDays(now.toISOString().slice(0, 10), -14)]);
  for (const kind of googleJobKinds) {
    const job = facts.jobs.find(j => j.kind === kind), coverage = job?.coverage;
    const selected = rows.rows.filter(row => row.kind === kind).map(row => row.data)
      .filter(row => !coverage || !row.day || row.day >= coverage.from.slice(0, 10) && row.day <= coverage.to.slice(0, 10));
    if (kind === 'campaigns') facts.campaigns = selected;
    else if (kind === 'networks') facts.networks = selected;
    else if (kind === 'conversions') facts.hours = selected;
    else if (kind === 'changes') facts.changes = selected;
    else facts.daily = selected;
  }
  const conversion = facts.jobs.find(j => j.kind === 'conversions');
  facts.conversions = googleConversionDays(facts.hours, conversion?.coverage?.ukFrom, conversion?.coverage?.ukTo);
  facts.currency = conversion?.currency ?? facts.jobs.find(j => j.currency)?.currency ?? null;
  const quota = (await db.query<any>("SELECT operations_day::text,operations,google_history_operations,google_quota_error FROM pulse.ad_spend_jobs WHERE source='google-ads' AND account_id=$1", [account])).rows[0];
  if (quota) facts.quota = { day: quota.operations_day, operations: quota.operations, historyOperations: quota.google_history_operations, limit: GOOGLE_OPERATION_LIMIT, error: quota.google_quota_error };
  return facts;
}
