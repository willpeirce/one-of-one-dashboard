import type { FastifyInstance } from 'fastify';
import type { Auth } from '../auth.js';
import type { Database } from '../db.js';
import type { ShopifyStore } from '../shopify/store.js';
import { readStockPlanner } from './planner-store.js';
import { stockPlannerPage } from './planner-view.js';

export function registerStockPlanner(app: FastifyInstance, db: Database, auth: Auth, store: ShopifyStore, clock: () => Date): void {
  app.get('/stock', async (request, reply) => {
    if (!await auth.session(request)) return reply.redirect('/login');
    return reply.type('text/html; charset=utf-8').send(stockPlannerPage(await readStockPlanner(db, store, clock())));
  });
}
