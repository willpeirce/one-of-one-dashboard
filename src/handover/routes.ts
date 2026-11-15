import type { FastifyInstance } from 'fastify';
import type { Auth } from '../auth.js';
import type { HandoverSections } from './sections.js';
import { handoverPage } from './view.js';

export function registerHandover(app: FastifyInstance, auth: Pick<Auth, 'session'>, sections: HandoverSections): void {
  app.get('/handover', async (request, reply) => {
    if (!await auth.session(request)) return reply.redirect('/login');
    return reply.type('text/html; charset=utf-8').send(handoverPage(await sections.read()));
  });
}
