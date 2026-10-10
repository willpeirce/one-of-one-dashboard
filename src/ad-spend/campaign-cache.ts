import type { Database } from '../db.js';
import type { MetaCampaign } from './model.js';

interface StoredMetaCampaign extends MetaCampaign {
  firstSeen: string;
  lastSeen: string;
}

export type CampaignSyncState =
  | { state: 'pending'; at: null }
  | { state: 'success'; at: string }
  | { state: 'error'; at: string; code: string };

const campaignRows = new WeakMap<Database, Map<string, Promise<StoredMetaCampaign[]>>>();
const campaignSync = new WeakMap<Database, Map<string, Exclude<CampaignSyncState, { state: 'pending' }>>>();

export function invalidateMetaCampaigns(db: Database, account?: string): void {
  if (account === undefined) campaignRows.delete(db);
  else campaignRows.get(db)?.delete(account);
}

/** Cache source facts only; ownership is applied from the current Settings on each read. */
export async function cachedMetaCampaigns(db: Database, account: string): Promise<StoredMetaCampaign[]> {
  let accounts = campaignRows.get(db);
  if (!accounts) {
    accounts = new Map();
    campaignRows.set(db, accounts);
  }
  let pending = accounts.get(account);
  if (!pending) {
    pending = db.query<{
      campaign_id: string; name: string; status: string;
      created_at: Date | string; first_seen: Date | string; last_seen: Date | string;
    }>(
      `SELECT campaign_id,name,status,created_at,first_seen,last_seen FROM pulse.meta_campaigns
      WHERE account_id=$1 ORDER BY created_at DESC,campaign_id`,
      [account],
    ).then(({ rows }) => rows.map((row) => ({
      id: row.campaign_id, name: row.name, status: row.status,
      createdAt: new Date(row.created_at).toISOString(),
      firstSeen: new Date(row.first_seen).toISOString(), lastSeen: new Date(row.last_seen).toISOString(),
    })));
    accounts.set(account, pending);
  }
  try {
    return (await pending).map((row) => ({ ...row }));
  } catch (error) {
    // A failed old read must not evict a fresh read started after invalidation.
    if (accounts.get(account) === pending) accounts.delete(account);
    throw error;
  }
}

export function recordCampaignSync(
  db: Database,
  account: string,
  result: { state: 'success' | 'error'; at: string; code?: string },
): void {
  let accounts = campaignSync.get(db);
  if (!accounts) {
    accounts = new Map();
    campaignSync.set(db, accounts);
  }
  accounts.set(account, result.state === 'error'
    ? { state: 'error', at: result.at, code: result.code ?? 'unknown' }
    : { state: 'success', at: result.at });
}

export async function storedCampaignSync(db: Database, account: string): Promise<CampaignSyncState> {
  const current = campaignSync.get(db)?.get(account);
  if (current) return { ...current };
  const rows = await cachedMetaCampaigns(db, account);
  // A completed poll takes precedence over a database read that began before it.
  const completed = campaignSync.get(db)?.get(account);
  if (completed) return { ...completed };
  const lastSeen = rows.reduce((latest, row) => row.lastSeen > latest ? row.lastSeen : latest, '');
  // Without a new migration, restart can recover successful non-empty reads only.
  return lastSeen ? { state: 'success', at: lastSeen } : { state: 'pending', at: null };
}
