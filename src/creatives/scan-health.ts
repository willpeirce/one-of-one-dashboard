import { scoredMediaCte } from './scored-media.js';
import { readScanContent } from './scan-content.js';
import type { Database } from '../db.js';
import type { Settings } from '../settings.js';
import type { SourceMode, SourceStatus } from '../sources.js';
import { ukToday } from '../hero-range.js';
import { creativeFeatureFlags } from './config.js';

export type ScanFailure = 'rejected' | 'refused' | 'malformed' | 'timeout' | 'cap' | 'network' | 'prices' | 'media too large' | 'unsupported type';
export interface ScanScope { accountId: string; mode: SourceMode }
export interface ScanHealth {
  enabled: boolean; line: string; message: string | null;
  waiting: number; scanned: number; failed: number; skipped: number; skippedGroupIds: string[]; spentGbp: number; capGbp: number; model: string;
  status: SourceStatus; reason: ScanFailure | null; httpStatus: number | null; providerCode?: string | null; providerMessage?: string | null;
  lastAttemptAt: string | null; lastAttemptStatus: 'done' | 'failed' | 'skipped' | null; lastAttemptSeconds: number | null; lastSuccessAt: string | null; consecutiveFailures: number;
}
export const scanPricesReady = (settings: Settings): boolean =>
  settings.creativeScanInputPrice > 0 && Number.isFinite(settings.creativeScanInputPrice)
  && settings.creativeScanOutputPrice > 0 && Number.isFinite(settings.creativeScanOutputPrice);
export const scanEnabled = (mode: SourceMode): boolean => mode === 'live'
  && creativeFeatureFlags().creativeScanEnabled && !!process.env.ANTHROPIC_API_KEY?.trim();

/** Every model and every attempt contributes its actual cost to the same UK-day cap. */
export async function scanSpendToday(db: Database, scope: ScanScope, now: Date): Promise<number> {
  const row = (await db.query<{ total: string }>(`SELECT COALESCE(sum(cost_gbp),0)::text AS total
    FROM pulse.creative_scans WHERE mode=$1 AND account_id=$2
    AND (requested_at AT TIME ZONE 'Europe/London')::date=$3::date`, [scope.mode, scope.accountId, ukToday(now)])).rows[0];
  return Number(row?.total ?? 0);
}

/** Current-model parent results count once; cap/prices stops never replace provider health. */
export async function readScanHealth(db: Database, settings: Settings, scope: ScanScope & { now?: Date }): Promise<ScanHealth> {
  const now = scope.now ?? new Date(), enabled = scanEnabled(scope.mode);
  const content = await readScanContent(db, scope);
  const [attempts, summary, control, spentGbp, eligible] = await Promise.all([
    db.query<any>(`WITH current_content AS (
      SELECT s.*, count(*) FILTER(WHERE status='failed' AND sequence>COALESCE(
        (SELECT max(sequence) FROM pulse.creative_scans WHERE mode=$1 AND account_id=$2 AND status='done'),0))
        OVER(PARTITION BY media_group_id) AS failure_count
      FROM pulse.creative_scans s JOIN jsonb_each_text($4::jsonb) c ON c.key=s.media_group_id
      WHERE mode=$1 AND account_id=$2 AND model_id=$3
        AND (content_fingerprint IS NULL OR content_fingerprint=c.value)
        AND (failure_reason IS NULL OR failure_reason NOT IN ('cap','prices')))
      SELECT DISTINCT ON(media_group_id,status) media_group_id,status,failure_reason,http_status,provider_code,provider_message,
        requested_at,finished_at,sequence,skipped,failure_count FROM current_content
      ORDER BY media_group_id,status,sequence DESC`,
      [scope.mode, scope.accountId, settings.creativeScanModel, JSON.stringify(Object.fromEntries(content))]),
    db.query<{ succeeded: Date | null }>(`SELECT max(finished_at) AS succeeded FROM pulse.creative_scans
      WHERE mode=$1 AND account_id=$2 AND status='done'`, [scope.mode, scope.accountId]),
    db.query<any>(`SELECT 1 FROM pulse.creative_scans WHERE mode=$1 AND account_id=$2
      AND failure_reason='cap' AND retry_after>$3 LIMIT 1`, [scope.mode, scope.accountId, now]),
    scanSpendToday(db, scope, now),
    scope.mode === 'live' ? db.query<{parent:string}>(`${scoredMediaCte} SELECT parent FROM scored WHERE spend>$4`, [scope.accountId, '0000-01-01', ukToday(now), settings.creativeSpendFloorGbp]) : Promise.resolve({rows:[]}),
  ]);
  const current = attempts.rows.sort((a, b) => Number(b.sequence) - Number(a.sequence));
  const skippedGroups = new Set<string>(current.filter(row => row.skipped).map(row => row.media_group_id));
  const actionable = current.filter(row => !skippedGroups.has(row.media_group_id));
  const byGroup = new Map<string, typeof current[number]>();
  for (const row of actionable) {
    if (!byGroup.has(row.media_group_id) || row.status === 'done') byGroup.set(row.media_group_id, row);
  }
  const results = [...byGroup.values()];
  const done = new Set(results.filter(result => result.status === 'done').map(result => result.media_group_id));
  const waiting = eligible.rows.filter(row => !done.has(row.parent) && !skippedGroups.has(row.parent)).length;
  const providerLatest = actionable[0];
  const latest = providerLatest?.status === 'failed' ? providerLatest : current[0];
  const succeeded = summary.rows[0]?.succeeded;
  const scanned = results.filter(result => result.status === 'done').length;
  const failed = results.filter(result => result.status === 'failed').length;
  const skipped = skippedGroups.size;
  const reasons = new Map<string,number>();
  for (const failure of results.filter(result => result.status === 'failed')) {
    const reason = scanFailureLabel(failure.failure_reason, failure.http_status, failure.provider_code, failure.provider_message);
    reasons.set(reason,(reasons.get(reason) ?? 0)+1);
  }
  const commonReason=[...reasons].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0]?.[0];
  const message = !scanPricesReady(settings) ? 'Set the scan prices in Settings'
    : enabled && (spentGbp >= settings.creativeScanCapGbp || control.rows.length > 0)
      ? 'Daily scan cap reached; try again next UK day' : null;
  const line = enabled
    ? `Scan: on · ${scanned} scanned · ${failed} failed${skipped ? ` · ↷ ${skipped} skipped` : ''}${commonReason ? ` · ${commonReason}` : ''} · £${spentGbp.toFixed(2)} of £${settings.creativeScanCapGbp.toFixed(2)} today · ${settings.creativeScanModel}${message ? ` · ${message}` : ''}`
    : 'Scan: off';
  return { enabled, line, message, waiting, scanned, failed, skipped, skippedGroupIds: [...skippedGroups], spentGbp, capGbp: settings.creativeScanCapGbp, model: settings.creativeScanModel,
    status: !process.env.ANTHROPIC_API_KEY?.trim() ? 'waiting_for_keys'
      : providerLatest?.status === 'done' ? 'healthy' : providerLatest?.status === 'failed' ? 'error' : skipped ? 'healthy' : 'not_implemented',
    reason: latest?.failure_reason ?? null, httpStatus: latest?.http_status ?? null, providerCode: latest?.provider_code ?? null, providerMessage: latest?.provider_message ?? null,
    lastAttemptAt: latest?.requested_at ? new Date(latest.requested_at).toISOString() : null,
    lastAttemptStatus: latest && skippedGroups.has(latest.media_group_id) ? 'skipped' : latest?.status ?? null,
    lastAttemptSeconds: latest?.finished_at ? Math.round((new Date(latest.finished_at).getTime() - new Date(latest.requested_at).getTime()) / 1000) : null,
    lastSuccessAt: succeeded ? new Date(succeeded).toISOString() : null,
    consecutiveFailures: providerLatest?.status === 'failed' ? results.reduce((total, row) => total + Number(row.failure_count), 0) : 0 };
}

export function scanFailureLabel(reason: ScanFailure | null, status: number | null, code?: string | null, message?: string | null): string {
  const shape = [status ? `http ${status}` : null, code, message].filter(Boolean).join(', ');
  const label = status !== null && status >= 500 ? 'provider error' : status !== null && status >= 400 && status < 500 ? 'rejected' : reason ?? 'refused';
  return `${label}${shape ? ` (${shape})` : ''}`;
}
