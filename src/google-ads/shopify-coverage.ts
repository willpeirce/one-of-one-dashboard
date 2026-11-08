import { addDays, ukToday } from '../hero-range.js';
import { dataset, type Facts } from '../shopify/metrics.js';
import type { GoogleShopifyContext } from './dashboard.js';

/** A recent order alone cannot prove that a completed comparison day was fully read. */
export function googleShopifyContext(facts: Facts, now: Date): GoogleShopifyContext {
  const data = dataset(facts, ukToday(now));
  const backfill = facts.jobs.find(job => job.name === 'backfill');
  const poll = facts.jobs.find(job => job.name === 'poll');
  const completed = [backfill?.state.ordersDone ? backfill.state.until : null,
    !poll?.state.continuing ? poll?.last_success_at : null]
    .filter(value => value != null).map(value => new Date(value).getTime())
    .filter(value => Number.isFinite(value) && value <= now.getTime());
  const lastRead = completed.length ? new Date(Math.max(...completed)).toISOString() : null;
  return { mode: facts.mode, orders: data.orders, ready: data.ready, from: data.from,
    through: lastRead ? addDays(ukToday(new Date(lastRead)), -1) : '', lastRead };
}
