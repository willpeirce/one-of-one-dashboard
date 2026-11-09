import type { Database } from '../db.js';
import { ukToday } from '../hero-range.js';
import type { SourceMode } from '../sources.js';
import type { Inventory } from '../shopify/model.js';

export interface StockDailyRow {
  mode: SourceMode;
  day: string;
  locationId: string;
  inventoryItemId: string;
  productId: string;
  available: number;
  takenAt: string;
  fetchedAt: string;
  source: 'shopify';
  sourceId: string;
  brand: 'one-of-one';
}

/** Today's observed inventory only: an outage cannot invent stock for a later day. */
export async function takeStockDaily(db: Database, mode: SourceMode, now: Date): Promise<{ day: string; freshRows: number; inserted: number }> {
  const day = ukToday(now);
  const inventory = await db.query<{ source_id: string; fetched_at: Date; data: Inventory }>(`SELECT source_id, fetched_at, data
    FROM pulse.shopify_records WHERE mode=$1 AND kind='inventory'
      AND fetched_at >= ($2::date::timestamp AT TIME ZONE 'Europe/London') AND fetched_at <= $3`, [mode, day, now]);
  const stocks = inventory.rows.flatMap(row => {
    const values = row.data.quantities.filter(value => value.name === 'available');
    // Missing or ambiguous availability stays absent, never a measured zero.
    if (values.length !== 1 || !Number.isSafeInteger(values[0]!.quantity)) return [];
    return [{ ...row, available: values[0]!.quantity }];
  });
  if (!stocks.length) return { day, freshRows: 0, inserted: 0 };
  const result = await db.query(`INSERT INTO pulse.stock_daily
      (mode,day,location_id,inventory_item_id,product_id,available,taken_at,fetched_at,source_id)
    SELECT $1,$2::date,location,item,product,available,$3,fetched,source_id
    FROM unnest($4::text[],$5::text[],$6::text[],$7::int[],$8::timestamptz[],$9::text[])
      AS r(location,item,product,available,fetched,source_id)
    ON CONFLICT (mode,day,location_id,inventory_item_id) DO NOTHING`,
  [mode,day,now,stocks.map(row=>row.data.locationId),stocks.map(row=>row.data.inventoryItemId),stocks.map(row=>row.data.productId),
    stocks.map(row=>row.available),stocks.map(row=>row.fetched_at),stocks.map(row=>row.source_id)]);
  return { day, freshRows: stocks.length, inserted: result.rowCount };
}

/** No interpolation or zero filling: callers distinguish absent dates from observed stock. */
export async function readStockDaily(db: Database, mode: SourceMode, from: string, to: string): Promise<StockDailyRow[]> {
  const rows = await db.query<{ mode: SourceMode; day: string; location_id: string; inventory_item_id: string; product_id: string;
    available: number; taken_at: Date; fetched_at: Date; source: 'shopify'; source_id: string; brand: 'one-of-one' }>(
    `SELECT mode,day::text,location_id,inventory_item_id,product_id,available,taken_at,fetched_at,source,source_id,brand
      FROM pulse.stock_daily WHERE mode=$1 AND day BETWEEN $2::date AND $3::date ORDER BY day,product_id,location_id,inventory_item_id`, [mode,from,to]);
  return rows.rows.map(row=>({ mode:row.mode,day:row.day,locationId:row.location_id,inventoryItemId:row.inventory_item_id,
    productId:row.product_id,available:row.available,takenAt:new Date(row.taken_at).toISOString(),fetchedAt:new Date(row.fetched_at).toISOString(),
    source:row.source,sourceId:row.source_id,brand:row.brand }));
}
