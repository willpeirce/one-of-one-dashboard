import { readFile } from 'node:fs/promises';
import type { Page, ShopifyReader } from './client.js';
import { appConfig } from '../config.js';
export async function fixture(name: string): Promise<any> {
  return JSON.parse(await readFile(new URL(`../../test/fixtures/shopify/${name}.json`, import.meta.url), 'utf8'));
}
export class SampleShopify implements ShopifyReader {
  constructor(private readonly cardHistory = false) {}
  async scopes(): Promise<string[]> { return (await fixture('scopes')).data.currentAppInstallation.accessScopes.map((s: any) => s.handle); }
  async orders(query: string, _after: string | null, address: boolean): Promise<Page> {
    const result = (await fixture(this.cardHistory ? 'card-orders' : 'orders')).data.orders;
    const from = /(?:created_at|updated_at):>=(\S+)/.exec(query)?.[1];
    const to = /(?:created_at|updated_at):<=(\S+)/.exec(query)?.[1];
    result.nodes = result.nodes.filter((n: any) => {
      const date = Date.parse(n[query.startsWith('updated_at') ? 'updatedAt' : 'createdAt']);
      return (!from || date >= Date.parse(from)) && (!to || date <= Date.parse(to));
    });
    if (!address) for (const n of result.nodes) delete n.shippingAddress;
    return result;
  }
  async order(id: string, address: boolean): Promise<any> {
    const order = (await fixture('order')).data.order;
    if (!address) delete order.shippingAddress;
    return order.id === id ? order : null;
  }
  async inventory(sku?: string): Promise<any[]> {
    const rows = await this.inventoryFixture(this.cardHistory ? 'product-costs' : 'product');
    return sku ? rows.filter(row => row.sku === sku) : rows;
  }
  private async inventoryFixture(name: string): Promise<any[]> {
    const product = (await fixture(name)).data.product;
    const levels = (await fixture('levels')).data.inventoryItem.inventoryLevels.nodes;
    return product.variants.nodes.flatMap((variant: any, index: number) => {
      const metadata = { productId: product.id, variantId: variant.id, sku: variant.sku, inventoryItemId: variant.inventoryItem.id, unitCost: variant.inventoryItem.unitCost };
      return index === 0 ? levels.map((level: any) => ({ ...metadata, ...level })) : [{ ...metadata, location: null }];
    });
  }
  async costBaseline(): Promise<{ rows: any[]; at: Date } | null> {
    return this.cardHistory ? { rows: await this.inventoryFixture('product-costs-before'), at: new Date('2026-09-28T12:00:00Z') } : null;
  }
  async report(query: string): Promise<any> {
    if (query.includes("WHERE product_title = 'ONE OF ONE'")) return sampleKitSales(query);
    const table = (await fixture(query.includes('sales_channel') ? this.cardHistory ? 'card-channels' : 'channels' : query.startsWith('FROM sales') ? 'sales' : this.cardHistory ? 'card-sessions' : 'sessions')).data.shopifyqlQuery.tableData;
    const from = /SINCE (\d{4}-\d{2}-\d{2})/.exec(query)?.[1];
    const to = /UNTIL (\d{4}-\d{2}-\d{2})/.exec(query)?.[1] ?? appConfig.shopify.sampleNow.slice(0, 10);
    table.rows = table.rows.filter((r: any) => (!from || r[0] >= from) && r[0] <= to);
    return table;
  }
  async subscriptions(): Promise<Page> { return (await fixture('subscriptions')).data.webhookSubscriptions; }
  async subscribe(_topic: string, _uri: string): Promise<void> { throw new Error('Sample mode cannot subscribe.'); }
}

// Invented expanded sales lines: the Duo contributes two base-kit units; accessories contribute none.
function sampleKitSales(query: string) {
  const lines = [
    { day: '2026-09-29', country: 'GB', product: 'ONE OF ONE', units: 2, bundle: 'Duo' },
    { day: '2026-09-29', country: 'GB', product: 'COLOUR EXPANSION PACK', units: 8 },
    { day: '2026-09-29', country: 'US', product: 'ONE OF ONE', units: 1, bundle: 'Starter' },
    { day: '2026-09-28', country: 'US', product: 'ONE OF ONE', units: 1, bundle: 'Ultimate' },
  ];
  const from = /SINCE (\d{4}-\d{2}-\d{2})/.exec(query)?.[1] ?? '';
  const to = /UNTIL (\d{4}-\d{2}-\d{2})/.exec(query)?.[1] ?? '';
  return { columns: ['day', 'shipping_country', 'net_items_sold'].map(name => ({ name, dataType: name === 'net_items_sold' ? 'INTEGER' : 'STRING', displayName: name })),
    rows: lines.filter(line => line.product === 'ONE OF ONE' && line.day >= from && line.day <= to).map(line => [line.day, line.country, line.units]) };
}
