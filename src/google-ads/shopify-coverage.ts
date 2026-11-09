import { addDays, ukToday } from '../hero-range.js';
import { dataset, type Facts } from '../shopify/metrics.js';
import type { GoogleShopifyContext } from './dashboard.js';

function completedPollBound(poll: Facts['jobs'][number] | undefined): number {
  if (!poll?.last_success_at || poll.state.continuing) return NaN;
  if (!Object.hasOwn(poll.state,'query')) return new Date(poll.last_success_at).getTime();
  if (typeof poll.state.query !== 'string') return NaN;
  const query = /^updated_at:>=([^\s]+)\s+updated_at:<=([^\s]+)$/.exec(poll.state.query);
  if (!query) return NaN;
  const bounds=query.slice(1).map(value=>{
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return NaN;
    const parsed=Date.parse(value),canonical=value.includes('.')?value:value.replace('Z','.000Z');
    return Number.isFinite(parsed)&&new Date(parsed).toISOString()===canonical?parsed:NaN;
  });
  return bounds.every(Number.isFinite)&&bounds[0]!<=bounds[1]!?bounds[1]!:NaN;
}

/** A recent order alone cannot prove that a completed comparison day was fully read. */
export function googleShopifyContext(facts: Facts, now: Date): GoogleShopifyContext {
  const data = dataset(facts, ukToday(now));
  const backfill = facts.jobs.find(job => job.name === 'backfill');
  const poll = facts.jobs.find(job => job.name === 'poll');
  const backfillBound=backfill?.state.ordersDone&&typeof backfill.state.until==='string'?Date.parse(backfill.state.until):NaN;
  const backfillRead=backfill?.last_success_at?new Date(backfill.last_success_at).getTime():NaN;
  // The query range stays fixed while pages load; the recorded read time describes freshness only.
  const completed=[{bound:backfillBound,read:Number.isFinite(backfillRead)?backfillRead:backfillBound},
    {bound:completedPollBound(poll),read:poll?.last_success_at?new Date(poll.last_success_at).getTime():NaN}]
    .filter(value=>Number.isFinite(value.bound)&&Number.isFinite(value.read)&&value.bound<=now.getTime()&&value.read<=now.getTime());
  const lastRead=completed.length?new Date(Math.max(...completed.map(value=>value.read))).toISOString():null;
  const bound=completed.length?Math.max(...completed.map(value=>value.bound)):null;
  return { mode: facts.mode, orders: data.orders, ready: data.ready, from: data.from,
    through: bound===null?'':addDays(ukToday(new Date(bound)),-1), lastRead };
}
