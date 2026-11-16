import type { Database } from '../db.js';
import { ukToday } from '../hero-range.js';
import { ALERT_CHECK_IDS, type AlertCheckId, type AlertEvaluation } from './alert-types.js';
import { ALERT_MIN_INTERVAL_MS, inAlertQuietHours, monthlyUploadPayload, observeAlert, watchdogAlertPayload,
  type AlertQuietHours, type AlertState, type KnownAlertStatus } from './alerts.js';
import type { PushPayload } from './sender.js';
import { readPushSubscriptions, type StoredPushSubscription } from './store.js';

interface CheckRow extends Record<string, unknown> {
  check_id: AlertCheckId; evaluation_id: string; raw_status: AlertState['rawStatus']; candidate_status: KnownAlertStatus | null;
  candidate_count: number; confirmed_status: KnownAlertStatus | null; revision: string | number; transition_quiet: boolean;
}
const stateFromRow = (row: CheckRow): AlertState => ({evaluationId: row.evaluation_id, rawStatus: row.raw_status,
  candidateStatus: row.candidate_status, candidateCount: row.candidate_count, confirmedStatus: row.confirmed_status,
  revision: Number(row.revision), transitionQuiet: row.transition_quiet});

async function saveEvaluation(db: Database, input: AlertEvaluation, quiet: boolean): Promise<Map<AlertCheckId, AlertState>> {
  if (!input.evaluationId || input.evaluationId.length > 128) throw new Error('Invalid alert evaluation.');
  return db.transaction(async tx => {
    await tx.query('SELECT pg_advisory_xact_lock(1668244583,hashtext($1))', ['push-alert-observations']);
    const previous = new Map((await tx.query<CheckRow>('SELECT * FROM pulse.push_alert_checks')).rows.map(row => [row.check_id, stateFromRow(row)]));
    const next = new Map<AlertCheckId, AlertState>();
    for (const id of ALERT_CHECK_IDS) {
      const state = observeAlert(previous.get(id) ?? null, input.checks.find(check => check.id === id)?.status ?? 'unknown', input.evaluationId, quiet);
      next.set(id, state);
      await tx.query(`INSERT INTO pulse.push_alert_checks(check_id,evaluation_id,raw_status,candidate_status,candidate_count,
        confirmed_status,revision,transition_quiet) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(check_id) DO UPDATE SET
        evaluation_id=EXCLUDED.evaluation_id,raw_status=EXCLUDED.raw_status,candidate_status=EXCLUDED.candidate_status,
        candidate_count=EXCLUDED.candidate_count,confirmed_status=EXCLUDED.confirmed_status,revision=EXCLUDED.revision,
        transition_quiet=EXCLUDED.transition_quiet`,
      [id,state.evaluationId,state.rawStatus,state.candidateStatus,state.candidateCount,state.confirmedStatus,state.revision,state.transitionQuiet]);
    }
    return next;
  });
}

/** Match the registration, not just its endpoint: a replacement must not inherit a queued push. */
export async function alertDeviceCurrent(db: Database, subscription: StoredPushSubscription, lock = false): Promise<boolean> {
  return (await db.query(`SELECT 1 FROM pulse.push_subscriptions WHERE endpoint=$1 AND credential_id=$2 AND created_at=$3
    AND p256dh=$4 AND auth=$5 AND alerts_enabled=true${lock ? ' FOR SHARE' : ''}`,
  [subscription.endpoint,subscription.credentialId,subscription.createdAt,subscription.keys.p256dh,subscription.keys.auth])).rowCount === 1;
}

interface DeviceRow extends Record<string, unknown> {
  credential_id: string; subscription_created_at: Date | string; revision: string | number;
  acknowledged_status: KnownAlertStatus; last_sent_at: Date | string | null;
}
async function claimCheck(db: Database, subscription: StoredPushSubscription, id: AlertCheckId,
  state: AlertState, quiet: boolean, now: Date, fresh: boolean): Promise<boolean> {
  if (state.confirmedStatus === null) return false;
  const status = state.confirmedStatus;
  return db.transaction(async tx => {
    if (!await alertDeviceCurrent(tx, subscription, true)) return false;
    const current = (await tx.query<CheckRow>('SELECT * FROM pulse.push_alert_checks WHERE check_id=$1 FOR SHARE', [id])).rows[0];
    if (!current || current.evaluation_id !== state.evaluationId || Number(current.revision) !== state.revision || current.raw_status !== state.rawStatus
      || current.candidate_count !== state.candidateCount || current.confirmed_status !== status) return false;
    // Serializes initialization as well as updates across workers sharing the database.
    await tx.query('SELECT pg_advisory_xact_lock(1668244583,hashtext($1))', [`push-alert-device:${subscription.endpoint}`]);
    const row = (await tx.query<DeviceRow>(`SELECT credential_id,subscription_created_at,revision,acknowledged_status,last_sent_at
      FROM pulse.push_alert_devices WHERE check_id=$1 AND endpoint=$2 FOR UPDATE`, [id,subscription.endpoint])).rows[0];
    if (!row || row.credential_id !== subscription.credentialId || new Date(row.subscription_created_at).toISOString() !== subscription.createdAt) {
      await tx.query(`INSERT INTO pulse.push_alert_devices(check_id,endpoint,credential_id,subscription_created_at,revision,acknowledged_status)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(check_id,endpoint) DO UPDATE SET credential_id=EXCLUDED.credential_id,
        subscription_created_at=EXCLUDED.subscription_created_at,revision=EXCLUDED.revision,acknowledged_status=EXCLUDED.acknowledged_status,
        last_sent_at=NULL,last_sent_status=NULL`, [id,subscription.endpoint,subscription.credentialId,subscription.createdAt,state.revision,status]);
      return false;
    }
    if (Number(row.revision) >= state.revision) return false;
    // A return to the acknowledged state needs no notice. Quiet recovery is consumed forever.
    if (row.acknowledged_status === status || status === 'pass' && (quiet || state.transitionQuiet)) {
      await tx.query('UPDATE pulse.push_alert_devices SET revision=$3,acknowledged_status=$4 WHERE check_id=$1 AND endpoint=$2',
        [id,subscription.endpoint,state.revision,status]);
      return false;
    }
    if (!fresh || quiet || state.rawStatus !== status || state.candidateStatus !== status || state.candidateCount < 2
      || row.last_sent_at && now.getTime() - new Date(row.last_sent_at).getTime() < ALERT_MIN_INTERVAL_MS) return false;
    // Claim before transport. An uncertain delivery is never automatically repeated after restart.
    await tx.query(`UPDATE pulse.push_alert_devices SET revision=$3,acknowledged_status=$4,last_sent_status=$4,last_sent_at=$5
      WHERE check_id=$1 AND endpoint=$2`, [id,subscription.endpoint,state.revision,status,now]);
    return true;
  });
}

async function claimMonth(db: Database, subscription: StoredPushSubscription, now: Date): Promise<boolean> {
  return db.transaction(async tx => {
    if (!await alertDeviceCurrent(tx, subscription, true)) return false;
    const claimed = await tx.query(`INSERT INTO pulse.push_alert_months(endpoint,credential_id,subscription_created_at,uk_month,claimed_at)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(endpoint,uk_month) DO UPDATE SET credential_id=EXCLUDED.credential_id,
      subscription_created_at=EXCLUDED.subscription_created_at,claimed_at=EXCLUDED.claimed_at
      WHERE push_alert_months.credential_id<>EXCLUDED.credential_id OR push_alert_months.subscription_created_at<>EXCLUDED.subscription_created_at
      RETURNING endpoint`, [subscription.endpoint,subscription.credentialId,subscription.createdAt,`${ukToday(now).slice(0,7)}-01`,now]);
    return claimed.rowCount === 1;
  });
}

/** Invoked inside the existing single delivery queue; it creates no timer or outbound transport. */
export async function deliverAlerts(db: Database, input: AlertEvaluation, hours: AlertQuietHours, now: Date,
  deliver: (subscription: StoredPushSubscription, payload: PushPayload) => Promise<void>, clock: () => Date = () => now): Promise<void> {
  const evaluatedAt = new Date(input.evaluationId.replace(/^stale:/u, ''));
  const states = await saveEvaluation(db, input, inAlertQuietHours(Number.isFinite(evaluatedAt.getTime()) ? evaluatedAt : now, hours));
  const subscriptions = (await readPushSubscriptions(db)).filter(row => row.alertsEnabled);
  for (const subscription of subscriptions) {
    for (const id of ALERT_CHECK_IDS) {
      const state = states.get(id)!;
      if (state.evaluationId !== input.evaluationId) continue;
      const at = clock(), quiet = inAlertQuietHours(at, hours);
      const age = at.getTime() - evaluatedAt.getTime();
      // A slow batch must not extend the loader's two-minute freshness guarantee.
      const fresh = Number.isFinite(age) && age >= 0 && age <= 120_000;
      if (await claimCheck(db, subscription, id, state, quiet, at, fresh)) {
        // Use only the fixed watchdog's generated explanation, never arbitrary needs text.
        const why = input.checks.find(check => check.id === id)?.why ?? '';
        await deliver(subscription, watchdogAlertPayload(id, state.confirmedStatus!, why, at));
      }
    }
    const at = clock();
    const age = at.getTime() - now.getTime();
    if (age >= 0 && age <= 120_000 && ukToday(at).slice(0,7) === ukToday(now).slice(0,7)
      && !inAlertQuietHours(at, hours) && input.monthlyUploadOpen && await claimMonth(db, subscription, at))
      await deliver(subscription, monthlyUploadPayload(at));
  }
}
