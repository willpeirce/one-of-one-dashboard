import type {FastifyInstance} from 'fastify';
import type {Auth} from '../auth.js';
import type {SourceMode} from '../sources.js';
import type {KitFacts} from './model.js';
import {kitsPageView} from './page-model.js';
import {kitsPage} from './page-view.js';
import {kitSheet} from './presentation.js';

/** Local stored reads only; authorisation precedes every data read. */
export function registerKitDetails(app: FastifyInstance, auth: Pick<Auth, 'session'>, options: {
  dashboardMode: SourceMode; clock: () => Date; load: (now: Date) => Promise<KitFacts>;
}): void {
  app.get('/kits', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!await auth.session(request)) return reply.redirect('/login');
    try {
      const now = options.clock(), facts = await options.load(now);
      return reply.type('text/html; charset=utf-8').send(kitsPage(kitsPageView(facts, options.dashboardMode, now)));
    } catch {
      return reply.code(503).type('text/plain; charset=utf-8').send('Kits could not be read. Try again later.');
    }
  });
  app.get<{Params: {id: string}; Querystring: Record<string, unknown>}>('/api/kits/:id', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!await auth.session(request)) return reply.code(401).send({error: 'Sign in to continue.'});
    const keys = Object.keys(request.query), suppliers = request.query.suppliers === '1';
    if (keys.length !== 0 && (keys.length !== 1 || keys[0] !== 'suppliers' || !suppliers))
      return reply.code(400).send({error: 'Kit details request refused.'});
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(request.params.id) || request.params.id.length > 40)
      return reply.code(404).send({error: 'Kit not found.'});
    try {
      const now = options.clock(), facts = await options.load(now);
      if (facts.mode === 'sample' && options.dashboardMode === 'live') return reply.code(404).send({error: 'Kit not found.'});
      const view = kitSheet(facts,request.params.id,now,{suppliers});
      return view ?? reply.code(404).send({error: 'Kit not found.'});
    } catch {
      return reply.code(503).send({error: 'Kit details could not be read. Try again later.'});
    }
  });
}
