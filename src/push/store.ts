import type { Database } from '../db.js';
import type { PushSendResult } from './sender.js';
import type { PushSubscription } from './validation.js';

export interface StoredPushSubscription extends PushSubscription {
  credentialId: string;
  createdAt: string;
  lastSuccessAt: string | null;
  failures: number;
}

export async function readPushSubscriptions(db: Database, credentialId?: string): Promise<StoredPushSubscription[]> {
  const result = await db.query<{
    endpoint: string; p256dh: string; auth: string; credential_id: string;
    created_at: Date | string; last_success_at: Date | string | null; failures: number;
  }>(`SELECT endpoint,p256dh,auth,credential_id,created_at,last_success_at,failures FROM pulse.push_subscriptions
    ${credentialId === undefined ? '' : 'WHERE credential_id=$1'} ORDER BY created_at,endpoint`, credentialId === undefined ? [] : [credentialId]);
  return result.rows.map(row => ({endpoint: row.endpoint, keys: {p256dh: row.p256dh, auth: row.auth},
    credentialId: row.credential_id, createdAt: new Date(row.created_at).toISOString(),
    lastSuccessAt: row.last_success_at ? new Date(row.last_success_at).toISOString() : null, failures: row.failures}));
}

export async function savePushSubscription(db: Database, credentialId: string, subscription: PushSubscription, now: Date): Promise<void> {
  await db.transaction(async tx => {
    // Endpoints can move between credentials. One local lock also makes the ten-device cap atomic.
    await tx.query('SELECT pg_advisory_xact_lock(1668244583,hashtext($1))', ['push-subscriptions']);
    const saved = await tx.query(`INSERT INTO pulse.push_subscriptions(endpoint,p256dh,auth,credential_id,created_at)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(endpoint) DO UPDATE SET
      created_at=CASE WHEN push_subscriptions.credential_id=EXCLUDED.credential_id THEN push_subscriptions.created_at ELSE EXCLUDED.created_at END,
      last_success_at=CASE WHEN push_subscriptions.credential_id=EXCLUDED.credential_id AND push_subscriptions.p256dh=EXCLUDED.p256dh
        AND push_subscriptions.auth=EXCLUDED.auth THEN push_subscriptions.last_success_at ELSE NULL END,
      failures=CASE WHEN push_subscriptions.credential_id=EXCLUDED.credential_id AND push_subscriptions.p256dh=EXCLUDED.p256dh
        AND push_subscriptions.auth=EXCLUDED.auth THEN push_subscriptions.failures ELSE 0 END,
      p256dh=EXCLUDED.p256dh,auth=EXCLUDED.auth,credential_id=EXCLUDED.credential_id
      WHERE (push_subscriptions.credential_id,push_subscriptions.p256dh,push_subscriptions.auth)
        IS DISTINCT FROM (EXCLUDED.credential_id,EXCLUDED.p256dh,EXCLUDED.auth) RETURNING endpoint`,
    [subscription.endpoint,subscription.keys.p256dh,subscription.keys.auth,credentialId,now]);
    if (!saved.rowCount) return;
    await tx.query(`DELETE FROM pulse.push_subscriptions WHERE endpoint IN
      (SELECT endpoint FROM pulse.push_subscriptions WHERE credential_id=$1 ORDER BY created_at DESC,endpoint DESC OFFSET 10)`, [credentialId]);
    await tx.query('INSERT INTO pulse.audit_log(event,credential_id,occurred_at) VALUES($1,$2,$3)', ['Push notifications enabled',credentialId,now]);
  });
}

export async function removePushSubscription(db: Database, endpoint: string, credentialId?: string): Promise<void> {
  await db.transaction(async tx => {
    await tx.query('DELETE FROM pulse.push_subscriptions WHERE endpoint=$1' + (credentialId === undefined ? '' : ' AND credential_id=$2'),
      credentialId === undefined ? [endpoint] : [endpoint,credentialId]);
    if (credentialId !== undefined) await tx.query('INSERT INTO pulse.audit_log(event,credential_id) VALUES($1,$2)', ['Push notifications disabled',credentialId]);
  });
}

export async function recordPushResult(db: Database, subscription: StoredPushSubscription, result: PushSendResult, now: Date): Promise<void> {
  // A result belongs to the snapshot sent. A late 404 must not delete a refreshed registration.
  const where = 'endpoint=$1 AND p256dh=$2 AND auth=$3 AND credential_id=$4 AND created_at=$5';
  const values: unknown[] = [subscription.endpoint,subscription.keys.p256dh,subscription.keys.auth,subscription.credentialId,subscription.createdAt];
  if (result.outcome === 'gone') await db.query(`DELETE FROM pulse.push_subscriptions WHERE ${where}`, values);
  else if (result.outcome === 'sent') await db.query(`UPDATE pulse.push_subscriptions SET last_success_at=$6,failures=0 WHERE ${where}`, [...values,now]);
  else await db.query(`UPDATE pulse.push_subscriptions SET failures=least(failures::bigint+1,2147483647)::integer WHERE ${where}`, values);
}

export async function claimPushDay(db: Database, kind: string, day: string, now: Date): Promise<boolean> {
  const result = await db.query(`INSERT INTO pulse.push_sent(kind,uk_day,claimed_at) VALUES($1,$2,$3)
    ON CONFLICT(kind,uk_day) DO NOTHING RETURNING kind`, [kind,day,now]);
  return result.rowCount === 1;
}
