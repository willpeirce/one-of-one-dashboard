import type { Database } from '../db.js';
import { addDays, ukToday } from '../hero-range.js';
import type { Settings } from '../settings.js';
import { ownerFor, type SpendHourRow, type SpendRead } from './model.js';
import { spendMarket } from './placement.js';
export interface MetaHours { rows: SpendHourRow[]; polledAt: string; today: string }

/** Called inside the same transaction as the daily rows and coverage. */
export async function saveMetaHours(db: Database, account: string, from: string, to: string, rows: SpendRead, now: Date): Promise<void> {
  const today = ukToday(now), yesterday = addDays(today, -1);
  await db.query('DELETE FROM pulse.meta_spend_hours WHERE account_id=$1 AND uk_day<$2', [account, addDays(today, -2)]);
  if (!rows.hourly) return;
  const start = [from, yesterday].sort().at(-1)!, end = [to, today].sort()[0]!;
  if (start > end) return;
  await db.query('DELETE FROM pulse.meta_spend_hours WHERE account_id=$1 AND uk_day BETWEEN $2 AND $3', [account, start, end]);
  const hours = rows.hourly.filter(row => row.day >= start && row.day <= end);
  if (hours.length) await db.query(`INSERT INTO pulse.meta_spend_hours
    (account_id,campaign_id,campaign_name,ad_set_id,ad_set_name,market,owner,uk_day,uk_hour,spend_amount,currency,fetched_at,target_countries)
    SELECT $1,r.campaign_id,r.campaign_name,r.ad_set_id,r.ad_set_name,r.market,r.owner,r.day,r.hour,r.amount,r.currency,$3,r.target_countries
    FROM jsonb_to_recordset($2::jsonb) AS r(campaign_id text,campaign_name text,ad_set_id text,ad_set_name text,market text,owner text,day date,hour integer,amount numeric,currency text,target_countries jsonb)`,
    [account, JSON.stringify(hours.map(row => ({ campaign_id: row.campaignId, campaign_name: row.campaignName,
      ad_set_id: row.adSetId, ad_set_name: row.adSetName, market: spendMarket(row), owner: row.owner,
      day: row.day, hour: row.hour, amount: row.amount, currency: row.currency, target_countries:row.targetCountries ?? [] }))), now]);
  await db.query(`UPDATE pulse.ad_spend_days SET hourly_complete=true WHERE source='meta' AND account_id=$1 AND uk_day BETWEEN $2 AND $3`, [account, start, end]);
}
export async function readMetaHours(db: Database, settings: Settings, now: Date, polledAt: string | null): Promise<MetaHours | undefined> {
  const today = ukToday(now), yesterday = addDays(today, -1), account = settings.metaAdAccountId;
  if (!polledAt || ukToday(new Date(polledAt)) !== today) return undefined;
  const days = await db.query(`SELECT uk_day FROM pulse.ad_spend_days WHERE source='meta' AND account_id=$1
    AND uk_day BETWEEN $2 AND $3 AND hourly_complete AND fetched_at=$4`, [account, yesterday, today, polledAt]);
  if (days.rows.length !== 2) return undefined;
  const stored = await db.query<any>(`SELECT campaign_id,campaign_name,ad_set_id,ad_set_name,uk_day::text,uk_hour,spend_amount::text,currency,target_countries
    FROM pulse.meta_spend_hours WHERE account_id=$1 AND uk_day BETWEEN $2 AND $3 AND fetched_at=$4`, [account, yesterday, today, polledAt]);
  return { today, polledAt, rows: stored.rows.map(row => {
    const owner = ownerFor('meta', row.campaign_id, settings);
    return { source: 'meta', accountId: account, campaignId: row.campaign_id, campaignName: row.campaign_name,
      adSetId: row.ad_set_id, adSetName: row.ad_set_name, owner, targetCountries:row.target_countries,
      market: spendMarket({ source: 'meta', campaignName: row.campaign_name, adSetName: row.ad_set_name, owner, targetCountries:row.target_countries }),
      day: row.uk_day, hour: row.uk_hour, amount: row.spend_amount, currency: row.currency };
  }) };
}
