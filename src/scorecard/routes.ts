import type { FastifyInstance } from 'fastify';
import type { Auth } from '../auth.js';
import type { Database } from '../db.js';
import { HeroRangeError } from '../hero-range.js';
import type { ShopifyStore } from '../shopify/store.js';
import { readScorecard } from './store.js';
import { scorecardPage } from './view.js';

export function registerScorecard(app: FastifyInstance, db: Database, auth: Auth, store: ShopifyStore, env: NodeJS.ProcessEnv, clock: () => Date): void {
  app.get('/scorecard', async (request, reply) => {
    if (!await auth.session(request)) return reply.redirect('/login');
    const query = request.query as Record<string, unknown>;
    if (Object.keys(query).some(key => !['month', 'market'].includes(key)) || query.month !== undefined && typeof query.month !== 'string') throw new HeroRangeError();
    const market = query.market ?? 'all';
    if (market !== 'all' && market !== 'uk' && market !== 'us') throw new HeroRangeError();
    return reply.type('text/html; charset=utf-8').send(scorecardPage(await readScorecard(db, store, env, query.month as string | undefined ?? '', market, clock())));
  });
}
