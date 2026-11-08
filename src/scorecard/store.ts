import { adNames } from '../ad-spend/model.js';
import { spendFacts } from '../ad-spend/store.js';
import { appConfig } from '../config.js';
import type { Database } from '../db.js';
import { readEstimates } from '../fulfilment/store.js';
import { addDays, ukToday } from '../hero-range.js';
import { readSettings } from '../settings.js';
import { dailyRows, dataset, type Facts } from '../shopify/metrics.js';
import type { Order } from '../shopify/model.js';
import type { ShopifyStore } from '../shopify/store.js';
import { buildScorecard, scorecardMonth, type ScorecardInput, type ScorecardModel } from './metrics.js';
import { sampleScorecardInput } from './sample.js';
import { readStockDaily } from './stock-daily.js';

export interface ScorecardView { scorecard: ScorecardModel; latestMonth: string; sourceNotes: string[] }

/** Actual report rows cover older days; an absent aggregate day must never become a measured zero. */
export function scorecardCoverage(facts: Facts, from: string, to: string, market: ScorecardInput['market']): { salesCoverage: string[]; orderCoverage: string[] } {
  const backfill = facts.jobs.find(job => job.name === 'backfill');
  const poll = facts.jobs.find(job => job.name === 'poll');
  const backfillUntil = backfill?.state.ordersDone && typeof backfill.state.until === 'string' ? Date.parse(backfill.state.until) : NaN;
  const pollUntil = poll?.last_success_at && !poll.state.continuing ? new Date(poll.last_success_at).getTime() : NaN;
  const through = Math.max(Number.isFinite(backfillUntil) ? backfillUntil : 0, Number.isFinite(pollUntil) ? pollUntil : 0);
  const lastFull = through ? addDays(ukToday(new Date(through)), -1) : '';
  const first = backfill?.state.ordersDone && typeof backfill.state.from === 'string' ? backfill.state.from : null;
  const reported = new Set(facts.records.filter(record => record.kind === 'sales' && Number.isFinite(record.data.netSalesPence)).map(record => String(record.data.day)));
  const orderCoverage: string[] = [], salesCoverage: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const details = first !== null && day >= first && day <= lastFull;
    if (details) orderCoverage.push(day);
    if (details || market === 'all' && first !== null && day < first && reported.has(day)) salesCoverage.push(day);
  }
  return { salesCoverage, orderCoverage };
}

export async function readScorecard(db: Database, store: ShopifyStore, env: NodeJS.ProcessEnv, month: string, market: ScorecardInput['market'], now: Date): Promise<ScorecardView> {
  const window = scorecardMonth(month, now), latestMonth = scorecardMonth('', now).month;
  if (store.mode === 'sample') return { scorecard: buildScorecard(await sampleScorecardInput(window.month, market, now)), latestMonth, sourceNotes: ['Sample data · all figures, product names and stock history on this page are invented.'] };
  const settings = (await readSettings(db)).values;
  const facts = await store.facts(now), today = ukToday(now), data = dataset(facts, today);
  const spend = await spendFacts(db, settings, env, 'live', window.yearFrom, window.to, now);
  const costs = await store.costHistory(), estimates = await readEstimates(db, 'live');
  const stockDaily = await readStockDaily(db, 'live', window.previousFrom, window.to);
  const input: ScorecardInput = { mode: 'live', month: window.month, market, now,
    orders: facts.records.filter(record => record.kind === 'order').map(record => record.data as Order).filter(order => order.day >= data.from),
    dailySales: dailyRows(facts, today, market).filter(row => row.date >= window.yearFrom && row.date <= window.to).map(row => ({ day: row.date, netSales: row.net })),
    ...scorecardCoverage(facts, window.yearFrom, window.to, market), spend, costs, estimates, settings, stockDaily,
    locations: (['uk', 'us'] as const).map(m => ({ market: m, locationId: appConfig.shopify.locations[m].id })),
    productLabels: Object.fromEntries(appConfig.shopify.stockProducts.map(product => [`gid://shopify/Product/${product.id}`, product.name])) };
  return { scorecard: buildScorecard(input), latestMonth, sourceNotes: ['Live Shopify net sales; refunds reduce sales on their refund UK day. Shipping and tax are excluded.',
    ...spend.sources.map(source => `${adNames[source.source]}: ${source.live ? source.status : 'waiting for keys'}${source.fetchedAt ? ` · last fetched ${source.fetchedAt}` : ''}`),
    'Product stock history starts when daily captures begin. Earlier stock is not reconstructed.'] };
}
