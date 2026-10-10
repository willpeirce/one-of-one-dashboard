import { appConfig } from '../config.js';
import { ShopifyError, Transport } from './http.js';
import { TokenManager } from './token.js';

const page = 'pageInfo { hasNextPage endCursor }';
const money = 'shopMoney { amount currencyCode }';
const lineFields = `id sku quantity variant { id } product { id } taxLines { priceSet { ${money} } }`;
export const orderFields = (address: boolean) => `
  id name createdAt updatedAt cancelledAt test displayFinancialStatus displayFulfillmentStatus currencyCode taxesIncluded
  sourceName channelInformation { channelDefinition { channelName } }
  transactions(first: 250) { kind status processedAt }
  discountCodes
  subtotalPriceSet { ${money} }
  totalTaxSet { ${money} } totalShippingPriceSet { ${money} }
  customer { id }
  ${address ? 'shippingAddress { countryCodeV2 provinceCode zip }' : ''}
  customAttributes { key value }
  lineItems(first: 100) { nodes { ${lineFields} } ${page} }
  refunds { id createdAt refundLineItems(first: 100) { nodes { quantity subtotalSet { ${money} } totalTaxSet { ${money} } } ${page} } }
  fulfillments(first: 250) { id status createdAt updatedAt location { id } fulfillmentLineItems(first: 100) { nodes { quantity lineItem { id } } ${page} } }
  customerJourneySummary { firstVisit { landingPage utmParameters { source medium campaign } } lastVisit { landingPage utmParameters { source medium campaign } } }
`;
export interface Page<T = any> { nodes: T[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }
export interface ShopifyReader {
  scopes(): Promise<string[]>;
  orders(query: string, after: string | null, address: boolean): Promise<Page>;
  order(id: string, address: boolean): Promise<any>;
  inventory(sku?: string): Promise<any[]>;
  report(query: string): Promise<any>;
  subscriptions(after: string | null): Promise<Page>;
  subscribe(topic: string, uri: string): Promise<void>;
}
// No general query/mutation entry point is exposed. Only owned subscription creation can write.
export class ShopifyClient implements ShopifyReader {
  private readonly tokens: TokenManager;
  constructor(private readonly transport: Transport, env: NodeJS.ProcessEnv, private readonly origin: string) { this.tokens = new TokenManager(env, transport); }
  renewToken(): Promise<string> { return this.tokens.get(); }
  async #graphql(query: string, variables: Record<string, unknown> = {}): Promise<any> {
    for (let authAttempt = 0; authAttempt < 2; authAttempt++) {
      const token = await this.tokens.get();
      try {
        const body = await this.transport.request(`https://${appConfig.shopify.storeDomain}/admin/api/${appConfig.shopify.apiVersion}/graphql.json`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token }, body: JSON.stringify({ query, variables }),
        });
        if (!body.data) throw new ShopifyError('invalid');
        return body.data;
      } catch (error) {
        if (!(error instanceof ShopifyError) || error.code !== 'unauthorized' || authAttempt === 1) throw error;
        this.tokens.invalidate();
      }
    }
    throw new ShopifyError('unauthorized');
  }
  async scopes(): Promise<string[]> {
    const data = await this.#graphql('query PulseScopes { currentAppInstallation { accessScopes { handle } } }');
    return data.currentAppInstallation.accessScopes.map((s: { handle: string }) => s.handle);
  }
  async orders(query: string, after: string | null, address: boolean): Promise<Page> {
    const data = await this.#graphql(`query PulseOrders($query: String!, $after: String) { orders(first: 50, after: $after, sortKey: UPDATED_AT, query: $query) { nodes { ${orderFields(address)} } ${page} } }`, { query, after });
    for (const order of data.orders.nodes) await this.completeOrder(order);
    return data.orders;
  }
  async order(id: string, address: boolean): Promise<any> {
    const data = await this.#graphql(`query PulseOrder($id: ID!) { order(id: $id) { ${orderFields(address)} } }`, { id });
    if (data.order) await this.completeOrder(data.order);
    return data.order;
  }
  private async completeOrder(order: any): Promise<void> {
    let after = nextCursor(order.lineItems);
    while (after) {
      const data = await this.#graphql(`query PulseLines($id: ID!, $after: String!) { order(id: $id) { lineItems(first: 100, after: $after) { nodes { ${lineFields} } ${page} } } }`, { id: order.id, after });
      const next = nextCursor(data.order.lineItems);
      if (next === after) throw new ShopifyError('invalid');
      order.lineItems.nodes.push(...data.order.lineItems.nodes); order.lineItems.pageInfo = data.order.lineItems.pageInfo; after = next;
    }
    if (order.fulfillments.length >= 250) throw new ShopifyError('invalid');
    for (const fulfillment of order.fulfillments) {
      if (!fulfillment.fulfillmentLineItems) continue;
      let cursor = nextCursor(fulfillment.fulfillmentLineItems);
      while (cursor) {
        const data = await this.#graphql(`query PulseFulfilledLines($id: ID!, $after: String!) { fulfillment(id: $id) { fulfillmentLineItems(first: 100, after: $after) { nodes { quantity lineItem { id } } ${page} } } }`, { id: fulfillment.id, after: cursor });
        const next = nextCursor(data.fulfillment.fulfillmentLineItems);
        if (next === cursor) throw new ShopifyError('invalid');
        fulfillment.fulfillmentLineItems.nodes.push(...data.fulfillment.fulfillmentLineItems.nodes);
        fulfillment.fulfillmentLineItems.pageInfo = data.fulfillment.fulfillmentLineItems.pageInfo; cursor = next;
      }
    }
    for (const refund of order.refunds) {
      let cursor = nextCursor(refund.refundLineItems);
      while (cursor) {
        const data = await this.#graphql(`query PulseRefundLines($id: ID!, $after: String!) { node(id: $id) { ... on Refund { refundLineItems(first: 100, after: $after) { nodes { quantity subtotalSet { ${money} } totalTaxSet { ${money} } } ${page} } } } }`, { id: refund.id, after: cursor });
        const next = nextCursor(data.node.refundLineItems);
        if (next === cursor) throw new ShopifyError('invalid');
        refund.refundLineItems.nodes.push(...data.node.refundLineItems.nodes); refund.refundLineItems.pageInfo = data.node.refundLineItems.pageInfo; cursor = next;
      }
    }
  }
  async inventory(sku?: string): Promise<any[]> {
    const result: any[] = [];
    // Variants and levels paginate independently; only configured products/locations are retained.
    for (const product of appConfig.shopify.stockProducts) {
      if (sku && (!('sku' in product) || product.sku !== sku)) continue;
      let after: string | null = null;
      do {
        const data = await this.#graphql(`query PulseStock($id: ID!, $after: String) { product(id: $id) { id variants(first: 100, after: $after) { nodes { id sku inventoryItem { id unitCost { amount currencyCode } } } ${page} } } }`, { id: `gid://shopify/Product/${product.id}`, after });
        if (!data.product) break;
        for (const variant of data.product.variants.nodes) {
          if (sku && variant.sku !== sku) continue;
          const metadata = { productId: data.product.id, variantId: variant.id, sku: variant.sku, inventoryItemId: variant.inventoryItem.id, unitCost: variant.inventoryItem.unitCost };
          let hasLevels = false;
          let levelsAfter: string | null = null;
          do {
            const levels = await this.#graphql(`query PulseLevels($id: ID!, $after: String) { inventoryItem(id: $id) { id inventoryLevels(first: 100, after: $after) { nodes { id location { id } quantities(names: ["available", "on_hand", "committed"]) { name quantity } } ${page} } } }`, { id: variant.inventoryItem.id, after: levelsAfter });
            for (const level of levels.inventoryItem.inventoryLevels.nodes) { result.push({ ...metadata, ...level }); hasLevels = true; }
            const next = nextCursor(levels.inventoryItem.inventoryLevels);
            if (next && next === levelsAfter) throw new ShopifyError('invalid');
            levelsAfter = next;
          } while (levelsAfter);
          if (!hasLevels) result.push({ ...metadata, location: null });
        }
        const next = nextCursor(data.product.variants);
        if (next && next === after) throw new ShopifyError('invalid');
        after = next;
      } while (after);
    }
    return result;
  }
  async report(query: string): Promise<any> {
    const data = await this.#graphql('query PulseReport($query: String!) { shopifyqlQuery(query: $query) { parseErrors tableData { columns { name dataType displayName } rows } } }', { query });
    if (data.shopifyqlQuery.parseErrors?.length) throw new ShopifyError('graphql');
    if (!data.shopifyqlQuery.tableData) throw new ShopifyError('invalid');
    return data.shopifyqlQuery.tableData;
  }
  async subscriptions(after: string | null): Promise<Page> {
    const data = await this.#graphql(`query PulseSubscriptions($after: String) { webhookSubscriptions(first: 100, after: $after) { nodes { id topic uri } ${page} } }`, { after });
    return data.webhookSubscriptions;
  }
  async subscribe(topic: string, uri: string): Promise<void> {
    const target = new URL(appConfig.shopify.webhookPath, this.origin);
    if (uri !== target.href || target.protocol !== 'https:' || target.hostname.endsWith('.replit.dev') || ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || !['ORDERS_CREATE', 'ORDERS_UPDATED', 'ORDERS_CANCELLED', 'REFUNDS_CREATE', 'FULFILLMENTS_CREATE', 'FULFILLMENTS_UPDATE', 'INVENTORY_LEVELS_UPDATE'].includes(topic)) throw new ShopifyError('invalid');
    const data = await this.#graphql('mutation PulseSubscribe($topic: WebhookSubscriptionTopic!, $input: WebhookSubscriptionInput!) { webhookSubscriptionCreate(topic: $topic, webhookSubscription: $input) { webhookSubscription { id } userErrors { field message } } }', { topic, input: { uri, format: 'JSON', includeFields: topic.startsWith('ORDERS_') ? ['id', 'admin_graphql_api_id'] : topic === 'INVENTORY_LEVELS_UPDATE' ? ['inventory_item_id', 'location_id'] : ['id', 'order_id'] } });
    if (data.webhookSubscriptionCreate.userErrors.length || !data.webhookSubscriptionCreate.webhookSubscription) throw new ShopifyError('graphql');
  }
}
export function nextCursor(value: Page): string | null {
  if (!Array.isArray(value.nodes) || !value.pageInfo) throw new ShopifyError('invalid');
  if (!value.pageInfo.hasNextPage) return null;
  if (!value.pageInfo.endCursor) throw new ShopifyError('invalid');
  return value.pageInfo.endCursor;
}
