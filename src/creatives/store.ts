import { randomUUID } from 'node:crypto';
import type { Database } from '../db.js';
import { addDays, ukToday } from '../hero-range.js';
import type { Settings } from '../settings.js';
import type { SourceMode } from '../sources.js';
import { metaSpendMarket } from '../ad-spend/placement.js';
import { AdError } from '../ad-spend/model.js';
import { canonicalVideoTitle, type AdInsight, type CatalogueRead, type CreativeData, type CreativeReader, type MediaGroup } from './model.js';
import { sampleCreativeData } from './sample.js';
import { readScanHealth, type ScanHealth } from './scan-health.js';

const iso = (value: any) => new Date(value).toISOString();
const day = (value: any): string | null => value == null ? null : typeof value === 'string' ? value.slice(0, 10) : iso(value).slice(0, 10);
const adFields = { id: 'ad_id', accountId: 'account_id', name: 'name', status: 'status', effectiveStatus: 'effective_status', createdAt: 'created_at', adSetId: 'ad_set_id', adSetName: 'ad_set_name', campaignId: 'campaign_id', campaignName: 'campaign_name', owner: 'owner', market: 'market', creativeId: 'creative_id', creativeType: 'creative_type', mediaGroupId: 'media_group_id', body: 'body', title: 'title', callToAction: 'call_to_action', linkUrl: 'link_url', utmContent: 'utm_content', firstSpendDay: 'first_spend_day', lastSeen: 'last_seen', facebookUrl: 'facebook_url', instagramUrl: 'instagram_url', objectStoryId: 'object_story_id', instagramMediaId: 'instagram_media_id' } as const;
const insightFields = { adId: 'ad_id', adSetId: 'ad_set_id', day: 'day', spend: 'spend', impressions: 'impressions', reach: 'reach', frequency: 'frequency', linkClicks: 'link_clicks', threeSecondPlays: 'three_second_plays', threeSecondSource: 'three_second_source', plays: 'plays', thruPlays: 'thru_plays', plays25: 'plays_25', plays50: 'plays_50', plays75: 'plays_75', plays100: 'plays_100', averagePlayTime: 'average_play_time', addsToCart: 'adds_to_cart', purchases: 'purchases', purchaseValue: 'purchase_value' } as const;

export async function saveCatalogue(db: Database, account: string, entries: CatalogueRead[], now: Date, mode: SourceMode = 'live'): Promise<void> {
  await db.transaction(async tx => {
    const expandedIds: string[] = [];
    for (const entry of entries) {
      if (entry.media === null) {
        const { ad } = entry;
        await tx.query(`UPDATE pulse.ads SET name=$4,status=$5,effective_status=$6,last_seen=$7,fetched_at=$8,
          ad_set_id=$9,ad_set_name=$10,campaign_id=$11,campaign_name=$12,owner=$13,market=$14
          WHERE mode=$1 AND account_id=$2 AND ad_id=$3`,
        [mode, account, ad.id, ad.name, ad.status, ad.effectiveStatus, ad.lastSeen, now,
          ad.adSetId, ad.adSetName, ad.campaignId, ad.campaignName, ad.owner, ad.market]);
        if (entry.retryGroupId) await tx.query(`UPDATE pulse.media_groups SET detail_retry_after=$4
          WHERE mode=$1 AND account_id=$2 AND id=$3 AND detail_reduced_at IS NOT NULL`,
        [mode, account, entry.retryGroupId, new Date(now.getTime() + 86_400_000)]);
        continue;
      }
      const { ad, media } = entry;
      expandedIds.push(ad.id);
      const existing = (await tx.query<any>('SELECT id FROM pulse.media_groups WHERE mode=$1 AND account_id=$2 AND kind=$3 AND media_key=$4', [mode, account, media.kind, media.key])).rows[0];
      const id = entry.retryGroupId ?? existing?.id ?? media.id ?? randomUUID();
      if (entry.retryGroupId) {
        // Recovery updates the original row, including when a previously hidden media key is revealed.
        // An already catalogued key cannot replace its other group's identity or manual merge history.
        const changed = await tx.query(`UPDATE pulse.media_groups SET title=$4,
          length_seconds=COALESCE($5,length_seconds),width=COALESCE($6,width),height=COALESCE($7,height),
          thumbnail=COALESCE($8,thumbnail),poster=COALESCE($9,poster),
          frames=CASE WHEN cardinality($10::bytea[])>0 THEN $10::bytea[] ELSE frames END,
          alternates=$11,fetched_at=$12,detail_reduced_at=NULL,detail_retry_after=NULL,
          kind=CASE WHEN $15 THEN $13 ELSE kind END,media_key=CASE WHEN $15 THEN $14 ELSE media_key END,
          source_id=CASE WHEN $15 THEN $14 ELSE source_id END
          WHERE mode=$1 AND account_id=$2 AND id=$3`,
        [mode, account, id, media.title, media.lengthSeconds, media.width, media.height, media.thumbnail, media.poster,
          media.frames, JSON.stringify(media.alternates), now, media.kind, media.key, !existing || existing.id === id]);
        if (!changed.rowCount) throw new AdError('invalid');
      } else await tx.query(`INSERT INTO pulse.media_groups(id,mode,account_id,source_id,kind,media_key,title,length_seconds,width,height,first_seen,fetched_at,thumbnail,poster,frames,alternates,detail_reduced_at,detail_retry_after)
        VALUES($1,$2,$3,$4,$5,$4,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
        ON CONFLICT(mode,account_id,kind,media_key) DO UPDATE SET title=EXCLUDED.title,length_seconds=COALESCE(EXCLUDED.length_seconds,pulse.media_groups.length_seconds),width=COALESCE(EXCLUDED.width,pulse.media_groups.width),height=COALESCE(EXCLUDED.height,pulse.media_groups.height),fetched_at=EXCLUDED.fetched_at,thumbnail=COALESCE(EXCLUDED.thumbnail,pulse.media_groups.thumbnail),poster=COALESCE(EXCLUDED.poster,pulse.media_groups.poster),frames=CASE WHEN cardinality(EXCLUDED.frames)>0 THEN EXCLUDED.frames ELSE pulse.media_groups.frames END,alternates=EXCLUDED.alternates,
          detail_reduced_at=CASE WHEN $18 THEN CASE WHEN EXCLUDED.detail_reduced_at IS NULL THEN NULL ELSE COALESCE(pulse.media_groups.detail_reduced_at,EXCLUDED.detail_reduced_at) END ELSE pulse.media_groups.detail_reduced_at END,
          detail_retry_after=CASE WHEN $18 THEN EXCLUDED.detail_retry_after ELSE pulse.media_groups.detail_retry_after END`,
      [id, mode, account, media.key, media.kind, media.title, media.lengthSeconds, media.width, media.height, media.firstSeen, now, media.thumbnail, media.poster, media.frames, JSON.stringify(media.alternates), media.detailReducedAt ?? null,
        media.detailReducedAt ? new Date(now.getTime() + 86_400_000) : null, media.detailReducedAt !== undefined]);
      if (!existing && !entry.retryGroupId && media.kind === 'video') {
        const others = (await tx.query<any>("SELECT id,title,length_seconds FROM pulse.media_groups WHERE mode=$1 AND account_id=$2 AND kind='video' AND id<>$3 AND merged_into_id IS NULL ORDER BY first_seen,id", [mode, account, id])).rows;
        const title = canonicalVideoTitle(media.title);
        const parent = others.find((r: any) => (title && title === canonicalVideoTitle(r.title)) || (media.lengthSeconds != null && r.length_seconds != null && Math.abs(media.lengthSeconds - Number(r.length_seconds)) <= 0.100001));
        if (parent) {
          await tx.query('UPDATE pulse.media_groups SET merged_into_id=$2 WHERE id=$1', [id, parent.id]);
          await tx.query("INSERT INTO pulse.media_merges(id,account_id,group_id,parent_id,action,who,created_at) VALUES($1,$2,$3,$4,'rule','meta-rule',$5)", [randomUUID(), account, id, parent.id, now]);
        }
      }
      const record = { ...ad, accountId: account, mediaGroupId: id, firstSpendDay: null };
      const fields = Object.entries(adFields).filter(([key]) => key !== 'firstSpendDay');
      const columns = fields.map(([, col]) => col), values = fields.map(([key]) => (record as any)[key]);
      await tx.query(`INSERT INTO pulse.ads(mode,source_id,fetched_at,${columns.join(',')}) VALUES($1,$2,$3,${values.map((_, i) => `$${i + 4}`).join(',')}) ON CONFLICT(mode,account_id,ad_id) DO UPDATE SET ${columns.filter(col => col !== 'ad_id' && col !== 'account_id').map(col => `${col}=EXCLUDED.${col}`).join(',')},fetched_at=EXCLUDED.fetched_at`, [mode, ad.id, now, ...values]);
    }
    if (expandedIds.length) await tx.query(`UPDATE pulse.ads a SET first_spend_day=(SELECT min(day) FROM pulse.ad_insights_daily i WHERE i.mode=a.mode AND i.account_id=a.account_id AND i.ad_id=a.ad_id AND i.spend>0) WHERE a.mode=$1 AND a.account_id=$2 AND a.ad_id=ANY($3::text[])`, [mode, account, expandedIds]);
  });
}

export async function saveInsights(db: Database, account: string, from: string, to: string, rows: AdInsight[], now: Date, next?: string, mode: SourceMode = 'live'): Promise<void> {
  await db.transaction(async tx => {
    await tx.query('DELETE FROM pulse.ad_insights_daily WHERE mode=$1 AND account_id=$2 AND day BETWEEN $3 AND $4', [mode, account, from, to]);
    const fields = Object.entries(insightFields), columns = fields.map(([,col]) => col);
    for (const row of rows) {
      if (row.day < from || row.day > to) throw new AdError('invalid');
      const values = fields.map(([key]) => (row as any)[key]);
      await tx.query(`INSERT INTO pulse.ad_insights_daily(mode,account_id,source_id,fetched_at,${columns.join(',')}) VALUES($1,$2,$3,$4,${values.map((_,i) => `$${i + 5}`).join(',')})`, [mode, account, `${row.adId}:${row.day}`, now, ...values]);
    }
    await tx.query(`UPDATE pulse.ads a SET first_spend_day=(SELECT min(day) FROM pulse.ad_insights_daily i WHERE i.mode=a.mode AND i.account_id=a.account_id AND i.ad_id=a.ad_id AND i.spend>0) WHERE a.mode=$1 AND a.account_id=$2`, [mode, account]);
    if (mode === 'live') {
      await tx.query(`INSERT INTO pulse.creative_insight_days(account_id,day,fetched_at) SELECT $1,day,$4 FROM generate_series($2::date,$3::date,interval '1 day') day ON CONFLICT(account_id,day) DO UPDATE SET fetched_at=EXCLUDED.fetched_at`, [account, from, to, now]);
      if (next) await tx.query('UPDATE pulse.creative_jobs SET backfill_next=$2 WHERE account_id=$1', [account, next]);
    }
  });
}

export async function readCreativeData(db: Database, settings: Settings, env: NodeJS.ProcessEnv, now = new Date()): Promise<CreativeData> {
  if (!env.META_ACCESS_TOKEN || !settings.metaAdAccountId) {
    const data = sampleCreativeData(settings, now);
    const stored = (await db.query<any>("SELECT id,merged_into_id FROM pulse.media_groups WHERE mode='sample' AND account_id='sample-meta-account'")).rows;
    for (const group of data.groups) {
      const row = stored.find(r => r.id === group.id);
      if (row) group.mergedIntoId = row.merged_into_id;
    }
    return data;
  }
  return readLiveCreativeData(db,settings);
}

export async function readLiveCreativeData(db: Database, settings: Settings): Promise<CreativeData> {
  const account = settings.metaAdAccountId;
  const [ads, groups, insights, frequency] = await Promise.all([
    db.query<any>(`SELECT ${Object.entries(adFields).map(([key,col]) => `${col} AS "${key}"`).join(',')} FROM pulse.ads WHERE mode='live' AND account_id=$1`, [account]),
    db.query<any>("SELECT id,kind,media_key AS key,title,length_seconds,width,height,first_seen,merged_into_id,alternates FROM pulse.media_groups WHERE mode='live' AND account_id=$1 ORDER BY first_seen DESC,id", [account]),
    db.query<any>(`SELECT ${Object.entries(insightFields).map(([key,col]) => `${col} AS "${key}"`).join(',')} FROM pulse.ad_insights_daily WHERE mode='live' AND account_id=$1`, [account]),
    db.query<any>('SELECT ad_ids,from_day::text,to_day::text,frequency FROM pulse.creative_frequencies WHERE account_id=$1',[account]),
  ]);
  return { mode: 'live', frequencyReads: frequency.rows.map(r => ({adIds:r.ad_ids,from:r.from_day,to:r.to_day,frequency:r.frequency == null ? null : Number(r.frequency)})), ads: ads.rows.map(r => { const owner = settings.metaOwners.find(rule => rule.campaignId === r.campaignId)?.owner ?? 'unassigned'; return { ...r, owner, market: metaSpendMarket(r.campaignName, r.adSetName, owner), createdAt: iso(r.createdAt), lastSeen: iso(r.lastSeen), firstSpendDay: day(r.firstSpendDay) }; }),
    groups: groups.rows.map(r => ({ id:r.id, kind:r.kind, key:r.key, title:r.title, lengthSeconds:r.length_seconds == null ? null : Number(r.length_seconds), width:r.width, height:r.height, firstSeen:iso(r.first_seen), mergedIntoId:r.merged_into_id, alternates:r.alternates, thumbnailUrl:`/media/${encodeURIComponent(r.id)}` })),
    insights: insights.rows.map(r => Object.fromEntries(Object.entries(r).map(([key,value]) => [key, key === 'day' ? day(value) : ['adId','adSetId','threeSecondSource'].includes(key) ? value : Number(value)])) as unknown as AdInsight),
  };
}

function resolveParent(rows: any[], id: string): string {
  const seen = new Set<string>();
  while (true) {
    if (seen.has(id)) throw new AdError('invalid');
    seen.add(id);
    const row = rows.find(r => r.id === id);
    if (!row) throw new AdError('invalid');
    if (!row.merged_into_id) return id;
    id = row.merged_into_id;
  }
}
async function changeMerge(db: Database, account: string, groupId: string, parentId: string | null, who: string, now: Date): Promise<string> {
  return db.transaction(async tx => {
    const groups = (await tx.query<any>('SELECT id,kind,mode,merged_into_id FROM pulse.media_groups WHERE account_id=$1 FOR UPDATE', [account])).rows;
    const child = groups.find(r => r.id === groupId);
    if (!child || child.kind !== 'video') throw new AdError('invalid');
    const parent = parentId ? resolveParent(groups, parentId) : null;
    if (parent && (parent === groupId || groups.find(r => r.id === parent)?.kind !== 'video' || groups.find(r => r.id === parent)?.mode !== child.mode)) throw new AdError('invalid');
    const id = randomUUID();
    await tx.query('UPDATE pulse.media_groups SET merged_into_id=$2 WHERE id=$1', [groupId, parent]);
    await tx.query('INSERT INTO pulse.media_merges(id,account_id,group_id,parent_id,previous_parent_id,action,who,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [id,account,groupId,parent,child.merged_into_id,parent ? 'merge' : 'split',who,now]);
    return id;
  });
}
export const mergeMediaGroups = (db: Database, account: string, childId: string, parentId: string, who: string, now = new Date()) => changeMerge(db,account,childId,parentId,who,now);
export const splitMediaGroup = (db: Database, account: string, groupId: string, who: string, now = new Date()) => changeMerge(db,account,groupId,null,who,now);
export async function undoMediaMerge(db: Database, account: string, mergeId: string, who: string, now = new Date()): Promise<void> {
  await db.transaction(async tx => {
    const rows = (await tx.query<any>('SELECT id,merged_into_id FROM pulse.media_groups WHERE account_id=$1 FOR UPDATE', [account])).rows;
    const action = (await tx.query<any>("SELECT * FROM pulse.media_merges WHERE id=$1 AND account_id=$2 AND action IN ('merge','split') AND undone_at IS NULL", [mergeId,account])).rows[0];
    if (!action) throw new AdError('invalid');
    const latest = (await tx.query<any>("SELECT id FROM pulse.media_merges WHERE group_id=$1 AND undone_at IS NULL AND action IN ('merge','split') ORDER BY sequence DESC LIMIT 1", [action.group_id])).rows[0];
    if (latest?.id !== mergeId) throw new AdError('invalid');
    if (action.previous_parent_id && resolveParent(rows, action.previous_parent_id) === action.group_id) throw new AdError('invalid');
    await tx.query('UPDATE pulse.media_groups SET merged_into_id=$2 WHERE id=$1', [action.group_id,action.previous_parent_id]);
    await tx.query('UPDATE pulse.media_merges SET undone_at=$2,undone_by=$3 WHERE id=$1', [mergeId,now,who]);
  });
}

export async function mediaBytesUsed(db: Database, account: string): Promise<number> {
  return Number((await db.query<any>(`SELECT COALESCE(sum(COALESCE(octet_length(thumbnail),0)+COALESCE(octet_length(poster),0)+COALESCE(octet_length(full_image),0)+(SELECT COALESCE(sum(octet_length(f)),0) FROM unnest(frames) f)),0) AS bytes FROM pulse.media_groups WHERE account_id=$1`, [account])).rows[0]?.bytes ?? 0);
}
export async function enforceMediaCap(db: Database, account: string, capMb: number): Promise<void> {
  const cap = Math.floor(capMb * 1024 * 1024);
  let used = await mediaBytesUsed(db, account);
  if (used <= cap) return;
  const groups = (await db.query<any>(`SELECT id,COALESCE(octet_length(thumbnail),0) AS thumbnail,COALESCE(octet_length(poster),0) AS poster,COALESCE(octet_length(full_image),0) AS full_image,(SELECT COALESCE(sum(octet_length(f)),0) FROM unnest(frames) f) AS frames FROM pulse.media_groups WHERE account_id=$1 ORDER BY last_opened_at NULLS FIRST,first_seen,id`, [account])).rows;
  // Sources are durable Meta IDs (including post:/creative: thumbnail fallbacks), so any
  // evicted bytes can be read again without persisting an expiring URL or a credential.
  for (const column of ['frames','full_image','poster','thumbnail']) for (const group of groups) {
    if (used <= cap) return;
    const size = Number(group[column]);
    if (!size) continue;
    await db.query(`UPDATE pulse.media_groups SET ${column}=${column === 'frames' ? "'{}'" : 'NULL'} WHERE id=$1`, [group.id]);
    used -= size;
  }
}
export interface StoredMedia { bytes: Uint8Array; mime: string; kind: 'image'|'video'; key: string }
export async function readMedia(db: Database, account: string, groupId: string, full = false): Promise<StoredMedia | null> {
  const r = (await db.query<any>('SELECT thumbnail,full_image,full_image_mime,kind,media_key FROM pulse.media_groups WHERE account_id=$1 AND id=$2', [account,groupId])).rows[0];
  if (!r) return null;
  const bytes = full ? r.full_image : r.thumbnail;
  if (!bytes) return null;
  await db.query('UPDATE pulse.media_groups SET last_opened_at=$2 WHERE id=$1', [groupId,new Date()]);
  return { bytes, mime:full ? r.full_image_mime ?? 'image/jpeg' : 'image/jpeg', kind:r.kind, key:r.media_key };
}
export async function ensureGroupMedia(client: CreativeReader, db: Database, account: string, id: string, capMb: number, full = false): Promise<StoredMedia | null> {
  const stored = await readMedia(db,account,id,full);
  const group = (await db.query<any>('SELECT kind,media_key,cardinality(frames) AS count FROM pulse.media_groups WHERE account_id=$1 AND id=$2', [account,id])).rows[0];
  if (!group) return null;
  const fallbackImage = async (): Promise<Uint8Array> => {
    const ad = (await db.query<any>('SELECT creative_id FROM pulse.ads WHERE account_id=$1 AND media_group_id=$2 ORDER BY last_seen DESC LIMIT 1', [account,id])).rows[0];
    if (!ad) throw new AdError('invalid');
    return client.imageBytes(account,`creative:${ad.creative_id}`,full);
  };
  if (group.kind === 'video') {
    if (!group.count) {
      try {
        const frames = await client.videoFrames(group.media_key);
        await db.query('UPDATE pulse.media_groups SET frames=$2,thumbnail=COALESCE(thumbnail,$3),poster=COALESCE(poster,$3) WHERE id=$1', [id,frames,frames.find(frame => frame[0] === 0xff && frame[1] === 0xd8) ?? null]);
      } catch(error) {
        if (!stored && !group.media_key.includes(':')) throw error;
      }
    }
    if (!stored && !full && !await readMedia(db,account,id)) {
      const bytes = await fallbackImage();
      await db.query('UPDATE pulse.media_groups SET thumbnail=$2,poster=COALESCE(poster,$2) WHERE id=$1',[id,bytes]);
    }
  } else if (!stored) {
    const bytes = await client.imageBytes(account,group.media_key,full).catch(fallbackImage);
    const column = full ? 'full_image' : 'thumbnail';
    await db.query(`UPDATE pulse.media_groups SET ${column}=$2${full ? ",full_image_mime='image/jpeg'" : ''} WHERE id=$1`, [id,bytes]);
  }
  const result = stored ?? await readMedia(db,account,id,full);
  await enforceMediaCap(db,account,capMb);
  return result;
}

export function reconciliationLine(gaps: { percent: number; day: string }[]): string | null {
  const significant = gaps.filter(r => r.percent > 1);
  if (!significant.length) return null;
  const days = new Set(significant.map(r => r.day)).size;
  return `Meta ad-level spend differs from ad set spend by ${Math.max(...significant.map(r => r.percent)).toFixed(1)}% on ${days} ${days === 1 ? 'day' : 'days'}`;
}
export async function reducedDetailCount(db: Database, account: string, mode: SourceMode = 'live'): Promise<number> {
  return Number((await db.query<any>('SELECT count(*) FROM pulse.media_groups WHERE mode=$1 AND account_id=$2 AND detail_reduced_at IS NOT NULL', [mode, account])).rows[0]?.count ?? 0);
}
export interface CreativeHealth { catalogueCount: number; reducedCount: number; backfillNext: string | null; backfillDone: boolean; completedDays: number; totalDays: number; bytes: number; capBytes: number; lastSuccessAt: string | null; reconciliation: string | null; error: string | null; mode: SourceMode; scan?: ScanHealth }
export async function creativeHealth(db: Database, settings: Settings, env: NodeJS.ProcessEnv, now = new Date()): Promise<CreativeHealth> {
  const account = settings.metaAdAccountId, mode = env.META_ACCESS_TOKEN && account ? 'live' : 'sample';
  const scan = await readScanHealth(db,settings,{ accountId: mode === 'sample' ? 'sample-meta-account' : account, mode, now });
  if (mode === 'sample') return {mode,scan,catalogueCount:sampleCreativeData(settings,now).ads.length,reducedCount:await reducedDetailCount(db,'sample-meta-account','sample'),backfillNext:null,backfillDone:true,completedDays:0,totalDays:0,bytes:await mediaBytesUsed(db,'sample-meta-account'),capBytes:settings.creativeMediaCapMb*1024*1024,lastSuccessAt:null,reconciliation:null,error:null};
  const [job, count, coverage, gaps, bytes, reducedCount] = await Promise.all([
    db.query<any>('SELECT *,backfill_next::text FROM pulse.creative_jobs WHERE account_id=$1',[account]),
    db.query<any>("SELECT count(*) FROM pulse.ads WHERE mode='live' AND account_id=$1",[account]),
    db.query<any>('SELECT count(*) FROM pulse.creative_insight_days WHERE account_id=$1',[account]),
    db.query<any>(`WITH ads AS (SELECT day,ad_set_id,sum(spend) AS spend FROM pulse.ad_insights_daily WHERE mode='live' AND account_id=$1 GROUP BY day,ad_set_id), sets AS (SELECT uk_day AS day,ad_set_id,sum(spend_amount) AS spend FROM pulse.ad_spend WHERE mode='live' AND source='meta' AND account_id=$1 GROUP BY uk_day,ad_set_id)
      SELECT COALESCE(a.day,s.day)::text AS day,CASE WHEN COALESCE(s.spend,0)=0 THEN CASE WHEN COALESCE(a.spend,0)=0 THEN 0 ELSE 100 END ELSE abs(COALESCE(a.spend,0)-s.spend)/s.spend*100 END AS percent
      FROM ads a FULL JOIN sets s ON a.day=s.day AND a.ad_set_id=s.ad_set_id
      JOIN pulse.creative_insight_days c ON c.account_id=$1 AND c.day=COALESCE(a.day,s.day)
      JOIN pulse.ad_spend_days d ON d.source='meta' AND d.account_id=$1 AND d.uk_day=COALESCE(a.day,s.day)`,[account]),
    mediaBytesUsed(db,account),
    reducedDetailCount(db,account),
  ]);
  const j = job.rows[0];
  return {mode,scan,catalogueCount:Number(count.rows[0]?.count ?? 0),reducedCount,backfillNext:j?.backfill_next ?? null,backfillDone:j?.backfill_done ?? false,completedDays:Number(coverage.rows[0]?.count ?? 0),totalDays:Math.max(0,Math.round((Date.parse(ukToday(now))-Date.parse('2026-08-07'))/86400000)+1),bytes,capBytes:settings.creativeMediaCapMb*1024*1024,lastSuccessAt:j?.last_success_at ? iso(j.last_success_at) : null,reconciliation:reconciliationLine(gaps.rows.map(r => ({day:r.day,percent:Number(r.percent)}))),error:j?.error_code ?? null};
}
