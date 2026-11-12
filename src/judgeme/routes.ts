import type { FastifyInstance } from 'fastify';
import type { Auth } from '../auth.js';
import type { Database } from '../db.js';
import { dismissReviews } from './store.js';

/** Dismiss and its Undo only change Pulse's own list. Nothing is sent to Judge.me. */
export function registerReviewRoutes(app: FastifyInstance, db: Database, auth: Auth, publish: () => void): void {
  app.post('/api/reviews/dismiss', async (request, reply) => {
    if (request.headers.origin !== auth.config.origin) return reply.code(403).send({ error: 'Request origin is not allowed.' });
    if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') return reply.code(415).send({ error: 'Use a JSON request.' });
    if (!await auth.session(request)) return reply.code(401).send({ error: 'Sign in to continue.' });
    const body = request.body as { ids?: unknown; action?: unknown } | null;
    const ids = Array.isArray(body?.ids) ? body.ids : [];
    if (!['dismiss', 'undo'].includes(String(body?.action)) || ids.length < 1 || ids.length > 500
      || !ids.every(id => typeof id === 'string' && /^[0-9]{1,20}$/.test(id))) return reply.code(400).send({ error: 'Choose reviews to dismiss.' });
    await dismissReviews(db, [...new Set(ids as string[])], body!.action === 'undo');
    publish();
    return { saved: true };
  });
}
