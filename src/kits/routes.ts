import type {FastifyInstance} from 'fastify';
import type {Auth} from '../auth.js';
import type {SourceMode} from '../sources.js';
import type {KitFacts} from './model.js';
import {kitSheet} from './presentation.js';

/** Local stored reads only; authorisation precedes every data read. */
export function registerKitDetails(app: FastifyInstance, auth: Pick<Auth, 'session'>, options: {
  dashboardMode: SourceMode; clock: () => Date; load: (now: Date) => Promise<KitFacts>;
}): void {
  app.get<{Params: {id: string}}>('/api/kits/:id', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!await auth.session(request)) return reply.code(401).send({error: 'Sign in to continue.'});
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(request.params.id) || request.params.id.length > 40)
      return reply.code(404).send({error: 'Kit not found.'});
    try {
      const now = options.clock(), facts = await options.load(now);
      if (facts.mode === 'sample' && options.dashboardMode === 'live') return reply.code(404).send({error: 'Kit not found.'});
      const view = kitSheet(facts,request.params.id,now);
      return view ?? reply.code(404).send({error: 'Kit not found.'});
    } catch {
      return reply.code(503).send({error: 'Kit details could not be read. Try again later.'});
    }
  });
}
