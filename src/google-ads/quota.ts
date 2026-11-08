import type { Database } from '../db.js';
import { GOOGLE_HISTORY_ATTEMPTS, GOOGLE_OPERATION_LIMIT, GoogleQuotaError, googleReservedOperations, type GoogleBudgetContext } from './model.js';

/** One durable counter gates every actual searchStream attempt, including transport and OAuth retries. */
export async function consumeGoogleOperation(db: Database, account: string, now: Date, context: GoogleBudgetContext = {}): Promise<void> {
  const day = now.toISOString().slice(0, 10), reserve = context.history || context.retry ? googleReservedOperations(now) : 0;
  const result = await db.query(
    `UPDATE pulse.ad_spend_jobs SET
       operations=CASE WHEN operations_day=$2::date THEN operations+1 ELSE 1 END,
       google_history_operations=CASE WHEN operations_day=$2::date THEN google_history_operations ELSE 0 END + $3,
       google_quota_error=CASE WHEN operations_day=$2::date THEN google_quota_error ELSE NULL END,
       operations_day=$2
     WHERE source='google-ads' AND account_id=$1
       AND (CASE WHEN operations_day=$2::date THEN operations ELSE 0 END)<$4
       AND (NOT $5 OR (CASE WHEN operations_day=$2::date THEN google_history_operations ELSE 0 END)<$6)
     RETURNING operations`,
    [account, day, context.history ? 1 : 0, GOOGLE_OPERATION_LIMIT - reserve, !!context.history, GOOGLE_HISTORY_ATTEMPTS]);
  if (result.rows.length) return;
  const row = (await db.query<{operations:number;google_history_operations:number;operations_day:string|null}>(
    "SELECT operations,google_history_operations,operations_day::text FROM pulse.ad_spend_jobs WHERE source='google-ads' AND account_id=$1", [account])).rows[0];
  const used = row?.operations_day === day ? row.operations : 0;
  const reason = used >= GOOGLE_OPERATION_LIMIT ? 'daily_cap' : context.history && row?.operations_day === day && row.google_history_operations >= GOOGLE_HISTORY_ATTEMPTS ? 'history_allowance' : 'reserved';
  await db.query("UPDATE pulse.ad_spend_jobs SET google_quota_error=$2 WHERE source='google-ads' AND account_id=$1", [account, reason]);
  throw new GoogleQuotaError(reason);
}
