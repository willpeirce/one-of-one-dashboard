import type { Order } from './model.js';
import type { Settings } from '../settings.js';

export interface ShopifyCost {
  variant_id: string; inventory_item_id: string; product_id: string; sku: string | null;
  amount_pence: number | string | null; currency: string | null;
  first_seen_at: Date | string; last_seen_at: Date | string;
}
type CostSource = 'shopify' | 'settings' | 'unknown';

/** Observed cost history, not Shopify's unrecorded historical costs. GBP only; no guessed FX. */
export function costOrder(order: Pick<Order, 'createdAt' | 'lines'>, history: readonly ShopifyCost[], settings: Pick<Settings, 'startingCogs'>) {
  const at = Date.parse(order.createdAt);
  const lines = order.lines.map(line => {
    const byVariant = line.variantId ? history.filter(c => c.variant_id === line.variantId) : [];
    const candidates = (byVariant.length ? byVariant : history.filter(c => line.sku && c.sku === line.sku))
      .sort((a,b) => new Date(a.first_seen_at).getTime() - new Date(b.first_seen_at).getTime());
    const cost = candidates.filter(c => new Date(c.first_seen_at).getTime() <= at).at(-1) ?? candidates[0];
    const fallback = settings.startingCogs.find(c => c.sku === line.sku)?.unitCostGbp;
    let source: CostSource = 'unknown'; let unitCostPence: number | null = null;
    if (cost?.amount_pence !== null && cost?.amount_pence !== undefined) {
      if (cost.currency === 'GBP') { unitCostPence = Number(cost.amount_pence); source = 'shopify'; }
    } else if (fallback !== null && fallback !== undefined) { unitCostPence = Math.round(fallback * 100); source = 'settings'; }
    return { lineId: line.id, variantId: line.variantId ?? null, sku: line.sku, quantity: line.quantity,
      unitCostPence, costPence: unitCostPence === null ? null : unitCostPence * line.quantity, source };
  });
  const sources = [...new Set(lines.map(l => l.source))];
  const unknown = lines.some(l => l.costPence === null);
  // Settings means the total relies on at least one fallback; per-line sources retain mixed provenance.
  const source: CostSource = unknown ? 'unknown' : sources.includes('settings') ? 'settings' : 'shopify';
  return { lines, costPence: unknown ? null : lines.reduce((n,l) => n + l.costPence!, 0), source, sources };
}
