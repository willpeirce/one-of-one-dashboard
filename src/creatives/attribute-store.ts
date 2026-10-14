import { randomUUID } from 'node:crypto';
import type { Database } from '../db.js';
import type { SourceMode } from '../sources.js';
import { AdError } from '../ad-spend/model.js';
import type { CreativeAd, MediaGroup } from './model.js';
import {
  deterministicAttributeValues, resolveAttribute, resolveAttributes, validAttributeValue, validateAttributeValues,
  type AttributeRow, type AttributeSource, type AttributeValue, type CreativeKind, type ResolvedAttribute,
} from './attributes.js';

interface GroupRow {
  id: string; kind: CreativeKind; merged_into_id: string | null;
  length_seconds: number | string | null; width: number | null; height: number | null;
  alternates: MediaGroup['alternates'];
}
function parentOf(groups: readonly GroupRow[], groupId: string): GroupRow {
  const seen = new Set<string>();
  let current = groupId;
  while (!seen.has(current)) {
    seen.add(current);
    const group = groups.find(row => row.id === current);
    if (!group) break;
    if (!group.merged_into_id) return group;
    current = group.merged_into_id;
  }
  throw new AdError('invalid');
}
async function groupsInScope(db: Database, mode: SourceMode, account: string, lock = false): Promise<GroupRow[]> {
  return (await db.query<any>(`SELECT id,kind,merged_into_id,length_seconds,width,height,alternates
    FROM pulse.media_groups WHERE mode=$1 AND account_id=$2${lock ? ' FOR UPDATE' : ''}`, [mode, account])).rows;
}
async function scopedParent(db: Database, mode: SourceMode, account: string, groupId: string, lock = false): Promise<GroupRow> {
  return parentOf(await groupsInScope(db, mode, account, lock), groupId);
}
const noteText = (note: string) => [...note].slice(0, 200).join('');

/** Invalid persisted values never escape to a display, filter, queue or lift. */
export async function readAttributeRows(db: Database, mode: SourceMode, account: string, groupId?: string): Promise<AttributeRow[]> {
  const parent = groupId ? await scopedParent(db, mode, account, groupId) : null;
  const rows = (await db.query<any>(`SELECT a.media_group_id,a.attribute_key,a.source,a.value,a.recorded_at,g.kind
    FROM pulse.media_attributes a JOIN pulse.media_groups g ON g.id=a.media_group_id AND g.mode=a.mode AND g.account_id=a.account_id
    WHERE a.mode=$1 AND a.account_id=$2${parent ? ' AND a.media_group_id=$3' : ''}`,
  parent ? [mode, account, parent.id] : [mode, account])).rows;
  return rows.flatMap(row => {
    if (row.attribute_key === 'note' && row.source === 'will') {
      const raw = typeof row.value === 'string' ? row.value : row.value?.value;
      return typeof raw === 'string' && raw.length ? [{ groupId: row.media_group_id, key: 'note', source: 'will' as const,
        value: { value: noteText(raw) }, recordedAt: new Date(row.recorded_at).toISOString() }] : [];
    }
    const value = validAttributeValue(row.kind, row.attribute_key, row.source, row.value);
    return value ? [{ groupId: row.media_group_id, key: row.attribute_key, source: row.source,
      value, recordedAt: new Date(row.recorded_at).toISOString() }] : [];
  });
}

export async function readGroupAttributes(db: Database, mode: SourceMode, account: string, groupId: string, kind?: CreativeKind): Promise<ResolvedAttribute[]> {
  const parent = await scopedParent(db, mode, account, groupId);
  if (kind && kind !== parent.kind) throw new AdError('invalid');
  return resolveAttributes(parent.kind, await readAttributeRows(db, mode, account, parent.id));
}

async function insertValues(db: Database, mode: SourceMode, account: string,
  rows: { groupId: string; key: string; source: AttributeSource; value: AttributeValue }[], now: Date): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += 100) {
    const values: unknown[] = [];
    const placeholders = rows.slice(offset, offset + 100).map(row => {
      const start = values.length;
      values.push(randomUUID(), mode, account, row.groupId, row.key, JSON.stringify(row.value), row.source, now);
      return `(${Array.from({ length: 8 }, (_, index) => `$${start + index + 1}`).join(',')})`;
    });
    await db.query(`INSERT INTO pulse.media_attributes(id,mode,account_id,media_group_id,attribute_key,value,source,recorded_at)
      VALUES ${placeholders.join(',')} ON CONFLICT(mode,account_id,media_group_id,attribute_key,source)
      DO UPDATE SET value=EXCLUDED.value,recorded_at=EXCLUDED.recorded_at`, values);
  }
}

export async function replaceSourceAttributes(db: Database, mode: SourceMode, account: string, groupId: string,
  source: 'meta' | 'model', input: Record<string, unknown>, now = new Date()): Promise<{ kept: number; dropped: number }> {
  return db.transaction(async tx => {
    const parent = await scopedParent(tx, mode, account, groupId, true);
    const { values, dropped } = validateAttributeValues(parent.kind, source, input);
    await tx.query('DELETE FROM pulse.media_attributes WHERE mode=$1 AND account_id=$2 AND media_group_id=$3 AND source=$4',
      [mode, account, parent.id, source]);
    await insertValues(tx, mode, account, Object.entries(values).map(([key, value]) => ({ groupId: parent.id, key, source, value })), now);
    return { kept: Object.keys(values).length, dropped };
  });
}

/** One account-wide replacement retains Will/model rows and follows merged parents. */
export async function recomputeMetaAttributes(db: Database, mode: SourceMode, account: string, now = new Date()): Promise<void> {
  await db.transaction(async tx => {
    const groups = await groupsInScope(tx, mode, account, true);
    const ads = (await tx.query<any>(`SELECT ad_id AS id,created_at AS "createdAt",body,title,call_to_action AS "callToAction",media_group_id
      FROM pulse.ads WHERE mode=$1 AND account_id=$2`, [mode, account])).rows;
    const byParent = new Map<string, Pick<CreativeAd, 'id' | 'createdAt' | 'body' | 'title' | 'callToAction'>[]>();
    for (const ad of ads) {
      const parent = parentOf(groups, ad.media_group_id).id;
      const siblings = byParent.get(parent) ?? [];
      siblings.push({ id: ad.id, createdAt: new Date(ad.createdAt).toISOString(), body: ad.body, title: ad.title, callToAction: ad.callToAction });
      byParent.set(parent, siblings);
    }
    const rows: { groupId: string; key: string; source: 'meta'; value: AttributeValue }[] = [];
    for (const parent of groups.filter(group => !group.merged_into_id)) {
      const group = { kind: parent.kind, lengthSeconds: parent.length_seconds == null ? null : Number(parent.length_seconds),
        width: parent.width, height: parent.height, alternates: parent.alternates };
      const values = deterministicAttributeValues(group, byParent.get(parent.id) ?? []);
      for (const [key, value] of Object.entries(values)) rows.push({ groupId: parent.id, key, source: 'meta', value: { value } });
    }
    await tx.query("DELETE FROM pulse.media_attributes WHERE mode=$1 AND account_id=$2 AND source='meta'", [mode, account]);
    await insertValues(tx, mode, account, rows, now);
  });
}

/** The same selected pill clears Will's answer; other sources are left in place. */
export async function toggleWillAttribute(db: Database, mode: SourceMode, account: string, groupId: string,
  key: string, value: string, now = new Date()): Promise<ResolvedAttribute> {
  return db.transaction(async tx => {
    const parent = await scopedParent(tx, mode, account, groupId, true);
    const answer = validAttributeValue(parent.kind, key, 'will', value);
    if (!answer) throw new AdError('invalid');
    const rows = await readAttributeRows(tx, mode, account, parent.id);
    const selected = resolveAttribute(parent.kind, key, rows)!;
    if (selected.willValue === answer.value) {
      await tx.query("DELETE FROM pulse.media_attributes WHERE mode=$1 AND account_id=$2 AND media_group_id=$3 AND attribute_key=$4 AND source='will'",
        [mode, account, parent.id, key]);
    } else {
      await insertValues(tx, mode, account, [{ groupId: parent.id, key, source: 'will', value: answer }], now);
    }
    return resolveAttribute(parent.kind, key, await readAttributeRows(tx, mode, account, parent.id))!;
  });
}

export async function saveWillNote(db: Database, mode: SourceMode, account: string, groupId: string, note: string, now = new Date()): Promise<string> {
  return db.transaction(async tx => {
    const parent = await scopedParent(tx, mode, account, groupId, true);
    const value = noteText(note);
    if (value.trim()) await insertValues(tx, mode, account, [{ groupId: parent.id, key: 'note', source: 'will', value: { value } }], now);
    else await tx.query("DELETE FROM pulse.media_attributes WHERE mode=$1 AND account_id=$2 AND media_group_id=$3 AND attribute_key='note' AND source='will'", [mode, account, parent.id]);
    return value.trim() ? value : '';
  });
}

export async function readWillNote(db: Database, mode: SourceMode, account: string, groupId: string): Promise<string> {
  const row = (await readAttributeRows(db, mode, account, groupId)).find(attribute => attribute.key === 'note' && attribute.source === 'will');
  return row ? (row.value as AttributeValue).value : '';
}
