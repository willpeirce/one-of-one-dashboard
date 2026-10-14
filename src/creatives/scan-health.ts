import type { Database } from '../db.js';
import type { Settings } from '../settings.js';
import type { SourceMode, SourceStatus } from '../sources.js';
import { ukToday } from '../hero-range.js';
import { creativeFeatureFlags } from './config.js';

export type ScanFailure = 'refused' | 'malformed' | 'timeout' | 'cap' | 'network' | 'prices';
export interface ScanScope { accountId: string; mode: SourceMode }
export interface ScanHealth {
  enabled: boolean; line: string; message: string | null;
  scanned: number; failed: number; spentGbp: number; capGbp: number; model: string;
  status: SourceStatus; reason: ScanFailure | null; httpStatus: number | null;
  lastAttemptAt: string | null; lastSuccessAt: string | null; consecutiveFailures: number;
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
  const [results, summary, last, control, spentGbp] = await Promise.all([
    db.query<{ status: 'done' | 'failed' }>(`SELECT DISTINCT ON(s.media_group_id) s.status
      FROM pulse.creative_scans s JOIN pulse.media_groups g
        ON g.id=s.media_group_id AND g.mode=s.mode AND g.account_id=s.account_id
      WHERE s.mode=$1 AND s.account_id=$2 AND s.model_id=$3 AND g.merged_into_id IS NULL
        AND (s.failure_reason IS NULL OR s.failure_reason NOT IN ('cap','prices'))
      ORDER BY s.media_group_id,s.sequence DESC`, [scope.mode, scope.accountId, settings.creativeScanModel]),
    db.query<any>(`SELECT max(requested_at) AS attempted,max(finished_at) FILTER(WHERE status='done') AS succeeded,
      count(*) FILTER(WHERE status='failed' AND sequence>COALESCE((SELECT max(sequence)
        FROM pulse.creative_scans WHERE mode=$1 AND account_id=$2 AND status='done'),0)) AS failures
      FROM pulse.creative_scans WHERE mode=$1 AND account_id=$2
        AND (failure_reason IS NULL OR failure_reason NOT IN ('cap','prices'))`, [scope.mode, scope.accountId]),
    db.query<any>(`SELECT status,failure_reason,http_status FROM pulse.creative_scans
      WHERE mode=$1 AND account_id=$2 AND (failure_reason IS NULL OR failure_reason NOT IN ('cap','prices'))
      ORDER BY sequence DESC LIMIT 1`, [scope.mode, scope.accountId]),
    db.query<any>(`SELECT 1 FROM pulse.creative_scans WHERE mode=$1 AND account_id=$2
      AND failure_reason='cap' AND retry_after>$3 LIMIT 1`, [scope.mode, scope.accountId, now]),
    scanSpendToday(db, scope, now),
  ]);
  const row = summary.rows[0], latest = last.rows[0];
  const scanned = results.rows.filter(result => result.status === 'done').length;
  const failed = results.rows.filter(result => result.status === 'failed').length;
  const message = !scanPricesReady(settings) ? 'Set the scan prices in Settings'
    : enabled && (spentGbp >= settings.creativeScanCapGbp || control.rows.length > 0)
      ? 'Daily scan cap reached; try again next UK day' : null;
  const line = enabled
    ? `Scan: on · ${scanned} scanned · ${failed} failed · £${spentGbp.toFixed(2)} of £${settings.creativeScanCapGbp.toFixed(2)} today · ${settings.creativeScanModel}${message ? ` · ${message}` : ''}`
    : 'Scan: off';
  return { enabled, line, message, scanned, failed, spentGbp, capGbp: settings.creativeScanCapGbp, model: settings.creativeScanModel,
    status: !process.env.ANTHROPIC_API_KEY?.trim() ? 'waiting_for_keys'
      : latest?.status === 'done' ? 'healthy' : latest?.status === 'failed' ? 'error' : 'not_implemented',
    reason: latest?.failure_reason ?? null, httpStatus: latest?.http_status ?? null,
    lastAttemptAt: row?.attempted ? new Date(row.attempted).toISOString() : null,
    lastSuccessAt: row?.succeeded ? new Date(row.succeeded).toISOString() : null,
    consecutiveFailures: Number(row?.failures ?? 0) };
}
