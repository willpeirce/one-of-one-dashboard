import {hqDate} from '../github-hq/model.js';
import type {SourceMode} from '../sources.js';

export const KIT_BODY_LIMIT = 256 * 1024;
export const KIT_ROW_LIMIT = 40;
export const KIT_ORDER_LIMIT = 200;
export const KIT_PARSER_VERSION = 1;
export type KitFileKind = 'kits' | 'kit-orders';
export interface KitRow {
  id: string; name: string; series: string; status: string; gate: number;
  launchTarget: string | null; launchLabel: string | null; briefDue: string | null;
  milestone: string | null; nextAction: string; owner: string; with: string;
  waitingSince: string | null; note: string;
}
export interface KitOrderRow {
  id: string; kit: string; supplier: string; item: string; qty: number | null;
  date: string | null; eta: string | null; status: string;
}
export interface KitParseResult<T> {
  readable: boolean; updatedAt: string | null; rows: T[]; skippedRows: number; cappedRows: number;
}
export interface KitFile<T> {
  status: 'ready' | 'missing' | 'pending' | 'unavailable'; updatedAt: string | null;
  readAt: string | null; skippedRows: number; cappedRows: number; rows: T[];
}
export interface KitFacts {mode: SourceMode; kits: KitFile<KitRow>; orders: KitFile<KitOrderRow>}

/** Plain bounded text only. The renderer still escapes every retained value. */
export function kitText(value: unknown, limit: number): string {
  return typeof value === 'string' ? Array.from(value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/[\u2028\u2029]/g, ' ').trim()).slice(0, limit).join('') : '';
}
const nullableText = (value: unknown, limit: number): string | null => kitText(value, limit) || null;
const date = (value: unknown): string | null => typeof value === 'string' && hqDate(value.trim()) ? value.trim() : null;
function updated(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(text)
    || !hqDate(text.slice(0, 10))) return null;
  const stamp = Date.parse(text);
  if (!Number.isFinite(stamp)) return null;
  const normalized = new Date(stamp).toISOString();
  // An offset must not turn a four-digit source date into year zero or an extended ISO year.
  return hqDate(normalized.slice(0, 10)) ? normalized : null;
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function identity(value: unknown): string | null {
  const id = kitText(value, 40);
  return /^[a-z0-9][a-z0-9_-]*$/i.test(id) ? id : null;
}
function kitRow(value: unknown): KitRow | null {
  if (!object(value)) return null;
  const id = identity(value.id), name = kitText(value.name, 40);
  if (!id || !name || !Number.isInteger(value.gate) || (value.gate as number) < 0 || (value.gate as number) > 6) return null;
  return {id, name, series: kitText(value.series, 80), status: kitText(value.status, 30), gate: value.gate as number,
    launchTarget: date(value.launch_target), launchLabel: nullableText(value.launch_label, 60), briefDue: date(value.brief_due),
    milestone: nullableText(value.milestone, 120), nextAction: kitText(value.next_action, 200), owner: kitText(value.owner, 20),
    with: kitText(value.with, 120), waitingSince: date(value.waiting_since), note: kitText(value.note, 300)};
}
function orderRow(value: unknown): KitOrderRow | null {
  if (!object(value)) return null;
  // An order has a kit name, not a separate name field in the file contract.
  const id = identity(value.id), kit = kitText(value.kit, 40);
  if (!id || !kit) return null;
  return {id, kit, supplier: kitText(value.supplier, 80), item: kitText(value.item, 160),
    qty: typeof value.qty === 'number' && Number.isInteger(value.qty) && value.qty >= 0 && value.qty <= 10_000_000 ? value.qty : null,
    date: date(value.date), eta: date(value.eta), status: kitText(value.status, 160)};
}
function parse<T extends {id: string}>(text: string, limit: number, row: (value: unknown) => T | null): KitParseResult<T> {
  const unreadable = (): KitParseResult<T> => ({readable: false, updatedAt: null, rows: [], skippedRows: 0, cappedRows: 0});
  if (new TextEncoder().encode(text).byteLength > KIT_BODY_LIMIT) return unreadable();
  let body: unknown;
  try {body = JSON.parse(text.replace(/^\uFEFF/, ''));} catch {return unreadable();}
  const values = Array.isArray(body) ? body : object(body) && Array.isArray(body.rows) ? body.rows : null;
  if (!values) return unreadable();
  const result: KitParseResult<T> = {readable: true, updatedAt: object(body) ? updated(body.updated) : null,
    rows: [], skippedRows: 0, cappedRows: 0};
  const seen = new Set<string>();
  for (const value of values) {
    const parsed = row(value);
    if (!parsed || seen.has(parsed.id)) {result.skippedRows++; continue;}
    seen.add(parsed.id);
    if (result.rows.length >= limit) result.cappedRows++;
    else result.rows.push(parsed);
  }
  return result;
}
export const parseKits = (text: string): KitParseResult<KitRow> => parse(text, KIT_ROW_LIMIT, kitRow);
export const parseKitOrders = (text: string): KitParseResult<KitOrderRow> => parse(text, KIT_ORDER_LIMIT, orderRow);
