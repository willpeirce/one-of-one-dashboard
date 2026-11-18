import type {Database} from '../db.js';
import type {Settings} from '../settings.js';
import type {SourceMode} from '../sources.js';
import {readGorgiasHistory} from '../gorgias/store.js';
import {gorgiasSource} from '../gorgias/scope.js';
import {REVIEW_POLL_MS} from '../judgeme/worker.js';
import {buildIssuesView, sampleIssuesView, type IssueInputs, type IssueReview, type IssuesView} from './model.js';

/** No new store: use every retained low-star review, including dismissed or moderated ones. */
async function reviews(db: Database, now: Date): Promise<IssueInputs['reviews']> {
  const [health, rows] = await Promise.all([
    db.query<{mode: string; status: string; last_success_at: Date | string | null; unread_count: number}>(
      `SELECT mode,status,last_success_at,COALESCE((SELECT unread_count FROM pulse.judgeme_sync),0) AS unread_count
       FROM pulse.source_health WHERE source='judgeme'`),
    db.query<{review_id: string; rating: number; body: string; created_at: Date | string}>(
      'SELECT review_id,rating,body,created_at FROM pulse.judgeme_reviews WHERE rating<=3 ORDER BY created_at,review_id'),
  ]);
  const source = health.rows[0], readTime = source?.last_success_at ? new Date(source.last_success_at).getTime() : NaN;
  const checkedAt = Number.isFinite(readTime) && readTime <= +now ? new Date(readTime).toISOString() : null;
  const incomplete = (source?.unread_count ?? 0) > 0;
  const ready = source?.mode === 'live' && source.status === 'healthy' && checkedAt !== null
    && +now - readTime <= 3 * REVIEW_POLL_MS && !incomplete;
  const result: IssueReview[] = rows.rows.map(row => ({id: row.review_id, rating: row.rating, body: row.body,
    createdAt: new Date(row.created_at).toISOString()}));
  return {mode: 'live', status: !source?.last_success_at ? 'pending' : ready ? 'ready' : 'unavailable', checkedAt, rows: result,
    ...(incomplete ? {note: 'the latest read was incomplete; retained cases are shown and trend needs wait for a complete read.'} : {})};
}

/** Stored reads only. Sample cases are built only when the dashboard and both issue sources are sample. */
export async function readIssues(db: Database, env: NodeJS.ProcessEnv, settings: Settings, now: Date, dashboardMode: SourceMode): Promise<IssuesView> {
  const reviewMode: SourceMode = env.JUDGEME_API_TOKEN?.trim() ? 'live' : 'sample', ticketMode = gorgiasSource(env).mode;
  if (dashboardMode === 'sample' && reviewMode === 'sample' && ticketMode === 'sample') return sampleIssuesView(now);
  const [reviewRead, ticketRead] = await Promise.all([
    reviewMode === 'live' ? reviews(db, now) : Promise.resolve<IssueInputs['reviews']>({mode: 'sample', status: 'pending', checkedAt: null, rows: []}),
    ticketMode === 'live' ? readGorgiasHistory(db, env, settings, now) : null,
  ]);
  const tickets: IssueInputs['tickets'] = !ticketRead ? {mode: 'sample', status: 'pending', checkedAt: null, domain: '', rows: []}
    : {mode: ticketRead.mode, status: !ticketRead.checkedAt ? 'pending' : ticketRead.status === 'live' ? 'ready' : 'unavailable',
      checkedAt: ticketRead.checkedAt, domain: ticketRead.domain, rows: ticketRead.tickets.map(row => ({id: row.id,
        subject: row.subject, tags: row.tags, createdAt: row.createdAt}))};
  return buildIssuesView({dashboardMode, reviews: reviewRead, tickets}, settings.gorgiasIssueTags, now);
}
