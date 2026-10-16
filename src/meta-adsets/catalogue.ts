import type { Database } from '../db.js';
import type { Settings } from '../settings.js';
import type { MetaSpend } from '../ad-spend/clients.js';
import { AdError } from '../ad-spend/model.js';
import { metaSpendMarket } from '../ad-spend/placement.js';

export interface AdSet {
  id: string; campaignId: string; name: string; status: string; effectiveStatus: string;
  dailyBudget: number | null; lifetimeBudget: number | null; currency: string;
  createdTime: string; updatedTime: string; learningStage: string | null;
  lastSignificantEdit: string | null; market: 'uk' | 'us' | 'unknown';
}
export interface StoredAdSet extends AdSet {
  flatBudget: boolean | null;
  firstSeen: string; lastSeen: string; lastRead: string; campaignName: string;
  owner: 'ours' | 'freelancer' | 'unassigned';
}
export const adSetOwner = (campaignId: string, settings: Pick<Settings, 'metaOwners'>): StoredAdSet['owner'] =>
  settings.metaOwners.find(row => row.campaignId === campaignId)?.owner ?? 'unassigned';
const identifier = (value: unknown) => {
  if (typeof value !== 'string' || !/^[\w-]{1,120}$/.test(value)) throw new AdError('invalid');
  return value;
};
const instant = (value: unknown) => {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new AdError('invalid');
  return new Date(value).toISOString();
};
const budget = (value: unknown): number | null => {
  if (value == null || value === '') return null;
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw new AdError('invalid');
  return Number(value);
};
export const AD_SET_FIELDS = 'id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget,created_time,updated_time,learning_stage_info';
export function parseAdSet(row: any, currency: string, settings: Settings, campaignName = ''): AdSet {
  if (!row || typeof row.name !== 'string' || row.name.length > 1000 || !/^[A-Z]{3}$/.test(currency)) throw new AdError('invalid');
  const campaignId = identifier(row.campaign_id), learning = row.learning_stage_info;
  const edit = learning?.last_sig_edit_ts == null ? null : Number(learning.last_sig_edit_ts);
  if (edit !== null && (!Number.isFinite(edit) || edit < 0)) throw new AdError('invalid');
  return {
    id: identifier(row.id), campaignId, name: row.name, status: identifier(row.status), effectiveStatus: identifier(row.effective_status),
    dailyBudget: budget(row.daily_budget), lifetimeBudget: budget(row.lifetime_budget), currency,
    createdTime: instant(row.created_time), updatedTime: instant(row.updated_time),
    learningStage: typeof learning?.status === 'string' ? learning.status.slice(0, 100) : null,
    lastSignificantEdit: edit === null ? null : new Date(edit * 1000).toISOString(),
    market: metaSpendMarket(campaignName, row.name, adSetOwner(campaignId, settings)),
  };
}
/** No effective_status filter: deleted objects are never requested or retained from the response. */
export async function fetchAdSets(meta: MetaSpend, account: string, settings: Settings): Promise<AdSet[]> {
  const { currency } = await meta.readGraph(`act_${identifier(account)}`, { fields: 'currency' });
  const rows = await meta.readAllPages(`act_${account}/adsets`, { fields: AD_SET_FIELDS, limit: '100' });
  return rows.filter(row => row.effective_status !== 'DELETED' && row.status !== 'DELETED').map(row => parseAdSet(row, currency, settings));
}
export async function saveAdSets(db: Database, account: string, rows: AdSet[], settings: Settings, now: Date, appAction?: {id:string;field:'status'|'daily_budget';value:string}): Promise<void> {
  await db.transaction(async tx => {
    const campaigns = await tx.query<{campaign_id: string; name: string}>('SELECT campaign_id,name FROM pulse.meta_campaigns WHERE account_id=$1', [account]);
    for (const row of rows) {
      const previous=(await tx.query<any>('SELECT status,daily_budget FROM pulse.meta_ad_sets WHERE account_id=$1 AND ad_set_id=$2 FOR UPDATE',[account,row.id])).rows[0];
      if(previous && adSetOwner(row.campaignId,settings)==='ours') for(const [field,value] of [['status',row.status],['daily_budget',row.dailyBudget]] as const) {
        const old=String(previous[field]??''),next=String(value??'');
        if(old===next || appAction?.id===row.id && appAction.field===field && appAction.value===next)continue;
        const own=await tx.query(`SELECT id FROM pulse.meta_actions WHERE account_id=$1 AND ad_set_id=$2 AND result='success' AND action=ANY($3::text[]) AND old_value=$4 AND new_value=$5 AND time>(SELECT last_read FROM pulse.meta_ad_sets WHERE account_id=$1 AND ad_set_id=$2) LIMIT 1`,[account,row.id,field==='status'?['pause','resume']:['budget'],old,next]);
        if(own.rowCount)continue;
        const audit=await tx.query<{id:string}>("INSERT INTO pulse.audit_log(event,occurred_at) VALUES('ad set changed outside the app',$1) RETURNING id",[now]);
        await tx.query('INSERT INTO pulse.meta_ad_set_changes(audit_id,account_id,ad_set_id,field,old_value,new_value,observed_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[audit.rows[0]!.id,account,row.id,field,old,next,now]);
      }
      const campaignName = campaigns.rows.find(c => c.campaign_id === row.campaignId)?.name ?? '';
      const market = metaSpendMarket(campaignName, row.name, adSetOwner(row.campaignId, settings));
      await tx.query(`INSERT INTO pulse.meta_ad_sets(account_id,ad_set_id,campaign_id,name,status,effective_status,daily_budget,lifetime_budget,currency,created_time,updated_time,learning_stage,last_significant_edit,market,first_seen,last_seen,last_read)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15,$15)
        ON CONFLICT(account_id,ad_set_id) DO UPDATE SET campaign_id=EXCLUDED.campaign_id,name=EXCLUDED.name,status=EXCLUDED.status,effective_status=EXCLUDED.effective_status,daily_budget=EXCLUDED.daily_budget,lifetime_budget=EXCLUDED.lifetime_budget,currency=EXCLUDED.currency,created_time=EXCLUDED.created_time,updated_time=EXCLUDED.updated_time,learning_stage=EXCLUDED.learning_stage,last_significant_edit=EXCLUDED.last_significant_edit,market=EXCLUDED.market,last_seen=EXCLUDED.last_seen,last_read=EXCLUDED.last_read`,
      [account,row.id,row.campaignId,row.name,row.status,row.effectiveStatus,row.dailyBudget,row.lifetimeBudget,row.currency,row.createdTime,row.updatedTime,row.learningStage,row.lastSignificantEdit,market,now]);
    }
    if (!appAction) await tx.query('INSERT INTO pulse.meta_ad_set_sync(account_id,last_read) VALUES($1,$2) ON CONFLICT(account_id) DO UPDATE SET last_read=EXCLUDED.last_read', [account,now]);
  });
}
export async function readAdSets(db: Database, account: string, settings: Settings): Promise<StoredAdSet[]> {
  const result = await db.query<any>(`SELECT s.*,c.name AS campaign_name FROM pulse.meta_ad_sets s LEFT JOIN pulse.meta_campaigns c ON c.account_id=s.account_id AND c.campaign_id=s.campaign_id WHERE s.account_id=$1`, [account]);
  return result.rows.map(r => ({ id:r.ad_set_id,campaignId:r.campaign_id,name:r.name,status:r.status,effectiveStatus:r.effective_status,
    flatBudget:r.flat_budget, dailyBudget:r.daily_budget == null ? null : Number(r.daily_budget),lifetimeBudget:r.lifetime_budget == null ? null : Number(r.lifetime_budget),currency:r.currency,
    createdTime:new Date(r.created_time).toISOString(),updatedTime:new Date(r.updated_time).toISOString(),learningStage:r.learning_stage,
    lastSignificantEdit:r.last_significant_edit ? new Date(r.last_significant_edit).toISOString() : null,
    market:metaSpendMarket(r.campaign_name ?? '',r.name,adSetOwner(r.campaign_id,settings)),
    owner:adSetOwner(r.campaign_id,settings),campaignName:r.campaign_name ?? '',
    firstSeen:new Date(r.first_seen).toISOString(),lastSeen:new Date(r.last_seen).toISOString(),lastRead:new Date(r.last_read).toISOString(),
  }));
}
