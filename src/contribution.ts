import type { HeroMetric } from './dashboard-types.js';
import { formatNumber, formatPounds } from './money.js';
import type { profitAndMargin } from './profit.js';

/** Shared presentation for the sample preview and the calculated Shopify hero. */
export function contributionMetric(input: {
  result: ReturnType<typeof profitAndMargin>;
  net: HeroMetric;
  orders: number | null;
  components: [string, string][];
  afterAds: string;
  omitted: string[];
  soFar: boolean;
  rule: string;
}): HeroMetric {
  const { result, net, orders, components, afterAds, omitted, soFar, rule } = input;
  const unavailable = Boolean(net.unavailable) || !Number.isFinite(result.contribution);
  const percentage = unavailable ? null : result.contributionMargin;
  const perOrder = !unavailable && orders !== null && orders > 0 ? result.contribution / orders : null;
  return {
    n: result.contribution, pre: '£', dp: 2, state: 'est', mode: net.mode, source: ['shopify'],
    unavailable, unavailableLabel: 'Unknown',
    ss: `${percentage === null ? 'Unknown percentage of net sales' : `${formatNumber(percentage, 0)}% of net sales`}${perOrder === null ? '' : ` · ${formatPounds(perOrder)} an order`}\nEstimate${soFar ? ' · so far' : ''}${omitted.length ? `; left out: ${omitted.join(', ')}` : ''}`,
    d: {
      why: 'Contribution is net sales plus shipping income net of tax, less shipping refunds, landed cost, fulfilment and payment fees. It is the figure ads are judged against, before ad spend and overheads. The two rows after the total are further calculations, not parts of Contribution.',
      rule: `${rule} Left out: ${omitted.join(', ') || 'None of these components'}. Contribution has no goal; its background follows its own sign. Its percentage uses net sales; its per-order figure uses counted orders, excluding free orders. A missing or zero divisor is Unknown.`,
      src: net.d.src,
      extra: [...components, ['Contribution', unavailable ? 'Unknown' : formatPounds(result.contribution)],
        ['After ad spend', unavailable ? 'Unknown' : afterAds],
        ['Contribution an order', perOrder === null ? 'Unknown' : formatPounds(perOrder)]],
    },
  };
}
