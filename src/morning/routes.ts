import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Auth } from '../auth.js';
import type { Database } from '../db.js';
import { MorningPressError, pressMorning, readMorning, readMorningResult, type MorningInputLoader, type MorningPress } from './store.js';
import {MorningTiming} from './timing.js';

const actions = new Set(['park', 'remind', 'hold', 'hide', 'ack', 'call', 'undo']);
function parsePress(input: unknown): MorningPress | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const body = input as Record<string, unknown>, keys = Object.keys(body).sort();
  if (typeof body.cardKey !== 'string' || !body.cardKey || body.cardKey.length > 384
    || typeof body.action !== 'string' || !actions.has(body.action)) return null;
  if (body.action === 'call') {
    if (keys.join(',') !== 'action,answer,cardKey' || !['a', 'b', 'draw'].includes(body.answer as string)) return null;
  } else if (body.action === 'hold' && Object.hasOwn(body, 'days')) {
    if (keys.join(',') !== 'action,cardKey,days' || body.days !== 3 && body.days !== 7) return null;
  } else if (keys.join(',') !== 'action,cardKey') return null;
  return body as unknown as MorningPress;
}

export function registerMorning(app: FastifyInstance, db: Database, auth: Auth, loadInputs: MorningInputLoader, clock: () => Date,
  options: {onWrite?: () => void} = {}) {
  const timings = new WeakMap<FastifyRequest,MorningTiming>();
  const timedRoute = (request: FastifyRequest) => ['/morning','/api/morning','/api/morning/press'].includes(request.routeOptions.url ?? '');
  app.addHook('onRequest',async request => {
    if (timedRoute(request)) timings.set(request,new MorningTiming());
  });
  app.addHook('onResponse',async (request,reply) => {
    const timing = timings.get(request);
    if (timing) timing.log();
    // An earlier origin/content guard can finish before our onRequest hook runs.
    else if (timedRoute(request)) new MorningTiming().log(reply.elapsedTime);
  });
  const service = {
    timing: (request: FastifyRequest) => timings.get(request),
    read: (now = clock(),timing?: MorningTiming) => readMorning(db, loadInputs, now,timing),
    summary: (now = clock()) => readMorningResult(db, loadInputs, now),
    press: async (press: MorningPress, credentialId: string, now = clock(),timing?: MorningTiming) => {
      const result = await pressMorning(db,loadInputs,press,credentialId,now,timing);
      try { options.onWrite?.(); } catch { console.warn('Morning saved; observation refresh pending.'); }
      return result;
    },
  };
  const localWrite = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.headers.origin !== auth.config.origin) return reply.code(403).send({error: 'Request origin is not allowed.'});
    if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') return reply.code(415).send({error: 'Use a JSON request.'});
  };
  app.get('/api/morning', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const timing = timings.get(request);
    if (!await (timing ? timing.measure('auth',() => auth.session(request)) : auth.session(request))) return reply.code(401).send({error: 'Sign in to continue.'});
    return service.read(clock(),timing);
  });
  app.post('/api/morning/press', {bodyLimit: 512, onRequest: localWrite}, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const timing = timings.get(request), who = await (timing ? timing.measure('auth',() => auth.session(request)) : auth.session(request));
    if (!who) return reply.code(401).send({error: 'Sign in to continue.'});
    const press = parsePress(request.body);
    if (!press) return reply.code(400).send({error: 'Choose a listed card and press.'});
    try { return await service.press(press, who,clock(),timing); }
    catch (error) {
      if (error instanceof MorningPressError) return reply.code(error.statusCode).send({error: error.message});
      throw error;
    }
  });
  return service;
}
