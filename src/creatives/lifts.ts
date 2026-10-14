import type { Database } from '../db.js';
import { addDays, ukToday } from '../hero-range.js';
import type { Settings } from '../settings.js';
import type { SourceMode } from '../sources.js';
import { attributesForKind, resolveAttributes, type AttributeDefinition, type AttributeRow, type CreativeKind } from './attributes.js';
import { readAttributeRows } from './attribute-store.js';
import type { CreativeData } from './model.js';
import { aggregateCreativeGroups, type GroupPerformance } from './ranking.js';
import { readLiveCreativeData } from './store.js';

export type LiftConfidence = 'Hint' | 'Likely' | 'Strong';
export interface LiftSideMetrics {
  groupCount: number; spend: number; purchases: number; purchaseValue: number;
  costPerPurchase: number | null; roas: number | null; addToCartRate: number | null;
  hookRate: number | null; holdRate: number | null;
}
export interface CreativeLift {
  id: string; kind: CreativeKind; attributeKey: string; value: string;
  attributeLabel: string; valueLabel: string; label: string; confidence: LiftConfidence;
  metrics: { with: LiftSideMetrics; without: LiftSideMetrics; share: number;
    from: string; to: string; exampleGroupIds: string[] };
  computedAt: string;
}
export type CreativeLiftSettings = Pick<Settings, 'creativeLiftWindowDays' | 'creativeLiftMinimumGroups' | 'creativeLiftMinimumSpendGbp'>;
type PurchaseTotals = { spend: number; purchases: number };
const ratio = (a: number, b: number): number | null => b > 0 ? a / b : null;

/** Seeded group bootstrap: every resample keeps each side's original group count. */
export function bootstrapLiftShare(withGroups: readonly PurchaseTotals[], withoutGroups: readonly PurchaseTotals[], seed = 20261014): number {
  if (!withGroups.length || !withoutGroups.length) return 0;
  let state = seed >>> 0;
  const random = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
  const sample = (groups: readonly PurchaseTotals[]): PurchaseTotals => {
    let spend = 0, purchases = 0;
    for (let index = 0; index < groups.length; index += 1) {
      const group = groups[Math.floor(random() * groups.length)]!;
      spend += group.spend; purchases += group.purchases;
    }
    return { spend, purchases };
  };
  let held = 0;
  for (let resample = 0; resample < 200; resample += 1) {
    const a = sample(withGroups), b = sample(withoutGroups);
    // Missing purchases on either side is a failed comparison, including both zero.
    if (a.purchases > 0 && b.purchases > 0 && a.spend / a.purchases < b.spend / b.purchases) held += 1;
  }
  return held / 200;
}

export function liftConfidence(share: number): LiftConfidence | null {
  return share >= 0.95 ? 'Strong' : share >= 0.85 ? 'Likely' : share >= 0.7 ? 'Hint' : null;
}

function candidateSeed(seed: number, key: string): number {
  let result = seed >>> 0;
  for (const character of key) result = Math.imul(result ^ character.charCodeAt(0), 16777619) >>> 0;
  return result;
}

function sideMetrics(groups: readonly GroupPerformance[], kind: CreativeKind): LiftSideMetrics {
  const sum = (key: 'spend' | 'purchases' | 'purchaseValue' | 'addsToCart' | 'linkClicks' | 'threeSecondPlays' | 'impressions' | 'thruPlays') =>
    groups.reduce((total, group) => total + group.totals[key], 0);
  const spend = sum('spend'), purchases = sum('purchases'), purchaseValue = sum('purchaseValue');
  return { groupCount: groups.length, spend, purchases, purchaseValue, costPerPurchase: ratio(spend, purchases),
    roas: ratio(purchaseValue, spend), addToCartRate: ratio(sum('addsToCart'), sum('linkClicks')),
    hookRate: kind === 'video' ? ratio(sum('threeSecondPlays'), sum('impressions')) : null,
    holdRate: kind === 'video' ? ratio(sum('thruPlays'), sum('threeSecondPlays')) : null };
}

export function creativeLiftLabel(attribute: AttributeDefinition, value: string): string {
  const label = attribute.values.find(option => option.value === value)?.label ?? value;
  const name = attribute.label[0]!.toLowerCase() + attribute.label.slice(1);
  if (value === 'yes') return name;
  if (attribute.key === 'slabsShown') return `${label} ${value === '1' ? 'slab' : 'slabs'}`;
  if (['lengthBand', 'setting', 'format', 'firstSeen', 'aspect'].includes(attribute.key)) return label;
  return `${name}: ${label}`;
}

/** All resolved parents are candidates, including zero-spend parents; aggregate floors apply to each side. */
export function computeCreativeLifts(data: CreativeData, rows: readonly AttributeRow[], settings: CreativeLiftSettings,
  now = new Date(), options: { seed?: number } = {}): CreativeLift[] {
  const to = ukToday(now), from = addDays(to, 1 - settings.creativeLiftWindowDays);
  const groups = aggregateCreativeGroups(data, { from, to }).sort((a, b) => a.group.id.localeCompare(b.group.id));
  const rowsByGroup = new Map<string, AttributeRow[]>();
  for (const row of rows) {
    const values = rowsByGroup.get(row.groupId) ?? [];
    values.push(row); rowsByGroup.set(row.groupId, values);
  }
  const resolved = new Map(groups.map(group => [group.group.id,
    new Map(resolveAttributes(group.group.kind, rowsByGroup.get(group.group.id) ?? []).map(attribute => [attribute.key, attribute.value]))]));
  const lifts: CreativeLift[] = [];
  for (const kind of ['video', 'image'] as const) {
    const sameKind = groups.filter(group => group.group.kind === kind);
    for (const attribute of attributesForKind(kind)) for (const option of attribute.values) {
      const withGroups = sameKind.filter(group => resolved.get(group.group.id)?.get(attribute.key) === option.value);
      const withoutGroups = sameKind.filter(group => {
        const value = resolved.get(group.group.id)?.get(attribute.key);
        return value != null && value !== option.value;
      });
      if (withGroups.length < settings.creativeLiftMinimumGroups || withoutGroups.length < settings.creativeLiftMinimumGroups) continue;
      const withMetrics = sideMetrics(withGroups, kind), withoutMetrics = sideMetrics(withoutGroups, kind);
      if (withMetrics.spend < settings.creativeLiftMinimumSpendGbp || withoutMetrics.spend < settings.creativeLiftMinimumSpendGbp) continue;
      const share = bootstrapLiftShare(withGroups.map(group => group.totals), withoutGroups.map(group => group.totals),
        candidateSeed(options.seed ?? 20261014, `${kind}:${attribute.key}:${option.value}`));
      const confidence = liftConfidence(share);
      if (!confidence) continue;
      const exampleGroupIds = [...withGroups].filter(group => group.totals.costPerPurchase != null)
        .sort((a, b) => a.totals.costPerPurchase! - b.totals.costPerPurchase! || b.totals.purchases - a.totals.purchases || a.group.id.localeCompare(b.group.id))
        .slice(0, 2).map(group => group.group.id);
      lifts.push({ id: `lift-${kind}-${attribute.key}-${option.value}`, kind, attributeKey: attribute.key, value: option.value,
        attributeLabel: attribute.label, valueLabel: option.label, label: creativeLiftLabel(attribute, option.value), confidence,
        metrics: { with: withMetrics, without: withoutMetrics, share, from, to, exampleGroupIds }, computedAt: now.toISOString() });
    }
  }
  return lifts;
}

export function creativeLiftStorageId(account: string, mode: SourceMode, id: string): string {
  const prefix = `${mode}:${account}:`;
  return id.startsWith(prefix) ? id : `${prefix}${id}`;
}

/** Replace both kinds atomically, scoped to this account and data mode. */
export async function saveCreativeLifts(db: Database, account: string, mode: SourceMode, lifts: readonly CreativeLift[]): Promise<void> {
  await db.transaction(async tx => {
    await tx.query('DELETE FROM pulse.attribute_lifts WHERE mode=$1 AND account_id=$2', [mode, account]);
    for (const lift of lifts) await tx.query(`INSERT INTO pulse.attribute_lifts
      (id,mode,account_id,kind,attribute_key,value,metrics,confidence,computed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [creativeLiftStorageId(account, mode, lift.id), mode, account, lift.kind, lift.attributeKey, JSON.stringify(lift.value),
      JSON.stringify(lift.metrics), lift.confidence, lift.computedAt]);
  });
}

const finiteNonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
function validSide(input: unknown): input is LiftSideMetrics {
  if (!input || typeof input !== 'object') return false;
  const side = input as Record<string, unknown>;
  return ['groupCount', 'spend', 'purchases', 'purchaseValue'].every(key => finiteNonnegative(side[key]))
    && Number.isInteger(side.groupCount) && (side.groupCount as number) > 0
    && ['costPerPurchase', 'roas', 'addToCartRate', 'hookRate', 'holdRate'].every(key => side[key] === null || finiteNonnegative(side[key]));
}
function validDay(input: unknown): input is string {
  return typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input)
    && Number.isFinite(Date.parse(input)) && new Date(input).toISOString().slice(0, 10) === input;
}

/** Old or malformed rows do not produce recommendations; labels always come from the shared schema. */
export async function readCreativeLifts(db: Database, account: string, mode: SourceMode): Promise<CreativeLift[]> {
  const rows = (await db.query<any>(`SELECT id,kind,attribute_key,value,metrics,confidence,computed_at
    FROM pulse.attribute_lifts WHERE mode=$1 AND account_id=$2 ORDER BY kind,attribute_key,value::text,id`, [mode, account])).rows;
  return rows.flatMap(row => {
    if (row.kind !== 'video' && row.kind !== 'image') return [];
    const attribute = attributesForKind(row.kind).find(candidate => candidate.key === row.attribute_key);
    const option = attribute?.values.find(candidate => candidate.value === row.value);
    const metrics = row.metrics;
    if (!attribute || !option || !metrics || !validSide(metrics.with) || !validSide(metrics.without)
      || !finiteNonnegative(metrics.share) || metrics.share > 1 || liftConfidence(metrics.share) !== row.confidence
      || !validDay(metrics.from) || !validDay(metrics.to) || metrics.from > metrics.to
      || !Array.isArray(metrics.exampleGroupIds) || metrics.exampleGroupIds.length > 2
      || !metrics.exampleGroupIds.every((id: unknown) => typeof id === 'string')
      || !Number.isFinite(new Date(row.computed_at).getTime())) return [];
    return [{ id: row.id, kind: row.kind, attributeKey: attribute.key, value: option.value,
      attributeLabel: attribute.label, valueLabel: option.label, label: creativeLiftLabel(attribute, option.value),
      confidence: row.confidence, metrics, computedAt: new Date(row.computed_at).toISOString() }];
  });
}

const recomputes = new WeakMap<Database, Map<string, Promise<void>>>();

export async function recomputeCreativeLifts(db: Database, account: string, data: Pick<CreativeData, 'mode'>,
  settings: Settings, now = new Date()): Promise<CreativeLift[]> {
  // The service has one process. A queued tag save must read after the worker's prior replacement.
  let scopes = recomputes.get(db);
  if (!scopes) { scopes = new Map(); recomputes.set(db, scopes); }
  const key = JSON.stringify([data.mode, account]);
  const previous = scopes.get(key) ?? Promise.resolve();
  const work = previous.then(async () => {
    // Sample lifts are explicitly invented illustrations, not inferences from its small catalogue.
    if (data.mode === 'sample') return readCreativeLifts(db, account, data.mode);
    const [current, rows] = await Promise.all([
      readLiveCreativeData(db, { ...settings, metaAdAccountId: account }),
      readAttributeRows(db, data.mode, account),
    ]);
    const lifts = computeCreativeLifts(current, rows, settings, now);
    await saveCreativeLifts(db, account, data.mode, lifts);
    return lifts;
  });
  // A failed replacement rejects its caller but never poisons the next queued recompute.
  const settled = work.then(() => {}, () => {});
  scopes.set(key, settled);
  try { return await work; }
  finally { if (scopes.get(key) === settled) scopes.delete(key); }
}
