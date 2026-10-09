import type { HeroPeriod } from '../dashboard-types.js';
import { addDays, dayCount } from '../hero-range.js';
import type { Settings } from '../settings.js';
import { costOrder, type ShopifyCost } from '../shopify/costs.js';
import type { Order } from '../shopify/model.js';
import { adNames, decimalMicros, type AdSource } from './model.js';
import type { SpendFacts } from './store.js';
export interface AdHeroInputs {
  spend: SpendFacts;
  costs: ShopifyCost[];
  estimates: { orderId: string; costPence: number | null; source: string }[];
}
const pounds = (micros: bigint) => Number(micros) / 1_000_000;
export function applySpend(
  hero: HeroPeriod,
  orders: Order[],
  settings: Settings,
  today: string,
  inputs: AdHeroInputs,
): void {
  const { spend, costs, estimates } = inputs,
    from = hero.from,
    to = hero.to;
  const selected = spend.rows.filter((r) => r.day >= from && r.day <= to),
    rows = selected.filter((r) => r.currency === 'GBP');
  const usable = spend.sources.filter((s) => s.ready && (spend.mode === 'sample' || s.live));
  const covered = new Set(
    spend.days.filter((d) => d.day >= from && d.day <= to).map((d) => d.source),
  );
  const available = usable.some((s) => covered.has(s.source));
  const live = usable.map((s) => adNames[s.source]),
    waiting = spend.sources
      .filter((s) => !s.live && spend.mode === 'live')
      .map((s) => adNames[s.source]);
  const base =
    spend.mode === 'sample'
      ? 'Sample ad spend'
      : live.length === 3
        ? 'Meta + Google + TikTok'
        : live.length
          ? `${live.join(' + ')} only`
          : 'Ad spend waiting for keys';
  const partial = usable.some(
    (s) =>
      spend.days.filter((d) => d.source === s.source && d.day >= from && d.day <= to).length <
      dayCount(from, to),
  );
  const issues = spend.sources
    .filter((s) => s.live && s.status !== 'live')
    .map((s) => `${adNames[s.source]} ${s.status}`);
  const label = [
    base,
    ...(waiting.length ? [`${waiting.join(' and ')} waiting for keys`] : []),
    ...(partial ? ['incomplete range coverage'] : []),
    ...issues,
  ].join('; ');
  const sum = (filter: (r: (typeof rows)[number]) => boolean = () => true) =>
    rows.filter(filter).reduce((s, r) => s + decimalMicros(r.amount), 0n);
  const total = pounds(sum()),
    unknown = pounds(sum((r) => r.market === 'unknown'));
  const sourceIds = usable.map((s) => s.source);
  const split: [string, string][] = (
    [
      ['Meta ours', pounds(sum((r) => r.source === 'meta' && r.owner === 'ours'))],
      ['Meta freelancer', pounds(sum((r) => r.source === 'meta' && r.owner === 'freelancer'))],
      ['Meta unassigned', pounds(sum((r) => r.source === 'meta' && r.owner === 'unassigned'))],
      ['Google', pounds(sum((r) => r.source === 'google-ads'))],
      ['TikTok', pounds(sum((r) => r.source === 'tiktok'))],
    ] as [string, number][]
  ).map(([name, value]) => [name, `£${value.toFixed(2)}`]);
  split.push(['Unknown market', `£${unknown.toFixed(2)} not split into UK or US`]);
  for (const source of spend.sources)
    split.push([
      `${adNames[source.source]} freshness`,
      `${source.fetchedAt ?? source.status}${source.source === 'google-ads' ? ' · Google can lag about 3 hours · hours re-aligned to UK time' : source.source === 'tiktok' ? ' · hours re-aligned to UK time' : ''}`,
    ]);
  for (const source of new Set(selected.filter((r) => r.currency !== 'GBP').map((r) => r.source)))
    split.push([
      adNames[source],
      `${[...new Set(selected.filter((r) => r.source === source && r.currency !== 'GBP').map((r) => r.currency))].join(', ')} not counted; no conversion`,
    ]);
  hero.spend = {
    ...hero.spend,
    n: total,
    dp: 2,
    mode: spend.mode,
    source: sourceIds,
    unavailable: !available,
    state: to === today ? 'sofar' : 'info',
    ss: label + (to === today ? ' · so far' : ''),
    d: {
      why: `Total spend £${total.toFixed(2)}. ${label}.`,
      rule: 'GBP spend only. Re-fetches replace daily rows. Unknown-market spend counts in All and is never shared out.',
      src: label,
      extra: split,
    },
  };
  hero.roas = {
    ...hero.roas,
    unavailableLabel: '—',
    n: total > 0 ? hero.net.n / total : 0,
    dp: 2,
    mode: spend.mode,
    source: ['shopify', ...sourceIds],
    unavailable: !available || hero.net.unavailable || total === 0 || hero.net.n === 0,
    state: to === today ? 'sofar' : 'info',
    ss: label + (to === today ? ' · so far' : ''),
    d: {
      why: 'Shopify net sales divided by all counted ad spend.',
      rule: 'No division when spend or sales is zero. A live numerator never uses sample spend.',
      src: label,
      extra: split,
    },
  };
  const periodOrders = orders.filter(
    (o) => o.day >= from && o.day <= to && !o.test && !o.cancelledAt,
  );
  let landed = 0,
    missingLanded = 0,
    fulfilment = 0,
    missingFulfilment = 0,
    shippingNet = 0;
  const byOrder = new Map(estimates.map((e) => [e.orderId, e]));
  for (const o of periodOrders) {
    const shippingTax = Math.max(0, o.taxPence - o.itemTaxPence);
    shippingNet += Math.max(0, o.shippingPence - (o.taxesIncluded ? shippingTax : 0));
    const cost = costOrder(o, costs, settings);
    landed += cost.lines.reduce((s, l) => s + (l.costPence ?? 0), 0);
    if (cost.costPence === null) missingLanded++;
    const estimate = byOrder.get(o.id);
    if (estimate?.costPence != null) fulfilment += estimate.costPence;
    else missingFulfilment++;
  }
  const fees =
    settings.paymentFeePercent === null
      ? 0
      : Math.round(Math.max(0, hero.net.n) * settings.paymentFeePercent);
  const omitted = [
    ...(missingLanded ? ['unknown landed costs'] : []),
    ...(missingFulfilment ? ['unknown fulfilment costs'] : []),
    ...(settings.paymentFeePercent === null ? ['payment fees'] : []),
    ...(periodOrders.length < hero.orders.n ? ['older order cost detail'] : []),
  ];
  hero.margin = {
    ...hero.margin,
    unavailableLabel: '—',
    n:
      hero.net.n > 0
        ? (100 *
            (hero.net.n + shippingNet / 100 - landed / 100 - fulfilment / 100 - fees / 100 - total)) /
          hero.net.n
        : 0,
    dp: 1,
    mode: spend.mode,
    source: ['shopify', ...sourceIds],
    unavailable: !available || hero.net.unavailable || total === 0 || hero.net.n <= 0,
    state: to === today ? 'sofar' : 'est',
    ss: `Estimate${omitted.length ? `; left out: ${omitted.join(', ')}` : ''} · ${label}${to === today ? ' · so far' : ''}`,
    d: {
      why: 'Net sales plus shipping income net of tax, less available landed costs, fulfilment, payment fees and all counted ad spend, divided by net sales. Shipping income is added because fulfilment includes postage.',
      rule: 'Shipping income is added net of tax because fulfilment includes postage; shipping refunds not yet deducted. Net sales remains the divisor and the payment-fee basis. Cancelled and test orders are excluded. Discounts are already deducted in Shopify net sales, so are not subtracted twice. Unknown costs are named and left out. Item refunds reduce sales on their UK day; no unobserved stock returns or fee refunds are assumed.',
      src: label,
      extra: [
        ...split,
        [
          'Landed costs',
          `£${(landed / 100).toFixed(2)}${missingLanded ? `; unknown costs on ${missingLanded} orders left out` : ''}`,
        ],
        ['Shipping charged', `£${(shippingNet / 100).toFixed(2)} · net of tax`],
        [
          'Fulfilment',
          `£${(fulfilment / 100).toFixed(2)}${missingFulfilment ? `; ${missingFulfilment} unknown orders left out` : ''}`,
        ],
        [
          'Fees',
          settings.paymentFeePercent === null
            ? 'Not set; left out'
            : `£${(fees / 100).toFixed(2)} · Settings percentage of net sales`,
        ],
        ['Discounts', 'Already deducted in net sales'],
        ['Left out', omitted.join(', ') || 'None of these components'],
      ],
    },
  };
  for (const [key, market] of [
    ['ukcpo', 'uk'],
    ['uscpo', 'us'],
  ] as const) {
    const count = periodOrders.filter((o) => o.market === market.toUpperCase()).length,
      cost = pounds(sum((r) => r.market === market)),
      value =
        count && periodOrders.length >= hero.orders.n && !hero.orders.unavailable
          ? cost / count
          : null;
    hero[key] = {
      ...hero[key],
      v: value ?? 0,
      t: available && value !== null ? `£${value.toFixed(2)}` : '—',
      l: `${market.toUpperCase()} cost per order`,
      s: `${label}${periodOrders.length < hero.orders.n ? '; older order market detail unavailable' : ''} · bar £${settings.blendedMetaTripwireGbp}`,
      source: ['shopify', ...sourceIds],
      mode: spend.mode,
      cap: to === today ? 'sofar' : 'info',
      d: {
        why: `${market.toUpperCase()} spend £${cost.toFixed(2)} ÷ ${count} Shopify orders. £${unknown.toFixed(2)} unknown-market spend is not split.${periodOrders.length < hero.orders.n ? ' Older order market detail is unavailable; no denominator is guessed.' : ''}`,
        rule: 'Meta + Google + TikTok spend in this market ÷ Shopify orders in this market. CAC awaits stage 2: stored Shopify facts do not identify first orders.',
        src: label,
        extra: split,
      },
    };
  }
}
export function spendNeeds(facts: SpendFacts, settings: Settings, today: string) {
  if (facts.mode === 'sample') return [];
  const needs: { id: string; state: 'warn'; title: string; why: string; link: string }[] = [],
    seen = new Set<string>();
  const add = (id: string, title: string, why: string) => {
    if (!seen.has(id)) {
      seen.add(id);
      needs.push({ id, state: 'warn', title, why, link: '/settings' });
    }
  };
  for (const row of facts.rows) {
    if (row.source === 'meta' && row.owner === 'unassigned')
      add(
        `ad-owner:${row.campaignId}`,
        'Meta campaign not assigned: set its owner in Settings',
        row.campaignName,
      );
    if (row.market === 'unknown')
      add(
        `ad-market:${row.source}:${row.campaignId}`,
        `${adNames[row.source]} campaign market unknown`,
        `${row.campaignName}: spend counts in All, not split into UK or US.`,
      );
    if (row.currency !== 'GBP')
      add(
        `ad-currency:${row.source}`,
        `${adNames[row.source]} reports in ${row.currency}: not counted`,
        'No currency conversion is applied.',
      );
  }
  for (const expected of settings.expectedGoogleCampaigns) {
    const missing = facts.days.filter(
      (d) =>
        d.source === 'google-ads' &&
        d.day <= addDays(today, -2) &&
        !facts.rows.some(
          (r) =>
            r.source === 'google-ads' && r.campaignId === expected.campaignId && r.day === d.day,
        ),
    );
    if (missing.length)
      add(
        `ad-expected:${expected.campaignId}`,
        'Expected Google campaign has no rows for a complete day',
        `Campaign ${expected.campaignId} · ${missing[0]!.day}${missing.length > 1 ? ' and other complete days' : ''}`,
      );
  }
  return needs;
}
