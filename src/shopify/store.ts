import type { Database } from '../db.js';
import { ukToday } from '../hero-range.js';
import type { SourceMode } from '../sources.js';
import { cleanInventory, cleanOrder, cleanSales, cleanSessions } from './model.js';
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
      for (const raw of rows) { const order = cleanOrder(raw); await store.put('order', order.id, order, fetched, new Date(order.updatedAt)); }
    });
  }
  async inventory(rows: any[], fetched: Date): Promise<void> {
    await this.db.transaction(async tx => {
      for (const raw of rows) {
        const stock = cleanInventory(raw);
        if (stock) await new ShopifyStore(tx, this.mode).put('inventory', `${stock.inventoryItemId}:${stock.locationId}`, stock, fetched);
      }
    });
  }
  async sessions(table: any, fetched: Date, provenance: 'shopifyql' | 'routine_daily' = 'shopifyql'): Promise<void> {
    for (const row of cleanSessions(table)) {
      await this.put('sessions', row.day, { ...row, provenance, partial: row.day === ukToday(fetched) }, fetched);
      if (!row.marketReliable) await this.notice('geo_unreliable', `geo:${row.day}`, fetched);
    }
  }
  async sales(table: any, fetched: Date): Promise<void> { for (const row of cleanSales(table)) await this.put('sales', row.day, row, fetched); }
  async notice(kind: string, id: string, fetched: Date): Promise<void> {
    await this.db.query(`INSERT INTO pulse.shopify_notices (mode, kind, source_id, fetched_at) VALUES ($1, $2, $3, $4)
      ON CONFLICT (mode, source_id) DO UPDATE SET fetched_at = EXCLUDED.fetched_at`, [this.mode, kind, id, fetched]);
  }
  async summary() {
    const counts = await this.db.query<{ kind: string; count: string }>('SELECT kind, count(*)::text AS count FROM pulse.shopify_records WHERE mode = $1 GROUP BY kind', [this.mode]);
    const jobs = await this.db.query<{ name: string; state: any; last_success_at: Date | null; failures: number }>('SELECT name, state, last_success_at, failures FROM pulse.shopify_jobs WHERE mode = $1 ORDER BY name', [this.mode]);
    const notices = await this.db.query<{ kind: string }>('SELECT kind FROM pulse.shopify_notices WHERE mode = $1 ORDER BY source_id', [this.mode]);
    const pending = await this.db.query<{ count: string }>('SELECT count(*)::text AS count FROM pulse.shopify_webhook_inbox WHERE processed_at IS NULL');
    return { mode: this.mode, sample: this.mode === 'sample', counts: Object.fromEntries(counts.rows.map(r => [r.kind, Number(r.count)])), jobs: jobs.rows, notices: notices.rows.map(r => r.kind), pendingWebhooks: this.mode === 'live' ? Number(pending.rows[0]!.count) : 0 };
  }
}
