import { adSources, type SpendRow } from '../ad-spend/model.js';
import { addDays } from '../hero-range.js';
import { defaultSettings } from '../settings.js';
import { cleanOrder, type Order } from '../shopify/model.js';
import { orderInMarket } from '../shopify/order-market.js';
import { fixture } from '../shopify/sample.js';
import { scorecardMonth, type ScorecardInput } from './metrics.js';
import type { StockDailyRow } from './stock-daily.js';

/** Invented monthly examples follow the selected calendar month; they never enter live storage. */
export async function sampleScorecardInput(month: string, market: ScorecardInput['market'], now: Date): Promise<ScorecardInput> {
  const window = scorecardMonth(month, now);
  const base = cleanOrder((await fixture('order')).data.order) as Order;
  const products = ['Invented Comet kit', 'Invented Orbit sleeves', 'Invented Prism case', 'Invented Echo pack', 'Invented Nova tray', 'Invented Lunar binder']
    .map((label, index) => ({ label, productId: `gid://shopify/Product/${990000000201 + index}`, sku: `INVENTED-SCORE-${index}`, index }));
  const locations = [{ market: 'uk' as const, locationId: 'gid://shopify/Location/990000000301' }, { market: 'us' as const, locationId: 'gid://shopify/Location/990000000302' }];
  const orders: Order[] = [], stockDaily: StockDailyRow[] = [], rows: SpendRow[] = [], dates: string[] = [];
  const settings = defaultSettings();
  settings.paymentFeePercent = 2;
  settings.startingCogs = products.map(product => ({ sku: product.sku, unitCostGbp: 7 + product.index }));
  settings.overheads = [{ name: 'Invented monthly service', monthlyGbp: 240, startMonth: '', endMonth: '' }];
  let serial = 0;
  for (let day = window.yearFrom; day <= window.to; day = addDays(day, 1)) {
    dates.push(day);
    const current = day >= window.from, dateNumber = Number(day.slice(-2));
    for (const location of locations) for (const product of products) {
      const quantity = 4 + product.index + (current ? (product.index < 3 ? 2 : -2) : 0);
      const itemsAfterDiscountsPence = quantity * (1900 + product.index * 250);
      const id = `invented-score-order-${++serial}`, createdAt = `${day}T12:00:00.000Z`;
      orders.push({ ...base, id, orderNumber: null, createdAt, updatedAt: createdAt, day, cancelledAt: null, test: false,
        paidAt: createdAt, financialStatus: 'PAID', channel: 'Online Store', tags: [], currency: 'GBP', taxesIncluded: false,
        taxPence: 0, itemTaxPence: 0, shippingPence: 350, itemsAfterDiscountsPence, totalPence: itemsAfterDiscountsPence + 350,
        market: location.market.toUpperCase(), marketBasis: 'country', country: location.market === 'uk' ? 'GB' : 'US',
        region: null, postcodeArea: null, firstOrder: (dateNumber + product.index) % 7 === 0 ? 'unknown' : (dateNumber + product.index) % 3 ? 'first' : 'repeat',
        lines: [{ id: `invented-score-line-${serial}`, variantId: null, productId: product.productId, sku: product.sku, quantity }],
        refunds: [], fulfillments: [], discountSignals: [], firstVisit: null, lastVisit: null, giftTest: null });
      stockDaily.push({ mode: 'sample', day, locationId: location.locationId, inventoryItemId: `invented-score-item-${product.index}`,
        productId: product.productId, available: current && product.index === 4 && dateNumber === 12 ? 0 : 240,
        sourceId: `invented-score-stock-${day}-${location.market}-${product.index}`, takenAt: `${day}T00:05:00.000Z`, fetchedAt: `${day}T00:03:00.000Z`, source: 'shopify', brand: 'one-of-one' });
    }
    for (const [index, source] of adSources.entries()) for (const location of locations) rows.push({ source, accountId: `invented-score-${source}`,
      campaignId: `invented-score-${source}-${location.market}`, campaignName: `Invented score ${location.market.toUpperCase()}`,
      adSetId: null, adSetName: null, market: location.market, owner: 'ours', day, amount: ((28 + index * 9 + dateNumber % 4) * (current ? 1.15 : 1)).toFixed(2), currency: 'GBP', dayBasis: 'uk' });
  }
  const dailyTotals = new Map<string, number>();
  for (const order of orders.filter(order => orderInMarket(order, market))) dailyTotals.set(order.day, (dailyTotals.get(order.day) ?? 0) + order.itemsAfterDiscountsPence);
  return { mode: 'sample', month: window.month, market, now, orders,
    dailySales: dates.map(day => ({ day, netSales: (dailyTotals.get(day) ?? 0) / 100 })), salesCoverage: dates, orderCoverage: dates,
    spend: { mode: 'sample', rows, sources: adSources.map(source => ({ source, live: false, ready: true, status: 'sample', fetchedAt: now.toISOString() })),
      days: dates.flatMap(day => adSources.map(source => ({ source, day }))) },
    costs: [], estimates: orders.map(order => ({ orderId: order.id, costPence: 450, source: 'sample' })), settings, stockDaily, locations,
    productLabels: Object.fromEntries(products.map(product => [product.productId, product.label])) };
}
