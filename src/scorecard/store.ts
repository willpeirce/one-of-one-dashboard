import { adNames } from '../ad-spend/model.js';
import { sampleSpend, spendFacts } from '../ad-spend/store.js';
import { appConfig } from '../config.js';
import type { Database } from '../db.js';
import { readEstimates } from '../fulfilment/store.js';
import { addDays, ukToday } from '../hero-range.js';
import { defaultSettings, readSettings } from '../settings.js';
import { dailyRows, dataset, type Facts } from '../shopify/metrics.js';
import type { Order } from '../shopify/model.js';
import type { ShopifyStore } from '../shopify/store.js';
import { buildScorecard, compareScorecardWeeks, scorecardMonth, scorecardWeek, type ScorecardInput, type ScorecardModel, type ScorecardWeek } from './metrics.js';
import { sampleScorecardInput } from './sample.js';
import { readStockDaily } from './stock-daily.js';

export interface ScorecardView {
  scorecard: ScorecardModel; latestMonth: string; sourceNotes: string[];
  week?: { window: ScorecardWeek; markets: ReturnType<typeof compareScorecardWeeks> };
}

function completedPollUntil(poll: Facts['jobs'][number] | undefined): number {
  if (!poll?.last_success_at || poll.state.continuing) return NaN;
  // Pagination may finish after midnight; only the query's fixed upper bound was read.
  if (!Object.hasOwn(poll.state,'query')) return new Date(poll.last_success_at).getTime();
  if (typeof poll.state.query !== 'string') return NaN;
  const query = /^updated_at:>=([^\s]+)\s+updated_at:<=([^\s]+)$/.exec(poll.state.query);
  if (!query) return NaN;
  const bounds = query.slice(1).map(value=>{
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return NaN;
    const parsed=Date.parse(value),canonical=value.includes('.')?value:value.replace('Z','.000Z');
    return Number.isFinite(parsed)&&new Date(parsed).toISOString()===canonical?parsed:NaN;
  });
  return bounds.every(Number.isFinite)&&bounds[0]!<=bounds[1]!?bounds[1]!:NaN;
}

/** Actual report rows cover older days; an absent aggregate day must never become a measured zero. */
export function scorecardCoverage(facts: Facts, from: string, to: string, market: ScorecardInput['market']): { salesCoverage: string[]; orderCoverage: string[] } {
  const backfill = facts.jobs.find(job => job.name === 'backfill');
  const poll = facts.jobs.find(job => job.name === 'poll');
  const backfillUntil = backfill?.state.ordersDone && typeof backfill.state.until === 'string' ? Date.parse(backfill.state.until) : NaN;
  const pollUntil = completedPollUntil(poll);
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

export async function readScorecard(db: Database, store: ShopifyStore, env: NodeJS.ProcessEnv, month: string, market: ScorecardInput['market'], now: Date, weekEnding?: string): Promise<ScorecardView> {
  const window = scorecardMonth(month, now), latestMonth = scorecardMonth('', now).month;
  const weekWindow = scorecardWeek(weekEnding, now);
  const markets = ['uk', 'us'] as const;
  if (store.mode === 'sample') {
    const dates = [weekWindow.earlierFrom, weekWindow.from].flatMap(from => Array.from({ length: 7 }, (_, i) => addDays(from, i)));
    const spend = sampleSpend(weekWindow.earlierFrom, weekWindow.to, defaultSettings());
    const weeks = markets.map((market, index) => ({
      mode: 'sample' as const, market, spend, salesCoverage: dates, orderCoverage: dates,
      dailySales: dates.map((day, i) => ({ day, netSales: 142 + i * 8 + index * 25 })),
      dailyOrders: dates.map((day, i) => ({ day, orders: 12 + i + 3 * index })),
    }));
    return { scorecard: buildScorecard(await sampleScorecardInput(window.month, market, now)), latestMonth,
      week: { window: weekWindow, markets: compareScorecardWeeks(weekWindow, weeks) },
      sourceNotes: ['Sample data · all figures, product names and stock history on this page are invented.'] };
  }
  const settings = (await readSettings(db)).values;
  const facts = await store.facts(now), today = ukToday(now), data = dataset(facts, today);
  const [spend, weeklySpend] = await Promise.all([
    spendFacts(db, settings, env, 'live', window.yearFrom, window.to, now),
    weekWindow.earlierFrom >= window.yearFrom && weekWindow.to <= window.to ? null
      : spendFacts(db, settings, env, 'live', weekWindow.earlierFrom, weekWindow.to, now),
  ]);
  const weeks = markets.map(market => {
    const rows = dailyRows(facts, today, market);
    return {
      mode: 'live' as const, market, spend: weeklySpend ?? spend,
      ...scorecardCoverage(facts, weekWindow.earlierFrom, weekWindow.to, market),
      dailySales: rows.map(row => ({ day: row.date, netSales: row.net })),
      dailyOrders: rows.map(row => ({ day: row.date, orders: row.o })),
    };
  });
  const costs = await store.costHistory(), estimates = await readEstimates(db, 'live');
  const stockDaily = await readStockDaily(db, 'live', window.previousFrom, window.to);
  const input: ScorecardInput = { mode: 'live', month: window.month, market, now,
    orders: facts.records.filter(record => record.kind === 'order').map(record => record.data as Order).filter(order => order.day >= data.from),
    dailySales: dailyRows(facts, today, market).filter(row => row.date >= window.yearFrom && row.date <= window.to).map(row => ({ day: row.date, netSales: row.net })),
    ...scorecardCoverage(facts, window.yearFrom, window.to, market), spend, costs, estimates, settings, stockDaily,
    locations: (['uk', 'us'] as const).map(m => ({ market: m, locationId: appConfig.shopify.locations[m].id })),
    productLabels: Object.fromEntries(appConfig.shopify.stockProducts.map(product => [`gid://shopify/Product/${product.id}`, product.name])) };
  return { scorecard: buildScorecard(input), latestMonth, week: { window: weekWindow, markets: compareScorecardWeeks(weekWindow, weeks) }, sourceNotes: ['Live Shopify net sales; refunds reduce sales on their refund UK day. Shipping and tax are excluded.',
    ...spend.sources.map(source => `${adNames[source.source]}: ${source.live ? source.status : 'waiting for keys'}${source.fetchedAt ? ` · last fetched ${source.fetchedAt}` : ''}`),
    'Product stock history starts when daily captures begin. Earlier stock is not reconstructed.'] };
}
