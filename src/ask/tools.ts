import { placedSpendRows, usableSpendSources } from '../ad-spend/metrics.js';
import { adNames, decimalMicros } from '../ad-spend/model.js';
import { spendFacts } from '../ad-spend/store.js';
import { appConfig } from '../config.js';
import { readCreativeOverview } from '../creatives/routes.js';
import type { CreativeSelection } from '../creatives/presentation-types.js';
import type { DashboardSnapshot, HeroMarket } from '../dashboard-types.js';
import type { Database } from '../db.js';
import { handoverCount } from '../gorgias/home-count.js';
import { readGorgiasFacts } from '../gorgias/store.js';
import { addDays, ukToday } from '../hero-range.js';
import { readIssues } from '../issues/store.js';
import { readReviews } from '../judgeme/store.js';
import { readKitFacts } from '../kits/store.js';
import { scorecardCoverage } from '../scorecard/store.js';
import type { SeriesPaceMarketView } from '../series-pace/presentation.js';
import type { Settings } from '../settings.js';
import { countedOrder, dailyRows, dataset, kitIds, type Facts } from '../shopify/metrics.js';
import { ShopifyStore } from '../shopify/store.js';
import { readSourceHealth } from '../sources.js';
import { readWaitingView } from '../waiting-on/store.js';
import type { AskSource, AskTool, AskToolOutput } from './protocol.js';

function periodDates(period: string, today: string): [string, string] {
  if (period === 'today') return [today, today];
  return [addDays(today, period === '30d' ? -30 : period === '7d' ? -7 : -1), addDays(today, -1)];
}

const source = (name: string, asOf: Date | string | null | undefined): AskSource => ({
  name, asOf: asOf ? new Date(asOf).toISOString() : null,
});
const output = (data: unknown, ...sources: AskSource[]): AskToolOutput => ({ data, sources });
const shopifyTime = (facts: Facts) => facts.jobs.find(job => job.name === 'poll')?.last_success_at;

/** Only catalog and campaign labels cross the model boundary. Free-form notes and people do not. */
function label(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length <= 100 && /^[\p{L}\p{N}][\p{L}\p{N} _.,&'’()+/|-]*$/u.test(trimmed)
    && !/\b\d[\d ()-]{6,}\d\b/.test(trimmed) ? trimmed : null;
}

function salesData(facts: Facts, settings: Settings, today: string, from: string, to: string, market: HeroMarket) {
  const data = dataset(facts, today);
  const historyEnd = to === today ? addDays(today, -1) : to;
  const history = scorecardCoverage(facts, from, historyEnd, market);
  const expected = from > historyEnd ? 0 : (Date.parse(historyEnd) - Date.parse(from)) / 86_400_000 + 1;
  const currentCovered = to !== today || data.ready && !!shopifyTime(facts);
  const ordersKnown = currentCovered && history.orderCoverage.length === expected;
  const salesKnown = currentCovered && history.salesCoverage.length === expected;
  const orders = data.orders.filter(order => countedOrder(order, market) && order.day >= from && order.day <= to);
  const rows = dailyRows(facts, today, market).filter(row => row.date >= from && row.date <= to);
  const skus = new Set((settings as { series?: readonly { sku: string }[] }).series?.map(row => row.sku));
  const kitUnits = orders.reduce((sum, order) => sum + order.lines.reduce((units, line) => {
    const productId = line.productId ?? '';
    const kitProduct = appConfig.shopify.stockProducts.find(product => `gid://shopify/Product/${product.id}` === productId);
    if (!skus.has(line.sku ?? '') && !kitIds.includes(productId)) return units;
    return units + line.quantity * (kitProduct?.name === 'DUO PACK' ? 2 : 1);
  }, 0), 0);
  return { from, to, market, orders: ordersKnown ? orders.length : null, kitUnits: ordersKnown ? kitUnits : null,
    netSalesGbp: salesKnown ? Math.round(rows.reduce((sum, row) => sum + row.net, 0) * 100) / 100 : null };
}

interface StockToolRow {
  name: string; market: 'uk' | 'us'; kit: boolean;
  available: number | null; rate: number | null; observedDays: number;
  inbound: { expectedDate: string; quantity: number }[];
  gaps: { from: string; to: string; days: number }[];
  orderBy: string | null; runOut: string | null; setSupplier: boolean;
  coverage: { kits: number; covered: number; shortfall: number } | null;
}

function stockProduct(row: StockToolRow) {
  return {
    product: label(row.name),
    kit: row.kit,
    available: row.available,
    rate: row.rate,
    observedDays: row.observedDays,
    inbound: row.inbound.map(({ expectedDate, quantity }) => ({ expectedDate, quantity })),
    gaps: row.gaps.map(({ from, to, days }) => ({ from, to, days })),
    runOut: row.runOut,
    orderBy: row.orderBy,
    setSupplier: row.setSupplier,
    coverage: row.coverage && { kits: row.coverage.kits, covered: row.coverage.covered, shortfall: row.coverage.shortfall },
  };
}

type ReadStock = (db: Database, store: ShopifyStore, now: Date) => Promise<{
  mode: 'sample' | 'live'; rows: StockToolRow[]; asOf: string | null;
}>;

async function stockReader(): Promise<ReadStock | undefined> {
  // Ask can stay up during a planner-only rollback. Keep the tool in the stable provider schema.
  const modulePath = '../stock/planner-store.js';
  try {
    const module = await import(modulePath) as { readStockPlanner: ReadStock };
    return module.readStockPlanner;
  } catch (error) {
    if ((error as { code?: string })?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    return undefined;
  }
}

type PaceToolEntry = { market: 'UK' | 'US'; model: SeriesPaceMarketView & { seriesName?: string; sku?: string } };
export interface AskToolContext {
  db: Database; settings: Settings; env: NodeJS.ProcessEnv; now: Date;
  readStock?: ReadStock; readDashboard?: () => Promise<DashboardSnapshot>;
}

/** Only handlers in this switch receive a SQL connection, in an enforced read-only transaction. */
export function dashboardAskTool({ db, settings, env, now, readStock, readDashboard }: AskToolContext): AskTool {
  const today = ukToday(now);
  return (name, input) => db.transaction(async connection => {
    await connection.query('SET TRANSACTION READ ONLY');
    await connection.query("SET LOCAL statement_timeout = '8s'");
    // Card readers may use Promise.all with a pool. A transaction uses one client.
    let queue = Promise.resolve();
    const tx: Database = { ...connection, query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]) {
      const pending = queue.then(() => connection.query<Row>(sql, params));
      queue = pending.then(() => {}, () => {});
      return pending;
    } };
    const store = new ShopifyStore(tx, 'live');
    const market = (input.market ?? 'all') as HeroMarket;
    switch (name) {
      case 'sales': {
        const facts = await store.facts(now), [from, to] = periodDates(input.period!, today);
        return output(salesData(facts, settings, today, from, to, market), source('Shopify orders and sales', shopifyTime(facts)));
      }
      case 'ads': {
        const [from, to] = periodDates(input.period!, today);
        const spend = await spendFacts(tx, settings, env, 'live', from, to, now), facts = await store.facts(now);
        const sales = salesData(facts, settings, today, from, to, market);
        const selected = usableSpendSources(spend, from, to, today).filter(row => input.platform === 'all' || row.source === input.platform);
        const data = selected.map(platform => {
          const days = new Set(spend.days.filter(day => day.source === platform.source).map(day => day.day));
          const span = (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;
          const complete = Array.from({ length: span }, (_, i) => addDays(from, i)).every(day => days.has(day));
          const rows = placedSpendRows(spend, from, to, today, market).filter(row => row.source === platform.source && row.day >= from && row.day <= to);
          const total = Number(rows.reduce((sum, row) => sum + decimalMicros(row.amount), 0n)) / 1_000_000;
          return { platform: adNames[platform.source], spendGbp: complete ? total : null,
            costPerOrderGbp: complete && sales.orders ? Math.round(100 * total / sales.orders) / 100 : null,
            roas: complete && total > 0 && sales.netSalesGbp !== null ? Math.round(100 * sales.netSalesGbp / total) / 100 : null,
            campaignNames: [...new Set(rows.map(row => label(row.campaignName)).filter(Boolean))].slice(0, 15),
          };
        });
        return output({ from, to, market, shopifyOrders: sales.orders, platforms: data },
          ...selected.map(row => source(adNames[row.source], row.fetchedAt)),
          source('Shopify orders and sales', shopifyTime(facts)));
      }
      case 'creatives': {
        if (!env.META_ACCESS_TOKEN?.trim() || !settings.metaAdAccountId) return output(null);
        const view = await readCreativeOverview(tx, settings, env, now, { market, window: input.window as CreativeSelection['window'] }, { seedSample: false });
        const at = (await readSourceHealth(tx)).find(row => row.source === 'meta')?.lastSuccessAt;
        return output({ from: view.top.from, to: view.top.to, market, underFloor: view.top.underFloor,
          creatives: view.top.groups.map(row => ({ creative: label(row.group.title), spendGbp: row.totals.spend,
            purchases: row.totals.purchases, costPerPurchaseGbp: row.totals.costPerPurchase, roas: row.totals.roas })) },
        source('Meta creatives', at));
      }
      case 'series_pace': {
        const dashboard = await readDashboard?.();
        const widget = dashboard?.widgets.w017;
        if (widget?.kind !== 'series-pace' || widget.mode !== 'live') return output(null);
        const entries = (widget.value as { entries?: PaceToolEntry[] }).entries
          ?? (['UK', 'US'] as const).map(market => ({ market, model: widget.value.markets[market] } satisfies PaceToolEntry));
        const at = dashboard?.sourceHealth?.find(row => row.source === 'shopify')?.lastSuccessAt;
        return output(entries.filter(row => market === 'all' || row.market.toLowerCase() === market).map(({ market, model }: PaceToolEntry) => ({
          product: label(model.seriesName ?? 'Series 1'), sku: model.sku, market, stock: model.stock,
          average: model.average, through: model.completeThrough, needed: model.needed, projectedDate: model.projectedDate, targetDate: model.targetDate,
        })), source('Shopify inventory and sell-out pace', at));
      }
      case 'stock': {
        const reader = readStock ?? await stockReader();
        if (!reader) return output(null);
        const view = await reader(tx, store, now);
        if (view.mode !== 'live') return output(null);
        const markets = market === 'all' ? ['uk', 'us'] : [market];
        const warehouses = markets.map(region => ({
          warehouse: region.toUpperCase(),
          products: view.rows.filter(row => row.market === region).map(stockProduct),
        }));
        return output({ warehouses }, source('Shopify stock planner', view.asOf));
      }
      case 'kits': {
        if (!env.GITHUB_HQ_TOKEN?.trim()) return output(null);
        const facts = await readKitFacts(tx, 'live', now);
        return output({ status: facts.kits.status, kits: facts.kits.rows.map(row => ({
          product: label(row.name), stage: row.gate, launchDate: row.launchTarget,
        })) }, source('HQ kit board', facts.kits.readAt));
      }
      case 'handover_issues': {
        const handover = handoverCount(await readGorgiasFacts(tx, env, settings, now), 'live');
        const issues = await readIssues(tx, env, settings, now, 'live');
        return output({ handover: handover?.current ? handover.open : null, status: issues.status,
          thisMonth: issues.thisMonth, lastMonth: issues.lastMonth, reasons: issues.status === 'ready'
            ? issues.rows.map(({ reason, current, previous }) => ({ reason, current, previous })) : [] },
        ...(handover ? [source('Gorgias handover', handover.checkedAt)] : []), source('Pulse Issues', issues.checkedAt));
      }
      case 'reviews': {
        if (!env.JUDGEME_API_TOKEN?.trim()) return output(null);
        const view = await readReviews(tx, now), counts = new Map<string, { product: string | null; stars: number; count: number }>();
        for (const row of view.rows) {
          const product = label(row.productTitle), key = JSON.stringify([product, row.rating]);
          const item = counts.get(key) ?? { product, stars: row.rating, count: 0 };
          item.count++; counts.set(key, item);
        }
        return output({ status: view.status, groups: [...counts.values()] }, source('Judge.me reviews awaiting a decision', view.checkedAt));
      }
      case 'waiting': {
        const view = await readWaitingView(tx, env.GITHUB_HQ_TOKEN?.trim() ? 'live' : 'sample', now, settings.waitingOnDays);
        if (view.mode !== 'live') return output(null);
        return output({ status: view.status, count: view.rows.length, waiting: view.rows.map(({ since, days }) => ({ since, days })) },
          source('Handover · Waiting on others', view.readAt));
      }
    }
  });
}
