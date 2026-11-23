import type { FastifyInstance } from 'fastify';
import type { Auth } from '../auth.js';
import type { Database } from '../db.js';
import { readSettings } from '../settings.js';
import { askErrorType, type AskClient } from './engine.js';
import { askDeadlineMs, askUnavailable, type AskAnswer } from './protocol.js';
import { askQuestion, parseAskQuestion } from './store.js';
import { dashboardAskTool, type AskToolContext } from './tools.js';
import { askPage } from './view.js';

export function registerAsk(app: FastifyInstance, db: Database, auth: Auth, mode: 'sample' | 'live',
  env: NodeJS.ProcessEnv, clock: () => Date, readDashboard?: AskToolContext['readDashboard'], client?: AskClient): void {
  app.get('/ask', async (request, reply) => {
    if (!await auth.session(request)) return reply.redirect('/login');
    return reply.type('text/html; charset=utf-8').send(askPage(mode));
  });
  app.post('/api/ask', { bodyLimit: 4096 }, async (request, reply) => {
    if (!await auth.session(request)) return reply.code(401).send({ error: 'Sign in to continue.' });
    const question = parseAskQuestion(request.body);
    if (question === null) return reply.code(400).send({ error: 'Enter a question up to 300 characters.' });
    const startedAt = performance.now(), now = clock();
    const unavailable: AskAnswer = { answer: askUnavailable, outcome: 'unavailable', sources: [] };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = new Promise<AskAnswer>(resolve => { timer = setTimeout(() => resolve(unavailable), askDeadlineMs); });
      const run = async () => {
        const { values: settings } = await readSettings(db, { seed: false });
        if (performance.now() - startedAt >= askDeadlineMs) return unavailable;
        return askQuestion({ db, settings, mode, now, question, startedAt, apiKey: env.ANTHROPIC_API_KEY, client,
          tool: dashboardAskTool({ db, settings, env, now, readDashboard }) });
      };
      return await Promise.race([run(), deadline]);
    } catch (error) {
      console.warn(`Ask failed (${askErrorType(error)}).`);
      return unavailable;
    } finally {
      clearTimeout(timer);
    }
  });
}
