import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { appConfig } from '../config.js';
import type { Database } from '../db.js';
import { gid, } from './model.js';
export const webhookTopics = {
  'orders/create': 'ORDERS_CREATE', 'orders/updated': 'ORDERS_UPDATED', 'orders/cancelled': 'ORDERS_CANCELLED',
  'refunds/create': 'REFUNDS_CREATE', 'fulfillments/create': 'FULFILLMENTS_CREATE', 'fulfillments/update': 'FULFILLMENTS_UPDATE',
  'inventory_levels/update': 'INVENTORY_LEVELS_UPDATE',
} as const;
export function validSignature(bytes: Buffer, signature: unknown, secret: string): boolean {
  if (typeof signature !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(signature)) return false;
  const supplied = Buffer.from(signature, 'base64');
  const expected = createHmac('sha256', secret).update(bytes).digest();
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
export function replayPayload(topic: keyof typeof webhookTopics, body: any): Record<string, string> {
  if (topic === 'inventory_levels/update') return { inventoryItemId: gid('InventoryItem', body.inventory_item_id), locationId: gid('Location', body.location_id) };
  return { orderId: gid('Order', topic.startsWith('orders/') ? body.admin_graphql_api_id ?? body.id : body.order_id) };
}
export async function registerShopifyWebhooks(app: FastifyInstance, db: Database, env: NodeJS.ProcessEnv, trigger: () => void): Promise<void> {
  await app.register(async scoped => {
    scoped.removeContentTypeParser('application/json');
    scoped.addContentTypeParser('application/json', { parseAs: 'buffer', bodyLimit: 1_048_576 }, (_req, bytes, done) => done(null, bytes));
    scoped.post(appConfig.shopify.webhookPath, { bodyLimit: 1_048_576 }, async (req, reply) => {
      if (!env.SHOPIFY_CLIENT_ID?.trim() || !env.SHOPIFY_CLIENT_SECRET?.trim()) return reply.code(503).send({ error: 'Shopify is waiting for keys.' });
      if (req.headers['x-shopify-shop-domain'] !== appConfig.shopify.storeDomain || !Buffer.isBuffer(req.body) || !validSignature(req.body, req.headers['x-shopify-hmac-sha256'], env.SHOPIFY_CLIENT_SECRET)) return reply.code(401).send({ error: 'Invalid webhook.' });
      const topic = req.headers['x-shopify-topic'];
      const event = req.headers['x-shopify-webhook-id'];
      if (typeof topic !== 'string' || !Object.hasOwn(webhookTopics, topic) || typeof event !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(event)) return reply.code(400).send({ error: 'Invalid webhook.' });
      let payload;
      try { payload = replayPayload(topic as keyof typeof webhookTopics, JSON.parse(req.body.toString('utf8'))); }
      catch { return reply.code(400).send({ error: 'Invalid webhook.' }); }
      await db.query(`INSERT INTO pulse.shopify_webhook_inbox (source_id, topic, payload) VALUES ($1, $2, $3)
        ON CONFLICT (source_id) DO NOTHING`, [event, topic, JSON.stringify(payload)]);
      // Ack only after commit; replay survives process death and does not trust event ordering.
      trigger();
      return reply.code(200).send({ status: 'accepted' });
    });
  });
}
