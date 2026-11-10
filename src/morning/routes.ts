import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Auth } from '../auth.js';
import type { Database } from '../db.js';
import { MorningPressError, pressMorning, readMorning, readMorningResult, type MorningInputLoader, type MorningPress } from './store.js';

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

export function registerMorning(app: FastifyInstance, db: Database, auth: Auth, loadInputs: MorningInputLoader, clock: () => Date) {
  const service = {
    read: (now = clock()) => readMorning(db, loadInputs, now),
    summary: (now = clock()) => readMorningResult(db, loadInputs, now),
    press: (press: MorningPress, credentialId: string, now = clock()) => pressMorning(db, loadInputs, press, credentialId, now),
  };
  const localWrite = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.headers.origin !== auth.config.origin) return reply.code(403).send({error: 'Request origin is not allowed.'});
    if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') return reply.code(415).send({error: 'Use a JSON request.'});
  };
  app.get('/api/morning', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!await auth.session(request)) return reply.code(401).send({error: 'Sign in to continue.'});
    return service.read();
  });
  app.post('/api/morning/press', {bodyLimit: 512, onRequest: localWrite}, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const who = await auth.session(request);
    if (!who) return reply.code(401).send({error: 'Sign in to continue.'});
    const press = parsePress(request.body);
    if (!press) return reply.code(400).send({error: 'Choose a listed card and press.'});
    try { return await service.press(press, who); }
    catch (error) {
      if (error instanceof MorningPressError) return reply.code(error.statusCode).send({error: error.message});
      throw error;
    }
  });
  return service;
}
