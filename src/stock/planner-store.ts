import { sharedSeriesSkus } from '../series-pace/series.js';
import { appConfig } from '../config.js';
import type { Database } from '../db.js';
import { addDays, ukToday } from '../hero-range.js';
import { readStockDaily } from '../scorecard/stock-daily.js';
import { readSettings } from '../settings.js';
import { dataset } from '../shopify/metrics.js';
import type { ShopifyStore } from '../shopify/store.js';
import { plannerDefaults, plannerHistoryDays, planStock, type PlannerProduct, type PlannerRow } from './planner.js';

export interface StockPlannerView {
  mode: 'sample' | 'live';
  today: string;
  asOf: string | null;
  rows: PlannerRow[];
}

const markets = ['uk', 'us'] as const;
const originalKit = appConfig.shopify.stockProducts.find(product => 'sku' in product)!;

type SeriesStockSettings = { sku: string; name: string; productId?: string; UKLaunchDate?: string; USLaunchDate?: string };


function sampleStockPlanner(today: string, now: Date): StockPlannerView {
  const products: PlannerProduct[] = markets.flatMap((market, index) => [
    { name: 'Invented Comet Kit', kit: true, available: 560 + index * 120, usage: 8 + index, days: 28 },
    { name: 'Invented Orbit Sleeves', kit: false, available: 39 + index * 19, usage: 3 + index, days: 28 },
    { name: 'Invented Prism Case', kit: false, available: 320 + index * 21, usage: 2, days: 12 },
    { name: 'Invented Echo Pack', kit: false, available: 42 + index * 19, usage: 0, days: 0 },
  ].map(({ usage, days, ...product }) => ({
    ...product, market, daily: new Map(Array.from({ length: days ? days + 1 : 0 }, (_, i) => [addDays(today, -i), product.available + usage * i])),
  })));
  const sample = {
    ...plannerDefaults(),
    supplierLeadTimes: [{ supplier: 'Invented Works', days: 21 }],
    productSuppliers: [{ product: 'Invented Orbit Sleeves', supplier: 'Invented Works' }, { product: 'Invented Prism Case', supplier: 'Invented Works' }],
    inboundStock: [{ product: 'Invented Orbit Sleeves', market: 'us' as const, quantity: 96, expectedDate: addDays(today, 8) }],
  };
  return { mode: 'sample', today, asOf: now.toISOString(), rows: planStock(products, today, sample) };
}

export async function readStockPlanner(db: Database, store: ShopifyStore, now: Date): Promise<StockPlannerView> {
  const today = ukToday(now);
  if (store.mode === 'sample') return sampleStockPlanner(today, now);
  const [facts, history, { values }] = await Promise.all([
    store.facts(now), readStockDaily(db, 'live', addDays(today, -plannerHistoryDays), today), readSettings(db, { seed: false }),
  ]);
  const inventory = dataset(facts, today).inventory;
  // Earlier releases have one kit in config. The planner still works if series editing is rolled back.
  const series = (values as { series?: SeriesStockSettings[] }).series ?? [{ sku: originalKit.sku, name: originalKit.name }];
  const shared = new Set(sharedSeriesSkus(facts.jobs.find(job => job.name === 'inventory')?.state));
  const skus = new Set(series.map(row => row.sku));
  const packs = appConfig.shopify.stockProducts.filter(product => !('bundle' in product) && product.id !== originalKit.id);
  const products = markets.flatMap(market => {
    const location = appConfig.shopify.locations[market].id;
    const tracked = [
      ...series.map(row => ({
        name: row.sku === originalKit.sku ? originalKit.name : row.name,
        sku: row.sku, kit: true, launch: market === 'uk' ? row.UKLaunchDate : row.USLaunchDate,
        productId: row.sku === originalKit.sku ? `gid://shopify/Product/${originalKit.id}` : row.productId ? `gid://shopify/Product/${row.productId}` : undefined,
      })),
      ...packs.map(row => ({ name: row.name, sku: 'sku' in row ? row.sku : undefined, kit: false, launch: undefined, productId: `gid://shopify/Product/${row.id}` })),
    ].filter(row => row.kit || !row.sku || !skus.has(row.sku));

    return tracked.map(({ productId, ...product }): PlannerProduct => {
      const matches = (row: { locationId: string; productId: string; sku?: string | null }): boolean =>
        row.locationId === location && (product.kit && row.sku
          ? row.sku === product.sku && (productId ? row.productId === productId : !shared.has(row.sku))
          : productId === row.productId && (product.kit || !skus.has(row.sku ?? '')));
      const current = inventory.filter(matches);
      const available = current.map(row => row.quantities.find(quantity => quantity.name === 'available')?.quantity);
      const observations = history.filter(matches);
      const expected = new Set([...current, ...observations].map(row => row.inventoryItemId));
      const byDay = new Map<string, Map<string, number>>();
      for (const row of observations) {
        const day = byDay.get(row.day) ?? new Map<string, number>();
        day.set(row.inventoryItemId, row.available);
        byDay.set(row.day, day);
      }
      const daily = new Map([...byDay].flatMap(([day, items]) => [...expected].every(item => items.has(item))
        ? [[day, [...items.values()].reduce((sum, value) => sum + value, 0)] as const] : []));
      return { ...product, market, available: available.length && available.every(value => value !== undefined)
        ? available.reduce<number>((sum, value) => sum + value!, 0) : null, daily };
    });
  });
  const at = facts.jobs.find(job => job.name === 'inventory')?.last_success_at;
  return { mode: 'live', today, asOf: at ? new Date(at).toISOString() : null, rows: planStock(products, today, values) };
}
