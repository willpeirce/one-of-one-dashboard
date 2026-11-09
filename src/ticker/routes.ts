import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Auth } from '../auth.js';
import type { Database } from '../db.js';
import type { SourceMode } from '../sources.js';
import { changeTicker, readTicker, TickerNotFoundError } from './store.js';

export function registerTicker(app: FastifyInstance, db: Database, auth: Auth, mode: SourceMode, clock: () => Date): void {
  const localWrite = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.headers.origin !== auth.config.origin) return reply.code(403).send({ error: 'Request origin is not allowed.' });
    if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') return reply.code(415).send({ error: 'Use a JSON request.' });
  };
  app.get('/api/ticker', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!await auth.session(request)) return reply.code(401).send({ error: 'Sign in to continue.' });
    return readTicker(db, mode, clock());
  });
  for (const action of ['next', 'restore'] as const) app.post(`/api/ticker/${action}`, { bodyLimit: 512, onRequest: localWrite }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const who = await auth.session(request);
    if (!who) return reply.code(401).send({ error: 'Sign in to continue.' });
    const body = request.body as { eventKey?: unknown } | null;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1
      || typeof body.eventKey !== 'string' || !body.eventKey || body.eventKey.length > 220)
      return reply.code(400).send({ error: 'Choose a listed date.' });
    try { return await changeTicker(db, mode, body.eventKey, action, who, clock()); }
    catch (error) {
      if (error instanceof TickerNotFoundError) return reply.code(404).send({ error: error.message });
      throw error;
    }
  });
}
