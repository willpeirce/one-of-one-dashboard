import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Auth } from '../auth.js';
import type { Database } from '../db.js';
import { readPushKeyPair } from './keys.js';
import type { PushTestResult } from './service.js';
import { removePushSubscription, savePushSubscription } from './store.js';
import { validatePushEndpoint, validatePushKeys } from './validation.js';

function exactObject(value: unknown, keys: string[]): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === keys.slice().sort().join(',');
}

export function registerPush(app: FastifyInstance, db: Database, auth: Auth, options: {
  clock: () => Date;
  sendTest: (credentialId: string) => Promise<PushTestResult>;
}): void {
  const localWrite = async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header('Cache-Control', 'no-store');
    if (request.headers.origin !== auth.config.origin) return reply.code(403).send({error: 'Request origin is not allowed.'});
    if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') return reply.code(415).send({error: 'Use a JSON request.'});
  };
  app.get('/api/push/key', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!await auth.session(request)) return reply.code(401).send({error: 'Sign in to continue.'});
    try { return {publicKey: (await readPushKeyPair(db)).publicKey}; }
    catch { return reply.code(503).send({error: 'Notifications are unavailable. Try again later.'}); }
  });
  app.post('/api/push/subscribe', {bodyLimit: 4096, onRequest: localWrite}, async (request, reply) => {
    const who = await auth.session(request);
    if (!who) return reply.code(401).send({error: 'Sign in to continue.'});
    const body = request.body;
    if (!exactObject(body, ['endpoint','keys']) || !exactObject(body.keys, ['p256dh','auth']))
      return reply.code(400).send({error: 'Use a valid notification subscription.'});
    let subscription;
    try { subscription = {endpoint: validatePushEndpoint(body.endpoint).href, keys: validatePushKeys(body.keys)}; }
    catch { return reply.code(400).send({error: 'Use a valid notification subscription.'}); }
    try { await savePushSubscription(db, who, subscription, options.clock()); return {ok: true}; }
    catch { return reply.code(503).send({error: 'Notifications could not be enabled. Try again later.'}); }
  });
  app.post('/api/push/unsubscribe', {bodyLimit: 4096, onRequest: localWrite}, async (request, reply) => {
    const who = await auth.session(request);
    if (!who) return reply.code(401).send({error: 'Sign in to continue.'});
    if (!exactObject(request.body, ['endpoint'])) return reply.code(400).send({error: 'Use a valid notification subscription.'});
    let endpoint: string;
    try { endpoint = validatePushEndpoint(request.body.endpoint).href; }
    catch { return reply.code(400).send({error: 'Use a valid notification subscription.'}); }
    try { await removePushSubscription(db, endpoint, who); return {ok: true}; }
    catch { return reply.code(503).send({error: 'Notifications could not be disabled. Try again later.'}); }
  });
  app.post('/api/push/test', {bodyLimit: 512, onRequest: localWrite}, async (request, reply) => {
    const who = await auth.session(request);
    if (!who) return reply.code(401).send({error: 'Sign in to continue.'});
    if (!exactObject(request.body, [])) return reply.code(400).send({error: 'Use an empty JSON object.'});
    try {
      await db.query('INSERT INTO pulse.audit_log(event,credential_id,occurred_at) VALUES($1,$2,$3)', ['Push test requested',who,options.clock()]);
      const result = await options.sendTest(who);
      if (result.status === 'sent') return {ok: true, sent: result.sent, failed: result.failed, gone: result.gone};
      if (result.status === 'rate-limited') return reply.header('Retry-After', String(result.retryAfterSeconds)).code(429)
        .send({error: 'Wait a minute before sending another test.', retryAfterSeconds: result.retryAfterSeconds});
      return reply.code(503).send({error: 'The test could not be sent. Check notifications and try again later.'});
    } catch { return reply.code(503).send({error: 'The test could not be sent. Try again later.'}); }
  });
}
