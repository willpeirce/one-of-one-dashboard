import type {FastifyInstance, FastifyReply, FastifyRequest} from 'fastify';
import type {Auth} from '../auth.js';
import type {Database} from '../db.js';
import type {SourceMode} from '../sources.js';
import {validWaitingId, WaitingValidationError, type WaitingView} from './model.js';
import {addWaitingItem, changeWaitingItem, WaitingNotFoundError} from './store.js';

export function registerWaitingOn(app: FastifyInstance, db: Database, auth: Auth, options: {
  mode: SourceMode; clock: () => Date; loadView: (now: Date) => Promise<WaitingView>; publish: () => Promise<unknown>;
}): void {
  const localWrite = async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header('Cache-Control', 'no-store');
    if (request.headers.origin !== auth.config.origin) return reply.code(403).send({error: 'Request origin is not allowed.'});
    if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') return reply.code(415).send({error: 'Use a JSON request.'});
  };
  app.get('/api/waiting-on', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!await auth.session(request)) return reply.code(401).send({error: 'Sign in to continue.'});
    try {return {view: await options.loadView(options.clock())};}
    catch {return reply.code(503).send({error: 'Waiting items could not be read. Try again later.'});}
  });
  for (const action of ['add', 'done', 'restore'] as const) app.post(`/api/waiting-on/${action}`, {bodyLimit: 4096, onRequest: localWrite}, async (request, reply) => {
    const who = await auth.session(request);
    if (!who) return reply.code(401).send({error: 'Sign in to continue.'});
    const now = options.clock();
    try {
      if (action === 'add') await addWaitingItem(db, request.body, who, now);
      else {
        const body = request.body as {id?: unknown} | null;
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).join(',') !== 'id' || !validWaitingId(body.id))
          return reply.code(400).send({error: 'Choose a listed waiting item.'});
        await changeWaitingItem(db, options.mode, body.id, action, who, now);
      }
    } catch (error) {
      if (error instanceof WaitingValidationError) return reply.code(400).send({error: error.message});
      if (error instanceof WaitingNotFoundError) return reply.code(404).send({error: error.message});
      return reply.code(503).send({error: 'Waiting items could not be saved. Try again later.'});
    }
    // Neither a disconnected subscriber nor a failed fresh read can undo a committed answer.
    try {await options.publish();}
    catch {try {console.warn('Waiting update notification failed.');} catch { /* Diagnostics never change a saved result. */ }}
    try {return {saved: true, view: await options.loadView(now)};}
    catch {return {saved: true, view: null, message: 'Saved. Refresh to see the waiting items.'};}
  });
}
