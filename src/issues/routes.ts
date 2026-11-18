import {createHash} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import type {Auth} from '../auth.js';
import type {IssuesView} from './model.js';
import type {IssueCasesPage} from './presentation-types.js';
import {ISSUE_REASONS, type IssueReason} from './taxonomy.js';

export const ISSUE_CASE_PAGE_SIZE = 50;
export function buildIssueCasesPage(view: IssuesView, reason: IssueReason, offset = 0): IssueCasesPage | null {
  const row = view.rows.find(row => row.reason === reason);
  if (!row || !Number.isInteger(offset) || offset < 0 || offset % ISSUE_CASE_PAGE_SIZE !== 0
    || offset >= row.cases.length && offset !== 0) return null;
  const version = createHash('sha256').update(JSON.stringify([view.mode, view.status, view.thisMonth, view.lastMonth, row, view.notes])).digest('base64url');
  const cases = row.cases.slice(offset, offset + ISSUE_CASE_PAGE_SIZE);
  return {reason: row.reason, mode: view.mode, status: view.status,
    thisMonth: view.thisMonth, lastMonth: view.lastMonth, current: row.current, previous: row.previous,
    cases, total: row.cases.length, nextOffset: offset + cases.length < row.cases.length ? offset + cases.length : null,
    version, notes: view.notes};
}
export function registerIssuesRoutes(app: FastifyInstance, auth: Auth, load: () => Promise<IssuesView>): void {
  app.get('/api/issues/:reason', async (request, reply) => {
    if (!await auth.session(request)) return reply.code(401).send({error: 'Sign in to continue.'});
    const reason = (request.params as {reason: string}).reason;
    if (!ISSUE_REASONS.includes(reason as IssueReason)) return reply.code(404).send({error: 'Issue reason not found.'});
    const query = request.query as Record<string, unknown>, offsetText = query.offset ?? '0';
    if (Object.keys(query).some(key => key !== 'offset' && key !== 'version')
      || typeof offsetText !== 'string' || !/^(?:0|[1-9]\d{0,7})$/.test(offsetText)
      || Number(offsetText) % ISSUE_CASE_PAGE_SIZE !== 0
      || query.version !== undefined && (typeof query.version !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(query.version))
      || Number(offsetText) !== 0 && query.version === undefined) return reply.code(400).send({error: 'Invalid Issues request.'});
    let view: IssuesView;
    try {view = await load();} catch {return reply.code(503).send({error: 'Issues are temporarily unavailable. Try again.'});}
    const first = buildIssueCasesPage(view, reason as IssueReason);
    if (!first) return reply.code(404).send({error: 'Issue reason not found.'});
    if (query.version !== undefined && query.version !== first.version)
      return reply.code(409).send({error: 'These cases changed. Close and open the reason again.'});
    const page = Number(offsetText) === 0 ? first : buildIssueCasesPage(view, reason as IssueReason, Number(offsetText));
    if (!page) return reply.code(400).send({error: 'Invalid Issues request.'});
    return page;
  });
}
