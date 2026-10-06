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
  async inventory(): Promise<any[]> {
    return this.inventoryFixture(this.cardHistory ? 'product-costs' : 'product');
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
    const table = (await fixture(query.includes('sales_channel') ? this.cardHistory ? 'card-channels' : 'channels' : query.startsWith('FROM sales') ? 'sales' : this.cardHistory ? 'card-sessions' : 'sessions')).data.shopifyqlQuery.tableData;
    const from = /SINCE (\d{4}-\d{2}-\d{2})/.exec(query)?.[1];
    const to = /UNTIL (\d{4}-\d{2}-\d{2})/.exec(query)?.[1] ?? appConfig.shopify.sampleNow.slice(0, 10);
    table.rows = table.rows.filter((r: any) => (!from || r[0] >= from) && r[0] <= to);
    return table;
  }
  async subscriptions(): Promise<Page> { return (await fixture('subscriptions')).data.webhookSubscriptions; }
  async subscribe(_topic: string, _uri: string): Promise<void> { throw new Error('Sample mode cannot subscribe.'); }
}
