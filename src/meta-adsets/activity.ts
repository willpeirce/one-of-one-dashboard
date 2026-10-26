import { createHash } from 'node:crypto';
import type { Database } from '../db.js';
import type { Settings } from '../settings.js';
import { addDays, ukToday } from '../hero-range.js';
import { formatUkTime } from '../uk-time.js';
import { AdError, adErrorCode } from '../ad-spend/model.js';

export const ACTIVITY_FIELDS = 'event_type,translated_event_type,actor_id,actor_name,application_name,object_id,object_name,object_type,event_time,extra_data';
const kept = new Set(['update_ad_set_budget','update_campaign_budget','update_ad_set_run_status','update_campaign_run_status']);
export interface MetaActivity {
  id: string; type: string; time: string; actorId: string; actor: string; app: string;
  objectId: string; object: string; objectType: string; old: string; value: string;
  oldPence: number | null; newPence: number | null; currency: string | null; budgetLabel: string | null;
}
const label = (v: unknown) => typeof v === 'string' ? v.slice(0,1000) : '';
function amount(v: unknown): number | null {
  return /^\d+$/.test(String(v)) && Number.isSafeInteger(Number(v)) ? Number(v) : null;
}
export function parseActivity(row: any): MetaActivity | null {
  if (!kept.has(row?.event_type)) return null;
  if (!Number.isFinite(Date.parse(row.event_time))) throw new AdError('invalid');
  let extra: any;
  try { extra = typeof row.extra_data === 'string' ? JSON.parse(row.extra_data) : row.extra_data; }
  catch { throw new AdError('invalid'); }
  const budget = row.event_type.endsWith('_budget');
  const old = extra?.old_value, next = extra?.new_value;
  const oldPence = budget ? amount(old?.old_value ?? old?.value ?? old) : null;
  const newPence = budget ? amount(next?.new_value ?? next?.value ?? next) : null;
  const currency = budget ? label(next?.currency ?? old?.currency) || null : null;
  const budgetLabel = budget ? label(next?.additional_value ?? old?.additional_value) || null : null;
  const display = (v: any, pence: number | null, side: 'old_value'|'new_value') => budget
    ? pence === null ? 'Unknown' : `${currency ?? ''} ${(pence/100).toFixed(2)}${budgetLabel ? ` · ${budgetLabel}` : ''}`
    : label(typeof v === 'object' ? v?.[side] ?? v?.value ?? v?.status : v) || 'Unknown';
  const event = { type: row.event_type as string, time:new Date(row.event_time).toISOString(),actorId:label(row.actor_id),actor:label(row.actor_name),app:label(row.application_name),
    objectId:label(row.object_id),object:label(row.object_name),objectType:label(row.object_type),
    old:display(old,oldPence,'old_value'),value:display(next,newPence,'new_value'),oldPence,newPence,currency,budgetLabel };
  // The activities edge has no event ID. Identity excludes mutable display names.
  const id = createHash('sha256').update(JSON.stringify([event.type,event.time,event.actorId,event.objectId,event.old,event.value,event.app])).digest('hex');
  return { id,...event };
}
export interface ActivityView { events: (MetaActivity & { ours: boolean; ukTime: string })[]; notOurs: number; line: string }
export async function syncActivity(db: Database, account: string, read: (since: number) => Promise<MetaActivity[]>, now: Date): Promise<void> {
  try {
    const newest = (await db.query<{newest:Date|null}>('SELECT max(event_time) AS newest FROM pulse.meta_activity WHERE account_id=$1',[account])).rows[0]?.newest;
    const since = Math.floor((newest ? new Date(newest).getTime() : now.getTime()-30*86_400_000)/1000);
    const events = await read(since);
    await db.transaction(async tx => {
      for (const event of events) await tx.query(`INSERT INTO pulse.meta_activity(account_id,event_id,event_time,data,fetched_at)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(account_id,event_id) DO NOTHING`,[account,event.id,event.time,JSON.stringify(event),now]);
      await tx.query(`INSERT INTO pulse.meta_activity_sync(account_id,last_attempt,last_success,error) VALUES($1,$2,$2,NULL)
        ON CONFLICT(account_id) DO UPDATE SET last_attempt=$2,last_success=$2,error=NULL`,[account,now]);
    });
  } catch (error) {
    const code = adErrorCode(error,'meta');
    await db.query(`INSERT INTO pulse.meta_activity_sync(account_id,last_attempt,error) VALUES($1,$2,$3)
      ON CONFLICT(account_id) DO UPDATE SET last_attempt=$2,error=$3`,[account,now,code]);
    console.error(`Meta activity read failed (${code}).`);
  }
}
export async function readActivity(db: Database, account: string, settings: Settings, now: Date): Promise<ActivityView> {
  const [rows,sync] = await Promise.all([
    db.query<{data:MetaActivity}>('SELECT data FROM pulse.meta_activity WHERE account_id=$1 AND event_time>=($2::date::timestamp AT TIME ZONE \'Europe/London\') AND event_time<=$3 ORDER BY event_time DESC,event_id',[account,addDays(ukToday(now),-6),now]),
    db.query<{last_success:Date|null;error:string|null}>('SELECT last_success,error FROM pulse.meta_activity_sync WHERE account_id=$1',[account]),
  ]);
  const events = rows.rows.map(({data})=>({...data,ours:settings.ourActors.some(a=>a.actorId===data.actorId),ukTime:formatUkTime(data.time)}));
  const state=sync.rows[0];
  return {events,notOurs:events.filter(e=>!e.ours).length,line:state?.error ? `Meta activity: read refused · ${state.error}`
    : state?.last_success ? `Meta activity: last read ${formatUkTime(state.last_success)}` : 'Meta activity: waiting for first read'};
}
