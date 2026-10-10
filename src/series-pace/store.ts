import { appConfig } from '../config.js';
import type { Database } from '../db.js';
import { addDays, ukToday } from '../hero-range.js';
import { ShopifyError } from '../shopify/http.js';
import { cleanInventory, reportRows, type Inventory } from '../shopify/model.js';
import type { SeriesPaceDay, SeriesPaceMarket } from './model.js';

export interface StockSnapshot {
  day: string; locationId: string; inventoryItemId: string; available: number; takenAt: string; late: boolean;
}
export interface SeriesPaceMarketFacts { stock: number | null; days: SeriesPaceDay[]; snapshots: StockSnapshot[] }
export type SeriesPaceFacts = Record<SeriesPaceMarket, SeriesPaceMarketFacts>;
const markets = ['UK', 'US'] as const;
const locations = { UK: appConfig.shopify.locations.uk.id, US: appConfig.shopify.locations.us.id };
const kit = appConfig.shopify.stockProducts.find(product => 'sku' in product && product.sku === 'oneofone1')!;
const kitProductId = `gid://shopify/Product/${kit.id}`;

export function seriesPaceQuery(from: string, to: string): string {
  return `FROM sales SHOW net_items_sold WHERE product_title = 'ONE OF ONE' GROUP BY shipping_country TIMESERIES day SINCE ${from} UNTIL ${to}`;
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
export async function saveSeriesPaceSales(db: Database, table: unknown, from: string, to: string, now: Date): Promise<void> {
  const rows = parseSeriesPaceSales(table, from, to);
  // Unknown days remain absent, including when a failed report follows a good one.
  if (!rows.length) return;
  await db.query(`INSERT INTO pulse.series_pace_sales (day, market, sold, fetched_at)
    SELECT day::date, market, sold, $4 FROM unnest($1::text[], $2::text[], $3::int[]) AS r(day, market, sold)
    ON CONFLICT (market, day) DO UPDATE SET sold = EXCLUDED.sold, fetched_at = EXCLUDED.fetched_at`,
  [rows.map(row => row.day), rows.map(row => row.market), rows.map(row => row.sold), now]);
}
export function snapshotIsLate(now: Date, caughtUp = false): boolean {
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: appConfig.timezone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(now);
  return caughtUp || time > '02:00:00';
}
export async function takeStockSnapshot(db: Database, rows: any[], now: Date, caughtUp = false): Promise<void> {
  const day = ukToday(now), late = snapshotIsLate(now, caughtUp);
  const stocks = rows.filter(row => row.productId === kitProductId && row.sku === 'oneofone1' && row.location).map(cleanInventory).filter((row): row is Inventory => row !== null);
  const snapshots = markets.map(market => {
    const matching = stocks.filter(row => row.locationId === locations[market]);
    // One kit inventory item per location: never guess from accessories or a missing level.
    if (matching.length !== 1) throw new ShopifyError('invalid');
    const stock = matching[0]!, available = stock.quantities.find(quantity => quantity.name === 'available')?.quantity;
    if (available === undefined) throw new ShopifyError('invalid');
    return { locationId: stock.locationId, inventoryItemId: stock.inventoryItemId, available };
  });
  await db.query(`INSERT INTO pulse.stock_snapshots (day, location_id, inventory_item_id, available, taken_at, late)
    SELECT $1::date, location, item, available, $5, $6 FROM unnest($2::text[], $3::text[], $4::int[]) AS r(location, item, available)
    ON CONFLICT (location_id, day) DO NOTHING`,
  [day, snapshots.map(row => row.locationId), snapshots.map(row => row.inventoryItemId), snapshots.map(row => row.available), now, late]);
}
export async function readSeriesPaceFacts(db: Database, now: Date): Promise<SeriesPaceFacts> {
  const today = ukToday(now), from = addDays(today, -7), to = addDays(today, -1);
  // Keep these sequential: callers may supply a transaction connection.
  const inventory = await db.query<{ data: Inventory }>(`SELECT data FROM pulse.shopify_records WHERE mode = 'live' AND kind = 'inventory' AND data->>'productId' = $1`, [kitProductId]);
  const snapshots = await db.query<{ day: string; location_id: string; inventory_item_id: string; available: number; taken_at: Date; late: boolean }>(
    `SELECT day::text, location_id, inventory_item_id, available, taken_at, late FROM pulse.stock_snapshots WHERE day BETWEEN $1::date AND $2::date ORDER BY day`, [from, today]);
  const fallback = await db.query<{ day: string; market: SeriesPaceMarket; sold: number }>(`SELECT day::text, market, sold FROM pulse.series_pace_sales WHERE day BETWEEN $1::date AND $2::date ORDER BY day`, [from, to]);
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
export async function missingSeriesPaceWindow(db: Database, now: Date): Promise<{ from: string; to: string } | null> {
  const facts = await readSeriesPaceFacts(db, now), today = ukToday(now), missing: string[] = [];
  for (let day = addDays(today, -7); day < today; day = addDays(day, 1)) {
    if (markets.some(market => !facts[market].days.some(row => row.day === day && row.source === 'snapshot'))) missing.push(day);
  }
  return missing.length ? { from: missing[0]!, to: missing.at(-1)! } : null;
}
