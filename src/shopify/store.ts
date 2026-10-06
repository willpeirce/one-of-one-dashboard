import { refreshFulfilment } from '../fulfilment/store.js';
import type { Database } from '../db.js';
import { ukToday } from '../hero-range.js';
import type { SourceMode } from '../sources.js';
import { cleanInventory, cleanOrder, cleanSales, cleanSessions } from './model.js';
import { gid } from './model.js';
import { appConfig } from '../config.js';
import { ShopifyError } from './http.js';
import type { ShopifyCost } from './costs.js';
export class ShopifyStore {
  constructor(readonly db: Database, readonly mode: SourceMode) {}
  async put(kind: string, id: string, data: unknown, fetched: Date, updated = fetched): Promise<void> {
    await this.db.query(`INSERT INTO pulse.shopify_records (mode, kind, source_id, data, fetched_at, source_updated_at)
      VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (mode, kind, source_id) DO UPDATE SET
      data = EXCLUDED.data, fetched_at = EXCLUDED.fetched_at, source_updated_at = EXCLUDED.source_updated_at
      WHERE shopify_records.source_updated_at <= EXCLUDED.source_updated_at`, [this.mode, kind, id, JSON.stringify(data), fetched, updated]);
  }
  async orders(rows: any[], fetched: Date): Promise<void> {
    await this.db.transaction(async tx => {
      const store = new ShopifyStore(tx, this.mode);
      const orders=rows.map(cleanOrder);
      for (const order of orders) await store.put('order', order.id, order, fetched, new Date(order.updatedAt));
      await refreshFulfilment(tx, this.mode, fetched, orders);
    });
  }
  async inventory(rows: any[], fetched: Date): Promise<void> {
    await this.db.transaction(async tx => {
      await tx.query('LOCK TABLE pulse.shopify_cost_history IN SHARE ROW EXCLUSIVE MODE');
      const observed = new Set<string>();
      for (const raw of rows) {
        if (appConfig.shopify.stockProducts.some(p => `gid://shopify/Product/${p.id}` === raw.productId) && !observed.has(raw.variantId)) {
          observed.add(raw.variantId);
          await new ShopifyStore(tx, this.mode).observeCost(raw, fetched);
        }
        const stock = raw.location ? cleanInventory(raw) : null;
        if (stock) await new ShopifyStore(tx, this.mode).put('inventory', `${stock.inventoryItemId}:${stock.locationId}`, stock, fetched);
      }
    });
  }
  private async observeCost(raw: any, fetched: Date): Promise<void> {
    const variant = gid('ProductVariant', raw.variantId), item = gid('InventoryItem', raw.inventoryItemId), product = gid('Product', raw.productId);
    const sku = typeof raw.sku === 'string' && /^[\w-]{1,80}$/.test(raw.sku) ? raw.sku : null;
    const cost = raw.unitCost;
    if (cost !== null && cost !== undefined && (typeof cost.amount !== 'string' || !/^\d+(\.\d+)?$/.test(cost.amount) || !/^[A-Z]{3}$/.test(cost.currencyCode))) throw new ShopifyError('invalid');
    const parts = cost?.amount.split('.') as string[] | undefined;
    const fraction = (parts?.[1] ?? '').padEnd(3, '0');
    const amount = parts ? Number(BigInt(parts[0]!) * 100n + BigInt(fraction.slice(0,2)) + (Number(fraction[2]) >= 5 ? 1n : 0n)) : null, currency = cost?.currencyCode ?? null;
    if (amount !== null && !Number.isSafeInteger(amount)) throw new ShopifyError('invalid');
    const latest = (await this.db.query<ShopifyCost & Record<string, unknown>>('SELECT * FROM pulse.shopify_cost_history WHERE mode=$1 AND variant_id=$2 ORDER BY first_seen_at DESC, id DESC LIMIT 1', [this.mode,variant])).rows[0];
    if (latest && new Date(latest.last_seen_at).getTime() > fetched.getTime()) return;
    if (latest && (latest.amount_pence === null ? null : Number(latest.amount_pence)) === amount && latest.currency === currency) {
      await this.db.query('UPDATE pulse.shopify_cost_history SET last_seen_at=$3, sku=$4, inventory_item_id=$5, product_id=$6 WHERE id=$1 AND mode=$2', [latest.id,this.mode,fetched,sku,item,product]);
    } else await this.db.query(`INSERT INTO pulse.shopify_cost_history (mode,source_id,variant_id,inventory_item_id,sku,product_id,amount_pence,currency,first_seen_at,last_seen_at)
      VALUES ($1,$2,$2,$3,$4,$5,$6,$7,$8,$8)`, [this.mode,variant,item,sku,product,amount,currency,fetched]);
  }
  async costHistory(): Promise<ShopifyCost[]> {
    return (await this.db.query<ShopifyCost & Record<string, unknown>>('SELECT variant_id, inventory_item_id, product_id, sku, amount_pence, currency, first_seen_at, last_seen_at FROM pulse.shopify_cost_history WHERE mode=$1 ORDER BY first_seen_at, id', [this.mode])).rows;
  }
  async latestCosts(): Promise<ShopifyCost[]> {
    return (await this.db.query<ShopifyCost & Record<string, unknown>>('SELECT DISTINCT ON (variant_id) variant_id, inventory_item_id, product_id, sku, amount_pence, currency, first_seen_at, last_seen_at FROM pulse.shopify_cost_history WHERE mode=$1 ORDER BY variant_id, first_seen_at DESC, id DESC', [this.mode])).rows;
  }
  async costSummary() {
    const latest = await this.latestCosts();
    const changed = await this.db.query<{ changed: Date | null }>(`SELECT max(first_seen_at) AS changed FROM pulse.shopify_cost_history WHERE mode=$1 AND variant_id IN (SELECT variant_id FROM pulse.shopify_cost_history WHERE mode=$1 GROUP BY variant_id HAVING count(*)>1)`, [this.mode]);
    return { known: latest.filter(c => c.amount_pence !== null).length, missing: latest.filter(c => c.amount_pence === null).length, changed: changed.rows[0]!.changed };
  }
  async sessions(table: any, fetched: Date, provenance: 'shopifyql' | 'routine_daily' = 'shopifyql'): Promise<void> {
    for (const row of cleanSessions(table)) {
      await this.put('sessions', row.day, { ...row, provenance, partial: row.day === ukToday(fetched) }, fetched);
      if (!row.marketReliable) await this.notice('geo_unreliable', `geo:${row.day}`, fetched);
      else await this.clearNotice(`geo:${row.day}`);
    }
  }
  async sales(table: any, fetched: Date): Promise<void> { for (const row of cleanSales(table)) await this.put('sales', row.day, row, fetched); }
  async notice(kind: string, id: string, fetched: Date, detail: unknown = {}): Promise<void> {
    await this.db.query(`INSERT INTO pulse.shopify_notices (mode, kind, source_id, fetched_at, detail) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (mode, source_id) DO UPDATE SET fetched_at = EXCLUDED.fetched_at, detail = EXCLUDED.detail`, [this.mode, kind, id, fetched, JSON.stringify(detail)]);
  }
  async clearNotice(id: string): Promise<void> { await this.db.query('DELETE FROM pulse.shopify_notices WHERE mode = $1 AND source_id = $2', [this.mode, id]); }
  async facts() {
    const records = await this.db.query<{ kind: string; data: any; fetched_at: Date }>('SELECT kind, data, fetched_at FROM pulse.shopify_records WHERE mode = $1', [this.mode]);
    const summary = await this.summary();
    const notices = await this.db.query<{ kind: string; source_id: string; detail: any; fetched_at: Date }>('SELECT kind, source_id, detail, fetched_at FROM pulse.shopify_notices WHERE mode = $1', [this.mode]);
    return { ...summary, records: records.rows, noticeDetails: notices.rows };
  }
  async summary() {
    const counts = await this.db.query<{ kind: string; count: string }>('SELECT kind, count(*)::text AS count FROM pulse.shopify_records WHERE mode = $1 GROUP BY kind', [this.mode]);
    const jobs = await this.db.query<{ name: string; state: any; last_success_at: Date | null; failures: number }>('SELECT name, state, last_success_at, failures FROM pulse.shopify_jobs WHERE mode = $1 ORDER BY name', [this.mode]);
    const notices = await this.db.query<{ kind: string }>('SELECT kind FROM pulse.shopify_notices WHERE mode = $1 ORDER BY source_id', [this.mode]);
    const pending = await this.db.query<{ count: string }>('SELECT count(*)::text AS count FROM pulse.shopify_webhook_inbox WHERE processed_at IS NULL');
    return { mode: this.mode, sample: this.mode === 'sample', counts: Object.fromEntries(counts.rows.map(r => [r.kind, Number(r.count)])), jobs: jobs.rows, notices: notices.rows.map(r => r.kind), pendingWebhooks: this.mode === 'live' ? Number(pending.rows[0]!.count) : 0 };
  }
}
