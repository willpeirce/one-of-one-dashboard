import { appConfig } from '../config.js';
import type { Database } from '../db.js';
import { addDays, ukToday } from '../hero-range.js';
import { ShopifyError } from '../shopify/http.js';
import { cleanInventory, reportRows, type Inventory } from '../shopify/model.js';
import { originalSeriesProductId, originalSeriesSku, seriesMarket, type Series } from './series.js';
import type { SeriesPaceDay, SeriesPaceMarket } from './model.js';

export interface StockSnapshot {
  day: string; locationId: string; inventoryItemId: string; available: number; takenAt: string; late: boolean;
}
export interface SeriesPaceMarketFacts { stock: number | null; days: SeriesPaceDay[]; snapshots: StockSnapshot[] }
export type SeriesPaceFacts = Record<SeriesPaceMarket, SeriesPaceMarketFacts>;
const markets = ['UK', 'US'] as const;
const locations = { UK: appConfig.shopify.locations.uk.id, US: appConfig.shopify.locations.us.id };
export function seriesPaceQuery(from: string, to: string, sku = originalSeriesSku): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(sku)) throw new ShopifyError('invalid');
  return `FROM sales SHOW net_items_sold WHERE product_variant_sku = '${sku}' GROUP BY shipping_country TIMESERIES day SINCE ${from} UNTIL ${to}`;
}
const countryNames = new Intl.DisplayNames(['en'], { type: 'region' });
const ukCountries = ['GB', 'JE', 'GG', 'IM', ...appConfig.shopify.euCountries];
export function seriesPaceCountry(country: unknown): SeriesPaceMarket | null {
  if (typeof country !== 'string') return null;
  if (['US', 'United States'].includes(country)) return 'US';
  return ukCountries.some(code => country === code || country === countryNames.of(code)) ? 'UK' : null;
}
export function parseSeriesPaceSales(table: unknown, from: string, to: string): (SeriesPaceDay & { market: SeriesPaceMarket })[] {
  const totals = new Map<string, SeriesPaceDay & { market: SeriesPaceMarket }>();
  for (const row of reportRows(table)) {
    const day = row.day;
    if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0, 10) !== day || day < from || day > to) throw new ShopifyError('invalid');
    const market = seriesPaceCountry(row.shipping_country);
    if (!market) continue;
    if (!['number', 'string'].includes(typeof row.net_items_sold) || !/^-?\d+$/.test(String(row.net_items_sold)) || !Number.isSafeInteger(Number(row.net_items_sold))) throw new ShopifyError('invalid');
    const key = `${market}:${day}`, total = totals.get(key) ?? { market, day, sold: 0, source: 'shopifyql' as const };
    total.sold += Number(row.net_items_sold);
    if (!Number.isSafeInteger(total.sold)) throw new ShopifyError('invalid');
    totals.set(key, total);
  }
  return [...totals.values()];
}
export async function saveSeriesPaceSales(db: Database, table: unknown, from: string, to: string, now: Date, sku = originalSeriesSku): Promise<void> {
  const rows = parseSeriesPaceSales(table, from, to);
  // Unknown days remain absent, including when a failed report follows a good one.
  if (!rows.length) return;
  if (sku !== originalSeriesSku) {
    await db.query(`INSERT INTO pulse.series_sku_sales (day, market, sold, fetched_at, sku)
      SELECT day::date, market, sold, $4, $5 FROM unnest($1::text[], $2::text[], $3::int[]) AS r(day, market, sold)
      ON CONFLICT (sku, market, day) DO UPDATE SET sold = EXCLUDED.sold, fetched_at = EXCLUDED.fetched_at`,
    [rows.map(row => row.day), rows.map(row => row.market), rows.map(row => row.sold), now, sku]);
    return;
  }
  await db.query(`INSERT INTO pulse.series_pace_sales (day, market, sold, fetched_at)
    SELECT day::date, market, sold, $4 FROM unnest($1::text[], $2::text[], $3::int[]) AS r(day, market, sold)
    ON CONFLICT (market, day) DO UPDATE SET sold = EXCLUDED.sold, fetched_at = EXCLUDED.fetched_at`,
  [rows.map(row => row.day), rows.map(row => row.market), rows.map(row => row.sold), now]);
}
export function snapshotIsLate(now: Date, caughtUp = false): boolean {
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: appConfig.timezone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(now);
  return caughtUp || time > '02:00:00';
}
export async function takeStockSnapshot(db: Database, rows: any[], now: Date, caughtUp = false, sku = originalSeriesSku): Promise<void> {
  const day = ukToday(now), late = snapshotIsLate(now, caughtUp);
  const stocks = rows.filter(row => row.sku === sku && (sku !== originalSeriesSku || row.productId === originalSeriesProductId) && row.location).map(row => cleanInventory(row, [sku])).filter((row): row is Inventory => row !== null);
  const snapshots = markets.flatMap(market => {
    const matching = stocks.filter(row => row.locationId === locations[market]);
    // One kit inventory item per location; an absent second warehouse stays unknown.
    if (!matching.length) return [];
    if (matching.length !== 1) throw new ShopifyError('invalid');
    const stock = matching[0]!, available = stock.quantities.find(quantity => quantity.name === 'available')?.quantity;
    if (available === undefined) throw new ShopifyError('invalid');
    return [{ locationId: stock.locationId, inventoryItemId: stock.inventoryItemId, available }];
  });
  if (!snapshots.length) throw new ShopifyError('invalid');
  if (sku !== originalSeriesSku) {
    await db.query(`INSERT INTO pulse.series_stock_snapshots (day, location_id, inventory_item_id, available, taken_at, late, sku)
      SELECT $1::date, location, item, available, $5, $6, $7 FROM unnest($2::text[], $3::text[], $4::int[]) AS r(location, item, available)
      ON CONFLICT (sku, location_id, day) DO NOTHING`,
    [day, snapshots.map(row => row.locationId), snapshots.map(row => row.inventoryItemId), snapshots.map(row => row.available), now, late, sku]);
    return;
  }
  await db.query(`INSERT INTO pulse.stock_snapshots (day, location_id, inventory_item_id, available, taken_at, late)
    SELECT $1::date, location, item, available, $5, $6 FROM unnest($2::text[], $3::text[], $4::int[]) AS r(location, item, available)
    ON CONFLICT (location_id, day) DO NOTHING`,
  [day, snapshots.map(row => row.locationId), snapshots.map(row => row.inventoryItemId), snapshots.map(row => row.available), now, late]);
}
export async function readSeriesPaceFacts(db: Database, now: Date, sku = originalSeriesSku): Promise<SeriesPaceFacts> {
  const today = ukToday(now), from = addDays(today, -7), to = addDays(today, -1);
  // Keep these sequential: callers may supply a transaction connection.
  // Older records without a SKU stay unknown until the next inventory poll.
  const inventory = await db.query<{ data: Inventory }>(`SELECT data FROM pulse.shopify_records WHERE mode = 'live' AND kind = 'inventory' AND data->>'sku' = $1`, [sku]);
  const zeroStock = inventory.rows.some(row => row.data.quantities.some(quantity => quantity.name === 'available' && quantity.quantity === 0));
  const snapshotFrom = zeroStock ? '0001-01-01' : from;
  const snapshots = await db.query<{ day: string; location_id: string; inventory_item_id: string; available: number; taken_at: Date; late: boolean }>(
    `SELECT day::text, location_id, inventory_item_id, available, taken_at, late FROM ${sku === originalSeriesSku ? 'pulse.stock_snapshots' : 'pulse.series_stock_snapshots'}
      WHERE day BETWEEN $1::date AND $2::date ${sku === originalSeriesSku ? '' : 'AND sku = $3'} ORDER BY day`,
    sku === originalSeriesSku ? [snapshotFrom, today] : [snapshotFrom, today, sku]);
  const fallback = await db.query<{ day: string; market: SeriesPaceMarket; sold: number }>(`SELECT day::text, market, sold FROM ${sku === originalSeriesSku ? 'pulse.series_pace_sales' : 'pulse.series_sku_sales'}
    WHERE day BETWEEN $1::date AND $2::date ${sku === originalSeriesSku ? '' : 'AND sku = $3'} ORDER BY day`,
    sku === originalSeriesSku ? [from, to] : [from, to, sku]);
  const result = {} as SeriesPaceFacts;
  for (const market of markets) {
    const rows = snapshots.rows.filter(row => row.location_id === locations[market]).map(row => ({ day: row.day, locationId: row.location_id, inventoryItemId: row.inventory_item_id, available: row.available, takenAt: new Date(row.taken_at).toISOString(), late: row.late }));
    const byDay = new Map(rows.map(row => [row.day, row]));
    const sales = new Map(fallback.rows.filter(row => row.market === market).map(row => [row.day, row.sold]));
    const days: SeriesPaceDay[] = [];
    for (let day = from; day <= to; day = addDays(day, 1)) {
      const start = byDay.get(day), end = byDay.get(addDays(day, 1));
      if (start && end && !start.late && !end.late && start.inventoryItemId === end.inventoryItemId) days.push({ day, sold: start.available - end.available, source: 'snapshot' });
      else if (sales.has(day)) days.push({ day, sold: sales.get(day)!, source: 'shopifyql' });
    }
    const current = inventory.rows.map(row => row.data).filter(row => row.locationId === locations[market]);
    result[market] = { stock: current.length === 1 ? current[0]!.quantities.find(quantity => quantity.name === 'available')?.quantity ?? null : null, days, snapshots: rows };
  }
  return result;
}
export async function missingSeriesPaceWindow(db: Database, now: Date, after: string | null = null, series?: Series): Promise<{ from: string; to: string } | null> {
  const facts = await readSeriesPaceFacts(db, now, series?.sku), today = ukToday(now);
  // A cached report day is immutable even when the other market was unreported.
  // Rotate contiguous gaps so an empty or failed report cannot starve newer days.
  const sku = series?.sku ?? originalSeriesSku;
  const cached = await db.query<{ day: string }>(`SELECT DISTINCT day::text FROM ${sku === originalSeriesSku ? 'pulse.series_pace_sales' : 'pulse.series_sku_sales'}
    WHERE day >= $1::date AND day < $2::date ${sku === originalSeriesSku ? '' : 'AND sku = $3'}`,
  sku === originalSeriesSku ? [addDays(today, -7), today] : [addDays(today, -7), today, sku]);
  const held = new Set(cached.rows.map(row => row.day));
  const windows: { from: string; to: string }[] = [];
  for (let day = addDays(today, -7); day < today; day = addDays(day, 1)) {
    const missing = !held.has(day) && markets.some(market => (!series || day >= seriesMarket(series, market).launchDate) && !facts[market].days.some(row => row.day === day));
    if (missing) {
      const previous = windows.at(-1);
      if (previous && addDays(previous.to, 1) === day) previous.to = day;
      else windows.push({ from: day, to: day });
    }
  }
  return windows.find(window => after === null || window.to > after) ?? windows[0] ?? null;
}

export async function snapshotSkus(db: Database): Promise<Set<string>> {
  const stocks = await db.query<{ sku: string }>(`SELECT DISTINCT sku FROM pulse.series_stock_snapshots
    UNION ALL SELECT $1::text WHERE EXISTS (SELECT 1 FROM pulse.stock_snapshots)`, [originalSeriesSku]);
  return new Set(stocks.rows.map(row => row.sku));
}

/** Two complete zero-stock days require on-time observations at both ends of each day. */
export function retiredSeriesInMarket(facts: SeriesPaceMarketFacts, launch: string, today: string): boolean {
  if (facts.stock !== 0) return false;
  let start: string | null = null;
  let previous: string | null = null;
  let confirmed: string | null = null;
  for (const snapshot of facts.snapshots) {
    if (snapshot.day < launch || snapshot.day > today) continue;
    if (snapshot.available !== 0) confirmed = null;
    if (snapshot.late || snapshot.available !== 0) {
      start = previous = null;
      continue;
    }
    if (!previous || addDays(previous, 1) !== snapshot.day) start = snapshot.day;
    previous = snapshot.day;
    if (!confirmed && start && addDays(start, 2) === snapshot.day) confirmed = snapshot.day;
  }
  return confirmed !== null && today >= addDays(confirmed, 7);
}
