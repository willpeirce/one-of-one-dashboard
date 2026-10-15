import type { HeroMarket, HeroPeriod } from '../dashboard-types.js';
import { addDays, dayCount, ukToday } from '../hero-range.js';
import type { Settings } from '../settings.js';
import { costOrder, type ShopifyCost } from '../shopify/costs.js';
import { isFreeOrder, paidOrder, type Order } from '../shopify/model.js';
import { overheadsForPeriod, sampleOverheads } from '../overheads.js';
import { profitAndMargin } from '../profit.js';
import { contributionMetric } from '../contribution.js';
import { formatNumber, formatPounds } from '../money.js';
import { adNames, decimalMicros, type AdSource } from './model.js';
import type { SpendFacts } from './store.js';
import { SPEND_STALE_AFTER_MS } from './worker.js';
import { spendMarket } from './placement.js';
import { isTikTok } from '../shopify/order-market.js';
export interface AdHeroInputs {
  spend: SpendFacts;
  costs: ShopifyCost[];
  estimates: { orderId: string; costPence: number | null; source: string }[];
  now?: Date;
  orderDetailsFrom?: string;
  market?: 'all' | 'uk' | 'us';
}
const pounds = (micros: bigint) => Number(micros) / 1_000_000;
type SpendGap = { source: AdSource; excluded: boolean; spend: string; dependent: string };
const fetchedTime = (value: string) => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short',
}).format(new Date(value)) + ' UK';
function spendGaps(facts: SpendFacts, from: string, to: string, today: string): SpendGap[] {
  if (facts.mode === 'sample') return [];
  const sources = facts.sources.filter((source) => source.live),
    coverage = new Map(sources.map(({ source }) => [source, new Set(facts.days
      .filter((day) => day.source === source && day.day >= from && day.day <= to)
      .map((day) => day.day))]));
  return sources.flatMap((source): SpendGap[] => {
    const name = adNames[source.source],
      backfill = source.status.startsWith('backfill running'),
      stale = source.stale || source.status.startsWith('stale'),
      unavailable = (source.failures ?? 0) > 0 || source.status === 'source unavailable',
      missing = unavailable || stale || !source.ready || (!backfill && source.status !== 'live');
    if (missing) {
      const since = stale && source.fetchedAt && !unavailable
        ? `stale since ${new Intl.DateTimeFormat('en-GB', {
          timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
        }).format(new Date(source.fetchedAt))}` : 'missing';
      return [{ source: source.source, excluded: true,
        spend: `${name} ${since} · ${stale && !unavailable ? 'total may be low' : `total excludes ${name}`}`,
        dependent: `Excludes ${name} spend` }];
    }
    // Healthy historical backfill keeps its existing progress label and known rows.
    if (backfill && to < today) return [];
    const days = coverage.get(source.source)!;
    if (days.size < dayCount(from, to))
      return [{ source: source.source, excluded: false,
        spend: `${name} missing days · total may be low`,
        dependent: `Excludes ${name} spend for missing days` }];
    return [];
  });
}
function gapLines(gaps: SpendGap[], kind: 'spend' | 'dependent'): string {
  return [...gaps.slice(0, 2).map((gap) => gap[kind]),
    ...(gaps.length > 2 ? [`+${gaps.length - 2} more`] : [])].join('\n');
}
/** Re-apply current name/owner rules to cached rows as well as new API reads. */
export function placedSpendRows(facts: SpendFacts, from: string, to: string, today: string, market: HeroMarket = 'all') {
  const excluded = new Set(spendGaps(facts, from, to, today).filter(gap => gap.excluded).map(gap => gap.source));
  if (facts.mode === 'live') for (const source of facts.sources) if (!source.live) excluded.add(source.source);
  return facts.rows.map(row => ({ ...row, market: spendMarket(row) }))
    .filter(row => row.currency === 'GBP' && !excluded.has(row.source) && (market === 'all' || row.market === market));
}

export function usableSpendSources(facts: SpendFacts, from: string, to: string, today: string) {
  const excluded = new Set(spendGaps(facts, from, to, today).filter(gap => gap.excluded).map(gap => gap.source));
  return facts.sources.filter(source => source.ready && !excluded.has(source.source) && (facts.mode === 'sample' || source.live));
}

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
  const gaps = spendGaps(spend, from, to, today),
    excluded = new Set(gaps.filter((gap) => gap.excluded).map((gap) => gap.source));
  const selected = spend.rows.filter((r) => r.day >= from && r.day <= to);
  const allRows = placedSpendRows(spend, from, to, today).filter(row => row.day >= from && row.day <= to);
  const rows = !inputs.market || inputs.market === 'all' ? allRows : allRows.filter(row => row.market === inputs.market);
  const usable = usableSpendSources(spend, from, to, today);
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
          : spend.sources.some((source) => source.live)
            ? 'No ad spend sources available'
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
    ...gaps.map((gap) => gap.dependent),
  ].join('; ');
  const soFar = to === today ? ' · so far' : '',
    spendSubtitle = gaps.length ? gapLines(gaps, 'spend') + soFar : label + soFar,
    dependentSubtitle = gaps.length ? gapLines(gaps, 'dependent') + soFar : label + soFar;
  const sum = (filter: (r: (typeof rows)[number]) => boolean = () => true) =>
    rows.filter(filter).reduce((s, r) => s + decimalMicros(r.amount), 0n);
  const total = pounds(sum()),
    unknown = pounds(allRows.filter(row => row.market === 'unknown').reduce((sum, row) => sum + decimalMicros(row.amount), 0n));
  const sourceIds = usable.map((s) => s.source);
  const split: [string, string][] = (
    [
      ['Meta ours', pounds(sum((r) => r.source === 'meta' && r.owner === 'ours'))],
      ['Meta freelancer', pounds(sum((r) => r.source === 'meta' && r.owner === 'freelancer'))],
      ['Meta unassigned', pounds(sum((r) => r.source === 'meta' && r.owner === 'unassigned'))],
      ['Google', pounds(sum((r) => r.source === 'google-ads'))],
      ['TikTok', pounds(sum((r) => r.source === 'tiktok'))],
    ] as [string, number][]
  ).map(([name, value]) => [name, formatPounds(value)]);
  split.push(['Unknown market', `${formatPounds(unknown)} not split into UK or US`]);
  for (const source of spend.sources)
    split.push([
      `${adNames[source.source]} freshness`,
      `${gaps.some((gap) => gap.source === source.source) ? `${source.status} · ` : ''}${source.fetchedAt ?? source.status}${source.source === 'google-ads' ? ' · Google can lag about 3 hours · hours re-aligned to UK time' : source.source === 'tiktok' ? ' · hours re-aligned to UK time' : ''}`,
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
    state: gaps.length ? 'warn' : to === today ? 'sofar' : 'info',
    ss: `${spendSubtitle}${inputs.market && inputs.market !== 'all' && unknown ? ' · store-wide spend stays under All' : ''}`,
    d: {
      why: `Total spend ${formatPounds(total)}. ${label}.`,
      rule: 'GBP spend only. Re-fetches replace daily rows. Ad sets/campaign names place spend by market; unplaceable spend is store-wide under All only and is never shared out.',
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
    state: gaps.length ? 'warn' : to === today ? 'sofar' : 'info',
    ss: dependentSubtitle,
    d: {
      why: 'Shopify net sales divided by all counted ad spend.',
      rule: 'No division when spend or sales is zero. A live numerator never uses sample spend.',
      src: label,
      extra: split,
    },
  };
  const eligibleOrders = orders.filter(paidOrder);
  const countedOrders = eligibleOrders.filter(o => !isFreeOrder(o));
  hero.cac = { ...hero.cac, n: hero.orders.n ? total / hero.orders.n : 0, dp: 2, mode: spend.mode, source: ['shopify', ...sourceIds],
    unavailable: !available || hero.orders.unavailable, state: gaps.length ? 'warn' : hero.cac.state,
    ss: gaps.length ? dependentSubtitle : hero.cac.ss,
    d: { ...hero.cac.d, why: `${formatPounds(total)} all placed ad spend ÷ ${formatNumber(hero.orders.n)} counted orders = ${formatPounds(hero.orders.n ? total / hero.orders.n : 0)}.`, src: label } };
  const periodOrders = eligibleOrders.filter(
    (o) => o.day >= from && o.day <= to,
  );
  const periodRefunds = eligibleOrders.flatMap((order) => order.refunds).filter((refund) => {
    const day = ukToday(new Date(refund.createdAt));
    return day >= from && day <= to;
  });
  const shippingRefunds = periodRefunds.reduce((sum, refund) => sum + (refund.shippingNetPence ?? 0), 0);
  const missingShippingRefunds = periodRefunds.some((refund) => refund.shippingNetPence === undefined);
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
  const marketView = inputs.market !== undefined && inputs.market !== 'all';
  const overheads = overheadsForPeriod(
    hero.net.mode === 'sample' ? sampleOverheads() : settings.overheads,
    from, to, inputs.now ?? new Date(),
  );
  const overheadTotal = marketView ? 0 : overheads.total;
  const overheadRows: [string, string][] = marketView
    ? [['Overheads', 'Not deducted; overheads are not split by market']]
    : [
        ['Overheads', `${formatPounds(overheads.total)} · ${formatNumber(overheads.items.length)} items, spread daily across each month${hero.net.mode === 'sample' ? ' · sample data' : ''}`],
        ...overheads.items.slice(0, 8).map((item): [string, string] => [item.name, formatPounds(item.total)]),
        ...(overheads.items.length > 8 ? [['and ' + (overheads.items.length - 8) + ' more', 'Included in the Overheads total'] as [string, string]] : []),
      ];
  const omitted = [
    ...(missingLanded ? ['unknown landed costs'] : []),
    ...(missingFulfilment ? ['unknown fulfilment costs'] : []),
    ...(missingShippingRefunds ? ['older shipping refund detail'] : []),
    ...(settings.paymentFeePercent === null ? ['payment fees'] : []),
    ...(periodOrders.length < hero.orders.n || inputs.orderDetailsFrom && from < inputs.orderDetailsFrom ? ['older order cost detail'] : []),
    ...(!marketView && overheads.items.length === 0 ? ['overheads'] : []),
  ];
  const result = profitAndMargin({
    netSales: hero.net.n, shippingIncome: shippingNet / 100, shippingRefunds: shippingRefunds / 100,
    landedCost: landed / 100, fulfilment: fulfilment / 100,
    paymentFees: fees / 100, adSpend: total, overheads: overheadTotal,
  });
  const afterAds = `${formatPounds(result.contribution - total)}${gaps.length ? ` · ${gapLines(gaps, 'spend')}` : !available ? ' · ad spend unavailable' : ''}`;
  hero.contribution = contributionMetric({ result, net: hero.net,
    orders: hero.orders.unavailable || hero.aov.unavailable || inputs.orderDetailsFrom && from < inputs.orderDetailsFrom ? null : hero.orders.n,
    components: [
      ['Net sales', hero.net.unavailable ? 'Unknown' : formatPounds(hero.net.n)],
      ['Shipping income net of tax', formatPounds(shippingNet / 100)],
      ['Shipping refunds', `${formatPounds(shippingRefunds / 100)}${missingShippingRefunds ? '; older refund detail awaiting refresh' : ''}`],
      ['Landed cost', `${formatPounds(landed / 100)}${missingLanded ? `; unknown costs on ${formatNumber(missingLanded)} orders left out` : ''}`],
      ['Fulfilment', `${formatPounds(fulfilment / 100)}${missingFulfilment ? `; ${formatNumber(missingFulfilment)} unknown orders left out` : ''}`],
      ['Payment fees', settings.paymentFeePercent === null ? 'Not set; left out' : `${formatPounds(fees / 100)} · Settings percentage of net sales`],
    ],
    afterAds, omitted: omitted.filter(item => item !== 'overheads'), soFar: to === today,
    rule: 'Shipping income is added net of tax because fulfilment includes postage; shipping refunds are deducted net of tax on their refund UK day. Discounts are already deducted in net sales. The same paid orders as net sales supply costs; unpaid, cancelled and test orders are excluded. Unknown costs and older shipping refund detail awaiting refresh are named and left out. No unobserved stock returns or fee refunds are assumed.',
  });
  hero.margin = {
    ...hero.margin,
    unavailableLabel: '—',
    n: result.margin,
    dp: 1,
    mode: spend.mode,
    source: ['shopify', ...sourceIds],
    unavailable: !available || hero.net.unavailable || total === 0 || hero.net.n <= 0,
    state: gaps.length ? 'warn' : 'est',
    ...(marketView ? { statusLabel: 'store-wide' } : {}),
    ss: gaps.length
      ? `${dependentSubtitle.replaceAll(' · so far', '')}\n${marketView ? 'store-wide' : 'Estimate'}${omitted.length ? `; left out: ${omitted.join(', ')}` : ''}`
      : `${marketView ? 'store-wide' : 'Estimate'}${omitted.length ? `; left out: ${omitted.join(', ')}` : ''} · ${label}`,
    d: {
      why: `Net sales plus shipping income net of tax, less shipping refunds, less available landed costs, fulfilment, payment fees and all counted ad spend${marketView ? '' : ' and overheads'}, divided by net sales. ${marketView ? 'Store-wide: overheads are not split by market until the costs sheet is.' : 'Margin is after overheads.'} Shipping income is added because fulfilment includes postage.`,
      rule: `Monthly overhead items are spread evenly over each calendar month's days; today uses the elapsed fraction of the real UK day. ${marketView ? 'Store-wide: overheads are not split by market until the costs sheet is.' : 'Margin is after overheads.'} Shipping income is added net of tax because fulfilment includes postage; shipping refunds are deducted net of tax on their refund UK day. Net sales remains the divisor and the payment-fee basis. The same paid orders as net sales supply shipping income and costs; unpaid, cancelled and test orders are excluded. Discounts are already deducted in Shopify net sales, so are not subtracted twice. Unknown costs and older shipping refund detail awaiting refresh are named and left out. Item refunds reduce sales on their UK day; no unobserved stock returns or fee refunds are assumed.`,
      src: label,
      extra: [
        ['Net sales', formatPounds(hero.net.n)],
        [
          'Landed costs',
          `${formatPounds(landed / 100)}${missingLanded ? `; unknown costs on ${formatNumber(missingLanded)} orders left out` : ''}`,
        ],
        ['Shipping charged', `${formatPounds((shippingNet - shippingRefunds) / 100)} · net of tax${shippingRefunds ? `; ${formatPounds(shippingRefunds / 100)} shipping refunds deducted` : ''}${missingShippingRefunds ? '; older refund detail awaiting refresh' : ''}`],
        [
          'Fulfilment',
          `${formatPounds(fulfilment / 100)}${missingFulfilment ? `; ${formatNumber(missingFulfilment)} unknown orders left out` : ''}`,
        ],
        [
          'Fees',
          settings.paymentFeePercent === null
            ? 'Not set; left out'
            : `${formatPounds(fees / 100)} · Settings percentage of net sales`,
        ],
        ['Contribution', formatPounds(result.contribution)],
        ['Ad spend', formatPounds(total)],
        ['After ad spend', afterAds],
        ...overheadRows,
        ['Discounts', 'Already deducted in net sales'],
        ['Left out', omitted.join(', ') || 'None of these components'],
        ...split,
        ['Net profit', formatPounds(result.profit)],
      ],
    },
  };
  hero.profit = {
    ...hero.margin,
    n: result.profit,
    unavailable: !available || hero.net.unavailable || !Number.isFinite(result.profit),
    pre: '£',
    suf: '',
    dp: 2,
    d: {
      ...hero.margin.d,
      why: `Net profit is net sales plus shipping income net of tax, less shipping refunds, less available landed costs, fulfilment, payment fees and all counted ad spend${marketView ? '' : ' and overheads'}. ${marketView ? 'Store-wide: overheads are not split by market until the costs sheet is.' : 'Profit is after overheads.'} Shipping income is added because fulfilment includes postage. This is the same pound total used to calculate net margin.`,
    },
  };
  const meta = spend.sources.find(source => source.source === 'meta');
  const metaGaps = gaps.filter(gap => gap.source === 'meta');
  const metaAvailable = usable.some(source => source.source === 'meta' && covered.has('meta'));
  const metaCoveragePartial = metaAvailable && spend.days.filter(day => day.source === 'meta' && day.day >= from && day.day <= to).length < dayCount(from, to);
  const metaLabel = spend.mode === 'sample' ? 'Sample Meta spend' : metaAvailable ? `Meta${metaCoveragePartial ? '; incomplete range coverage' : ''}` : meta?.live ? 'No Meta spend available' : 'Meta waiting for keys';
  const metaSubtitle = metaGaps.length ? gapLines(metaGaps, 'dependent') + soFar : metaLabel + soFar;
  const metaUnknown = pounds(allRows.filter(row => row.source === 'meta' && row.market === 'unknown').reduce((sum, row) => sum + decimalMicros(row.amount), 0n));
  const metaSplit: [string, string][] = [
    ...split.filter(([name]) => name.startsWith('Meta ')),
    ['Unknown Meta market', `${formatPounds(metaUnknown)} not split into UK or US`],
    ...(selected.some(row => row.source === 'meta' && row.currency !== 'GBP') ? [['Meta currency', `${[...new Set(selected.filter(row => row.source === 'meta' && row.currency !== 'GBP').map(row => row.currency))].join(', ')} not counted; no conversion`] as [string, string]] : []),
  ];
  for (const [key, market] of [
    ['ukcpo', 'uk'],
    ['uscpo', 'us'],
  ] as const) {
    const count = countedOrders.filter(o => o.day >= from && o.day <= to && o.market === market.toUpperCase() && !isTikTok(o)).length,
      cost = pounds(sum((r) => r.market === market && r.source === 'meta')),
      value =
        count && periodOrders.length >= hero.orders.n && !hero.orders.unavailable
          ? cost / count
          : null;
    hero[key] = {
      ...hero[key],
      v: value ?? 0,
      t: metaAvailable && value !== null ? formatPounds(value) : '—',
      hidePointer: !metaAvailable || value === null,
      l: `${market.toUpperCase()} Meta cost per order`,
      s: `${metaSubtitle}${periodOrders.length < hero.orders.n ? '; older order market detail unavailable' : ''} · bar ${formatPounds(settings.blendedMetaTripwireGbp, formatNumber)}`,
      source: ['shopify', 'meta'],
      mode: spend.mode,
      cap: metaGaps.length ? 'warn' : !metaAvailable ? 'info' : to === today ? 'sofar' : 'info',
      d: {
        why: `${market.toUpperCase()} spend ${formatPounds(cost)} ÷ ${formatNumber(count)} Shopify orders. ${formatPounds(metaUnknown)} unknown-market Meta spend is not split.${periodOrders.length < hero.orders.n ? ' Older order market detail is unavailable; no denominator is guessed.' : ''}`,
        rule: 'Meta spend placed in this market ÷ counted Shopify orders in this market. Free orders and TikTok orders are excluded. CAC remains all placed ad spend per order until first orders can be told apart.',
        src: metaLabel,
        extra: metaSplit,
      },
    };
  }
}
export function spendNeeds(facts: SpendFacts, settings: Settings, today: string, now = new Date()) {
  if (facts.mode === 'sample') return [];
  const needs: { id: string; state: 'warn'; title: string; why: string; link: string }[] = [],
    seen = new Set<string>();
  const add = (id: string, title: string, why: string, link = '/settings') => {
    if (!seen.has(id)) {
      seen.add(id);
      needs.push({ id, state: 'warn', title, why, link });
    }
  };
  for (const source of facts.sources) {
    const lastActivity = source.fetchedAt ?? source.lastAttemptAt,
      stale = source.stale || source.status.startsWith('stale') ||
        (!!lastActivity && now.getTime() - new Date(lastActivity).getTime() > SPEND_STALE_AFTER_MS);
    if (source.live && ((source.failures ?? 0) >= 2 || stale))
      add(`ad-source:${source.source}`, `${adNames[source.source]} ad spend not updating`,
        `Last fetched ${source.fetchedAt ? fetchedTime(source.fetchedAt) : 'never'}. Totals that include ad spend leave it out until it recovers. Check Source health.`,
        '/sources');
  }
  for (const row of facts.rows) {
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
