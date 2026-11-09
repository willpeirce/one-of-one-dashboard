import type { Facts } from './metrics.js';
import { ukToday } from '../hero-range.js';

/** A completed backfill or poll must reach the selected dates before an empty email total is measured zero. */
export function emailCoverageKnown(facts: Facts, from: string, to: string, today: string, now: Date): boolean {
  const backfill = facts.jobs.find(job => job.name === 'backfill'), poll = facts.jobs.find(job => job.name === 'poll');
  if (!backfill?.state.ordersDone || typeof backfill.state.from !== 'string' || backfill.state.from > from) return false;
  let pollRead: Date | undefined;
  if (poll?.last_success_at && !poll.state.continuing) {
    const finished = new Date(poll.last_success_at).getTime();
    const bound = typeof poll.state.query === 'string' ? Date.parse(/updated_at:<=([^\s]+)/.exec(poll.state.query)?.[1] ?? '') : finished;
    if (Number.isFinite(finished) && Number.isFinite(bound)) pollRead = new Date(Math.min(finished, bound));
  }
  const reads = [backfill.state.until, pollRead]
    .filter((at): at is string | Date => typeof at === 'string' || at instanceof Date)
    .map(at => new Date(at).getTime()).filter(at => Number.isFinite(at) && at <= now.getTime());
  if (!reads.length) return false;
  const readDay = ukToday(new Date(Math.max(...reads)));
  return to === today ? readDay >= to : readDay > to;
}
