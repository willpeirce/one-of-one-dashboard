import { appConfig } from '../config.js';
import { ukToday } from '../hero-range.js';
import { ShopifyError } from './http.js';
export const gid = (kind: string, value: unknown): string => {
  const text = String(value ?? '');
  if (new RegExp(`^gid://shopify/${kind}/[0-9]+$`).test(text)) return text;
  if (/^[0-9]+$/.test(text)) return `gid://shopify/${kind}/${text}`;
  throw new ShopifyError('invalid');
};
function instant(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new ShopifyError('invalid');
  return new Date(value).toISOString();
}
function pence(value: any): number {
  if (value?.shopMoney?.currencyCode !== 'GBP' || !/^-?\d+(\.\d{1,2})?$/.test(value.shopMoney.amount)) throw new ShopifyError('invalid');
  return Math.round(Number(value.shopMoney.amount) * 100);
}
function postcode(value: unknown): string | null {
  // Retain the outward area only, even when an API sends an unspaced UK postcode.
  if (typeof value !== 'string') return null;
  const text = value.toUpperCase().trim();
  const match = /^([A-Z]{1,2}\d[A-Z\d]?)\s*\d[A-Z]{2}$/.exec(text);
  return match?.[1] ?? null;
}
function journey(visit: any): Record<string, unknown> | null {
  if (!visit) return null;
  const utm = visit.utmParameters;
  let url: URL | null = null;
  try { url = new URL(visit.landingPage); } catch {}
  return {
    // Click identifiers themselves are not needed for attribution.
    fbclid: Boolean(url?.searchParams.has('fbclid')), gclid: Boolean(url?.searchParams.has('gclid')), ttclid: Boolean(url?.searchParams.has('ttclid')),
    source: typeof utm?.source === 'string' && /^[\w .-]{1,60}$/.test(utm.source) ? utm.source : null,
    medium: typeof utm?.medium === 'string' && /^[\w-]{1,30}$/.test(utm.medium) ? utm.medium : null,
    campaign: typeof utm?.campaign === 'string' && /^[\w-]{1,100}$/.test(utm.campaign) ? utm.campaign : null,
  };
}
export function cleanOrder(raw: any) {
  if (typeof raw.taxesIncluded !== 'boolean') throw new ShopifyError('invalid');
  if (raw.lineItems.pageInfo.hasNextPage || raw.refunds.some((r: any) => r.refundLineItems.pageInfo.hasNextPage)) throw new ShopifyError('invalid');
  // Order tax also includes shipping tax. Only item tax belongs in the item subtotal.
  const itemTaxPence = raw.lineItems.nodes.reduce((total: number, line: any) => {
    if (!Array.isArray(line.taxLines)) throw new ShopifyError('invalid');
    return total + line.taxLines.reduce((n: number, tax: any) => n + pence(tax.priceSet), 0);
  }, 0);
  const itemsAfterDiscountsPence = pence(raw.subtotalPriceSet) - (raw.taxesIncluded ? itemTaxPence : 0);
  const refunds = raw.refunds.map((r: any) => {
    const taxPence = r.refundLineItems.nodes.reduce((n: number, l: any) => n + pence(l.totalTaxSet), 0);
    // Refunded item subtotals follow the order's inclusive/exclusive tax basis.
    const itemsPence = r.refundLineItems.nodes.reduce((n: number, l: any) => n + pence(l.subtotalSet), 0) - (raw.taxesIncluded ? taxPence : 0);
    return { id: gid('Refund', r.id), createdAt: instant(r.createdAt), itemsPence, taxPence };
  });
  const warehouses = raw.fulfillments.map((f: any) => f.location?.id).filter((id: unknown) => Object.values(appConfig.shopify.locations).some(l => l.id === id));
  const country = /^[A-Z]{2}$/.test(raw.shippingAddress?.countryCodeV2 ?? '') ? raw.shippingAddress.countryCodeV2 : null;
  const market = country === 'GB' ? 'UK' : country === 'US' ? 'US' : country && appConfig.shopify.euCountries.some(c => c === country) ? 'EU' : country ? 'unknown' : raw.currencyCode === 'USD' || warehouses.includes(appConfig.shopify.locations.us.id) ? 'US' : raw.currencyCode === 'GBP' || warehouses.includes(appConfig.shopify.locations.uk.id) ? 'UK' : 'unknown';
  const transactions = Array.isArray(raw.transactions) ? raw.transactions : [];
  const paidAt = transactions.length < 250 ? transactions
    .filter((t: any) => t.status === 'SUCCESS' && ['SALE', 'CAPTURE'].includes(t.kind) && t.processedAt != null)
    .map((t: any) => instant(t.processedAt)).sort().at(-1)
    // Zero-total and manually paid orders need no money transaction.
    ?? (raw.displayFinancialStatus === 'PAID' ? instant(raw.createdAt) : null) : null;
  const sourceChannels = new Map([['web', 'Online Store'], ['pos', 'Point of Sale'], ['shopify_draft_order', 'Draft Orders']]);
  const channelName = raw.channelInformation?.channelDefinition?.channelName;
  const channel = typeof channelName === 'string' && channelName.trim() ? channelName.slice(0, 100) : sourceChannels.get(raw.sourceName) ?? 'Unknown';
  return {
    orderNumber: typeof raw.name === 'string' && /^#[0-9]{1,20}$/.test(raw.name) ? raw.name.slice(1).replace(/^0+(?=\d)/, '') : null,
    id: gid('Order', raw.id), createdAt: instant(raw.createdAt), updatedAt: instant(raw.updatedAt), day: ukToday(new Date(raw.createdAt)),
    cancelledAt: raw.cancelledAt ? instant(raw.cancelledAt) : null, test: raw.test === true,
    channel, paidAt,
    fulfillmentStatus: raw.displayFulfillmentStatus ?? 'unknown',
    discountSignals: (raw.discountCodes ?? []).filter((c: string) => ['SHIPPINGONME', 'REFILLSHIP'].includes(c)),
    financialStatus: ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED', 'PARTIALLY_PAID', 'PENDING', 'AUTHORIZED', 'VOIDED', 'EXPIRED'].includes(raw.displayFinancialStatus) ? raw.displayFinancialStatus : 'unknown',
    currency: /^[A-Z]{3}$/.test(raw.currencyCode) ? raw.currencyCode : null,
    taxesIncluded: raw.taxesIncluded, itemTaxPence, itemsAfterDiscountsPence,
    taxPence: pence(raw.totalTaxSet), shippingPence: pence(raw.totalShippingPriceSet),
    customerId: raw.customer ? gid('Customer', raw.customer.id) : null,
    market, marketBasis: country ? 'country' : 'currency_and_warehouse', country,
    region: typeof raw.shippingAddress?.provinceCode === 'string' && /^[A-Z0-9-]{1,10}$/.test(raw.shippingAddress.provinceCode) ? raw.shippingAddress.provinceCode : null,
    postcodeArea: postcode(raw.shippingAddress?.zip),
    lines: raw.lineItems.nodes.map((l: any) => ({ id: gid('LineItem', l.id), variantId: l.variant ? gid('ProductVariant', l.variant.id) : null, productId: l.product ? gid('Product', l.product.id) : null, sku: /^[\w-]{1,80}$/.test(l.sku ?? '') ? l.sku : null, quantity: l.quantity })),
    // Theme test attributes only. Arbitrary note attributes are not stored.
    giftTest: ['A', 'B'].includes(raw.customAttributes?.find((a: any) => a.key === '__gift_test')?.value) ? raw.customAttributes.find((a: any) => a.key === '__gift_test').value : null,
    refunds,
    fulfillments: raw.fulfillments.map((f: any) => ({ id: gid('Fulfillment', f.id), status: ['SUCCESS', 'CANCELLED', 'ERROR', 'FAILURE', 'OPEN', 'PENDING'].includes(f.status) ? f.status : 'unknown', createdAt: instant(f.createdAt), updatedAt: instant(f.updatedAt), locationId: warehouses.includes(f.location?.id) ? f.location.id : null, lines: f.fulfillmentLineItems && !f.fulfillmentLineItems.pageInfo.hasNextPage ? f.fulfillmentLineItems.nodes.map((l: any) => ({ lineId: gid('LineItem', l.lineItem.id), quantity: l.quantity })) : null })),
    firstVisit: journey(raw.customerJourneySummary?.firstVisit), lastVisit: journey(raw.customerJourneySummary?.lastVisit),
  };
}
export function cleanInventory(raw: any) {
  const productId = gid('Product', raw.productId), locationId = gid('Location', raw.location.id);
  if (!appConfig.shopify.stockProducts.some(p => `gid://shopify/Product/${p.id}` === productId) || !Object.values(appConfig.shopify.locations).some(l => l.id === locationId)) return null;
  return { productId, variantId: gid('ProductVariant', raw.variantId), inventoryItemId: gid('InventoryItem', raw.inventoryItemId), locationId,
    quantities: raw.quantities.filter((q: any) => ['available', 'on_hand', 'committed'].includes(q.name)).map((q: any) => {
      if (!Number.isInteger(q.quantity)) throw new ShopifyError('invalid');
      return { name: q.name, quantity: q.quantity };
    }) };
}
export function reportRows(table: any): Record<string, unknown>[] {
  if (!Array.isArray(table.columns) || !Array.isArray(table.rows)) throw new ShopifyError('invalid');
  return table.rows.map((row: any) => Array.isArray(row) ? Object.fromEntries(table.columns.map((c: any, i: number) => [c.name, row[i]])) : row);
}
function count(value: unknown): number {
  const result = Number(value);
  if (!Number.isInteger(result) || result < 0) throw new ShopifyError('invalid');
  return result;
}
export function cleanSessions(table: any) {
  const days = new Map<string, any>();
  for (const row of reportRows(table)) {
    const day = String(row.day);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || ukToday(new Date(`${day}T12:00:00Z`)) !== day) throw new ShopifyError('invalid');
    const carts = count(row.sessions_with_cart_additions);
    if (row.landing_page_path === '/pages/inside' && String(row.session_device_type).toLowerCase() === 'desktop' && String(row.referrer_source).toLowerCase() === 'google' && carts === 0) continue;
    const total = days.get(day) ?? { day, sessions: 0, carts: 0, checkouts: 0, completed: 0, uk: 0, us: 0, missouri: 0, ukCarts: 0, usCarts: 0, ukCheckouts: 0, usCheckouts: 0, ukCompleted: 0, usCompleted: 0 };
    const sessions = count(row.sessions);
    total.sessions += sessions; total.carts += carts; total.checkouts += count(row.sessions_that_reached_checkout); total.completed += count(row.sessions_that_completed_checkout);
    if (['United Kingdom', 'GB'].includes(String(row.session_country))) { total.uk += sessions; total.ukCarts += carts; total.ukCheckouts += count(row.sessions_that_reached_checkout); total.ukCompleted += count(row.sessions_that_completed_checkout); }
    if (['United States', 'US'].includes(String(row.session_country))) {
      total.us += sessions; total.usCarts += carts; total.usCheckouts += count(row.sessions_that_reached_checkout); total.usCompleted += count(row.sessions_that_completed_checkout);
      if (['Missouri', 'MO'].includes(String(row.session_region))) total.missouri += sessions;
    }
    days.set(day, total);
  }
  return [...days.values()].map(d => ({ ...d, marketReliable: !['2026-09-22', '2026-09-23'].includes(d.day) && !(d.us > 0 && d.missouri / d.us > .1) }));
}
export function cleanSales(table: any) {
  return reportRows(table).map(r => {
    const day = String(r.day);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day))) throw new ShopifyError('invalid');
    if (!/^-?\d+(\.\d{1,2})?$/.test(String(r.net_sales))) throw new ShopifyError('invalid');
    return { day, orders: count(r.orders), netSalesPence: Math.round(Number(r.net_sales) * 100), provenance: 'shopifyql', market: 'unknown' };
  });
}

export type Order = Omit<ReturnType<typeof cleanOrder>, 'lines' | 'refunds' | 'fulfillments'> & {
  lines: { id: string; variantId?: string | null; productId: string | null; sku: string | null; quantity: number }[];
  refunds: { id: string; createdAt: string; itemsPence: number; taxPence: number }[];
  fulfillments: { id: string; status: string; createdAt: string; updatedAt: string; locationId: string | null; lines: { lineId: string; quantity: number }[] | null }[];
};
export type Inventory = Omit<NonNullable<ReturnType<typeof cleanInventory>>, 'quantities'> & { quantities: { name: string; quantity: number }[] };
export interface Sessions { day: string; sessions: number; carts: number; checkouts: number; completed: number; uk: number; us: number; missouri: number; ukCarts: number; usCarts: number; ukCheckouts: number; usCheckouts: number; ukCompleted: number; usCompleted: number; marketReliable: boolean; provenance?: string; partial?: boolean }
export function channelKey(name: string): string { return name.trim().toLowerCase().replace(/\s+/g, ' '); }
