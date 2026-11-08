import { appConfig } from '../config.js';

interface FlagDay { date: string; o: number; firstOrders?: number; flaggedOrders?: number }

/** Calendar-day age is stable across the UK clock change. */
export function firstOrderRecentAfter(today: string): string {
  return new Date(Date.parse(`${today}T00:00:00Z`) - appConfig.shopify.firstOrderCoverage.graceDays * 86_400_000).toISOString().slice(0, 10);
}

/** Unknown flags never enter the first-order denominator. */
export function firstOrderCoverage(rows: readonly FlagDay[], today: string) {
  const recentAfter = firstOrderRecentAfter(today);
  let orders = 0, firstOrders = 0, unflagged = 0, recentUnflagged = 0;
  for (const row of rows) {
    const unknown = Math.max(0, row.o - (row.flaggedOrders ?? 0));
    orders += row.o;
    firstOrders += row.firstOrders ?? 0;
    unflagged += unknown;
    if (row.date > recentAfter) recentUnflagged += unknown;
  }
  return { orders, firstOrders, unflagged, recentUnflagged,
    useFirstOrders: orders > 0 && recentUnflagged === 0 && unflagged / orders <= appConfig.shopify.firstOrderCoverage.maxUnknownShare };
}

export function firstOrderCoverageRule(): string {
  const policy = appConfig.shopify.firstOrderCoverage;
  return `First-order CAC uses only known first orders. Unknown orders wait ${policy.graceDays} UK calendar days; after that, up to ${policy.maxUnknownShare * 100}% may stay unflagged and are excluded from its denominator. Otherwise use all counted orders and show the waiting count.`;
}
