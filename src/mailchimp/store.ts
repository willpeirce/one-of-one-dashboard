import { promises as fs } from 'node:fs';
import type { Database } from '../db.js';
import { appConfig } from '../config.js';
import { MAILCHIMP_FRESH_MS, parseMailchimpAudience, parseMailchimpCampaign, parseMailchimpOrder, parseMailchimpReport,
  type MailchimpAudience, type MailchimpFacts } from './model.js';

async function loadSampleFacts(): Promise<MailchimpFacts> {
  const fixture = async (name: string) => JSON.parse(await fs.readFile(new URL(`../../test/fixtures/mailchimp/${name}.json`, import.meta.url), 'utf8')) as Record<string, unknown>;
  const [audience, campaigns, report, orders] = await Promise.all([fixture('audience'), fixture('campaigns'), fixture('report'), fixture('orders')]);
  return {mode: 'sample', status: 'sample', fetchedAt: '2026-11-05T12:00:00.000Z', audience: parseMailchimpAudience(audience), flowCoverage: 'unknown',
    campaigns: (campaigns.campaigns as unknown[]).map(parseMailchimpCampaign), reports: [parseMailchimpReport(report)],
    orders: (orders.orders as unknown[]).map(parseMailchimpOrder)};
}

let sample: Promise<MailchimpFacts> | undefined;
async function sampleFacts(): Promise<MailchimpFacts> {
  // Share the first read, including concurrent requests and a failed fixture load.
  sample ??= loadSampleFacts().catch(() => {
    console.error('Mailchimp sample data unavailable (code: fixture).');
    return {mode: 'sample', status: 'unavailable', fetchedAt: null, audience: null,
      flowCoverage: 'unknown', campaigns: [], reports: [], orders: []};
  });
  return structuredClone(await sample);
}

export async function readMailchimpFacts(db: Database, mode: 'sample' | 'live', now: Date): Promise<MailchimpFacts> {
  if (mode === 'sample') return sampleFacts();
  const row = (await db.query<{data: MailchimpAudience | null; fetched_at: Date | null; last_error: string | null; failures: number | null}>(
    `SELECT r.data, r.fetched_at, s.last_error, s.failures
      FROM (SELECT 1) seed
      LEFT JOIN pulse.mailchimp_records r ON r.mode='live' AND r.kind='audience' AND r.source_id=$1
      LEFT JOIN pulse.mailchimp_sync s ON s.mode='live'`, [appConfig.mailchimp.listId])).rows[0];
  const age = row?.fetched_at ? now.getTime() - row.fetched_at.getTime() : null;
  return {mode, status: row?.last_error || row?.failures || (age !== null && (age < 0 || age > MAILCHIMP_FRESH_MS)) ? 'unavailable' : row?.data ? 'live' : 'pending',
    fetchedAt: row?.fetched_at?.toISOString() ?? null, audience: row?.data ?? null,
    flowCoverage: 'unknown', campaigns: [], reports: [], orders: []};
}

export async function mailchimpNextRun(db: Database): Promise<number> {
  const row = (await db.query<{next_run_at: Date}>("SELECT next_run_at FROM pulse.mailchimp_sync WHERE mode='live'")).rows[0];
  return row?.next_run_at.getTime() ?? 0;
}

/** Re-project stored health once after listen; a restart is not a new external read. */
export async function restoreMailchimpHealth(db: Database, now: Date): Promise<void> {
  const row = (await db.query<{data: MailchimpAudience | null; fetched_at: Date | null; last_success_at: Date | null;
    last_attempt_at: Date; last_error: string | null; failures: number}>(
    `SELECT r.data,r.fetched_at,s.last_success_at,s.last_attempt_at,s.last_error,s.failures
      FROM pulse.mailchimp_sync s LEFT JOIN pulse.mailchimp_records r
      ON r.mode=s.mode AND r.kind='audience' AND r.source_id=$1 WHERE s.mode='live'`, [appConfig.mailchimp.listId])).rows[0];
  if (!row) return;
  let valid = false;
  try {
    if (row.data) {
      const audience = parseMailchimpAudience({id: row.data.id, stats: {total_contacts: row.data.contacts,
        member_count: row.data.subscribers, unsubscribe_count: row.data.unsubscribed, cleaned_count: row.data.cleaned}});
      valid = audience.id === appConfig.mailchimp.listId;
    }
  } catch { /* Corrupt or incompatible stored data cannot prove a healthy source. */ }
  const age = row.fetched_at ? now.getTime() - row.fetched_at.getTime() : null;
  const healthy = valid && row.last_success_at !== null && age !== null && age >= 0 && age <= MAILCHIMP_FRESH_MS
    && !row.last_error && row.failures === 0;
  await db.query(`UPDATE pulse.source_health SET status=$1,last_success_at=$2,last_attempt_at=$3,
    consecutive_failures=$4,updated_at=$5 WHERE source='mailchimp' AND mode='live'`,
  [healthy ? 'healthy' : 'error', row.last_success_at, row.last_attempt_at, row.failures, now]);
}

export async function saveMailchimpAudience(db: Database, audience: MailchimpAudience, now: Date, nextRun: Date): Promise<void> {
  await db.transaction(async tx => {
    await tx.query(`INSERT INTO pulse.mailchimp_records(mode,kind,source_id,data,fetched_at)
      VALUES('live','audience',$1,$2,$3) ON CONFLICT(mode,kind,source_id)
      DO UPDATE SET data=EXCLUDED.data,fetched_at=EXCLUDED.fetched_at`, [audience.id, JSON.stringify(audience), now]);
    await tx.query(`INSERT INTO pulse.mailchimp_sync(mode,next_run_at,last_success_at,last_attempt_at)
      VALUES('live',$1,$2,$2) ON CONFLICT(mode) DO UPDATE SET next_run_at=EXCLUDED.next_run_at,
      last_success_at=EXCLUDED.last_success_at,last_attempt_at=EXCLUDED.last_attempt_at,last_error=NULL,failures=0`, [nextRun, now]);
    await tx.query(`UPDATE pulse.source_health SET status='healthy',last_success_at=$1,last_attempt_at=$1,
      consecutive_failures=0,updated_at=$1 WHERE source='mailchimp' AND mode='live'`, [now]);
  });
}

export async function recordMailchimpFailure(db: Database, now: Date, nextRun: Date, code: string): Promise<void> {
  await db.transaction(async tx => {
    await tx.query(`INSERT INTO pulse.mailchimp_sync(mode,next_run_at,last_attempt_at,last_error,failures)
      VALUES('live',$1,$2,$3,1) ON CONFLICT(mode) DO UPDATE SET next_run_at=EXCLUDED.next_run_at,
      last_attempt_at=EXCLUDED.last_attempt_at,last_error=EXCLUDED.last_error,failures=mailchimp_sync.failures+1`, [nextRun, now, code]);
    await tx.query(`UPDATE pulse.source_health SET status='error',last_attempt_at=$1,
      consecutive_failures=consecutive_failures+1,updated_at=$1 WHERE source='mailchimp' AND mode='live'`, [now]);
  });
}
