import { AdError } from './model.js';
/** Shared with ad-level insights: aliases are alternatives, never summed twice. */
export const META_PURCHASE = 'omni_purchase';
export const META_ADD_TO_CART = 'omni_add_to_cart';
export function metaAction(value: unknown, name?: string): number {
  if (value == null) return 0;
  if (!Array.isArray(value)) throw new AdError('invalid');
  return value.filter(row => !name || row.action_type === name).reduce((sum, row) => {
    const n = Number(row.value ?? 0);
    if (!Number.isFinite(n) || n < 0) throw new AdError('invalid');
    return sum + n;
  }, 0);
}
