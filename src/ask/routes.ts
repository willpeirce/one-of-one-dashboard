import type { FastifyInstance } from 'fastify';
import type { Auth } from '../auth.js';
import type { Database } from '../db.js';
import { readSettings } from '../settings.js';
import type { AskClient } from './engine.js';
import { askQuestion, parseAskQuestion } from './store.js';
import { dashboardAskTool, type AskToolContext } from './tools.js';
import { askPage } from './view.js';

export function registerAsk(app: FastifyInstance, db: Database, auth: Auth, mode: 'sample' | 'live',
  env: NodeJS.ProcessEnv, clock: () => Date, readStock?: AskToolContext['readStock'], client?: AskClient): void {
  app.get('/ask', async (request, reply) => {
    if (!await auth.session(request)) return reply.redirect('/login');
    return reply.type('text/html; charset=utf-8').send(askPage(mode));
  });
  app.post('/api/ask', { bodyLimit: 4096 }, async (request, reply) => {
    if (!await auth.session(request)) return reply.code(401).send({ error: 'Sign in to continue.' });
    const question = parseAskQuestion(request.body);
    if (question === null) return reply.code(400).send({ error: 'Enter a question up to 300 characters.' });
    const now = clock(), { values: settings } = await readSettings(db, { seed: false });
    return askQuestion({ db, settings, mode, now, question, apiKey: env.ANTHROPIC_API_KEY, client,
      tool: dashboardAskTool({ db, settings, env, now, readStock }) });
  });
}
