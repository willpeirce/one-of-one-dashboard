import type { Detail, HeroMetric, HeroPeriod, State, Zone } from './dashboard-types.js';
import type { SourceId } from './sources.js';
import { profitAndMargin } from './profit.js';
import { contributionMetric } from './contribution.js';
import { formatNumber, formatPounds } from './money.js';

const DAY = 86_400_000;
const fields = ['net', 'o', 'uk', 'us', 'sess', 'ukS', 'ukM', 'usM', 'g', 'ours'] as const;

/** Additive day facts; neither aggregation nor range validation reads a source. */
export interface DailyMetrics {
  date: string;
  net: number;
  gross?: number;
  grossKnown?: boolean;
  o: number;
  uk: number;
  us: number;
  sess: number;
  ukS: number;
  usS?: number;
  adSpend?: number;
  spendKnown?: boolean;
  netKnown?: boolean;
  countsKnown?: boolean;
  firstOrders?: number;
  flaggedOrders?: number;
  sessionsKnown?: boolean;
  ukM: number;
  usM: number;
  g: number;
  ours: number;
}
export type Totals = Omit<DailyMetrics, 'date' | 'gross' | 'grossKnown' | 'usS' | 'adSpend' | 'spendKnown' | 'netKnown' | 'countsKnown' | 'sessionsKnown'> & {
  days: number; usS: number; meta: number; spend: number; ours: number;
};

export class HeroRangeError extends Error {
  readonly statusCode = 400;
  constructor() { super('Invalid date range.'); }
}

function realDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return false;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

export function ukToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((value) => value.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function addDays(date: string, count: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + count * DAY).toISOString().slice(0, 10);
}

export function dayCount(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY) + 1;
}

export function validateHeroRange(from: unknown, to: unknown, now = new Date()): { from: string; to: string } {
  if (!realDate(from) || !realDate(to) || from > to || to > ukToday(now) || dayCount(from, to) > 366) throw new HeroRangeError();
  return { from, to };
}

export function aggregateDays(rows: readonly DailyMetrics[]): Totals {
  const totals: Totals = { net: 0, o: 0, uk: 0, us: 0, sess: 0, ukS: 0, ukM: 0, usM: 0, g: 0, days: rows.length, usS: 0, meta: 0, spend: 0, ours: 0 };
  for (const row of rows) for (const field of fields) totals[field] += row[field];
  totals.usS = rows.reduce((sum, row) => sum + (row.usS ?? row.sess - row.ukS), 0);
  totals.meta = totals.ukM + totals.usM;
  totals.spend = rows.reduce((sum, row) => sum + (row.adSpend ?? row.ukM + row.usM + row.g), 0);
  if(rows.some(row=>row.flaggedOrders!==undefined)){
    totals.firstOrders=rows.reduce((n,row)=>n+(row.firstOrders??0),0);
    totals.flaggedOrders=rows.reduce((n,row)=>n+(row.flaggedOrders??0),0);
  }
  return totals;
}

const divide = (numerator: number, denominator: number): number => denominator ? numerator / denominator : 0;
const rounded = (value: number, places = 2): number => Math.round(value * 10 ** places) / 10 ** places;
const integer = (value: number): string => formatNumber(Math.round(value), 0);
const money = (value: number): string => formatPounds(value, integer);
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const shortDate = (date: string): string => `${Number(date.slice(-2))} ${months[Number(date.slice(5, 7)) - 1]}`;
export const weekdayDate = (date: string): string => `${weekdays[new Date(`${date}T00:00:00Z`).getUTCDay()]} ${shortDate(date)}`;
export function rangeLabel(from: string, to: string): string {
  if (from === to) return shortDate(from);
  if (from.slice(0, 7) === to.slice(0, 7)) return `${Number(from.slice(-2))}–${shortDate(to)}`;
  if (from.slice(0, 4) === to.slice(0, 4)) return `${shortDate(from)}–${shortDate(to)}`;
  return `${shortDate(from)} ${from.slice(0, 4)}–${shortDate(to)} ${to.slice(0, 4)}`;
}

export function spikeMarkets(date: string): ('UK' | 'US')[] {
  const day = Number(date.slice(-2));
  const lastTwo = addDays(date, 2).slice(0, 7) !== date.slice(0, 7);
  return [day >= 24 && day <= 26 || lastTwo ? 'UK' : null, day === 1 || day === 15 || lastTwo ? 'US' : null]
    .filter((market): market is 'UK' | 'US' => market !== null);
}

type Metric = 'net' | 'aov' | 'cac' | 'orders' | 'cr' | 'spend' | 'roas' | 'margin' | 'ukcpo' | 'uscpo';
const additive = new Set<Metric>(['net', 'orders', 'spend']);
const metrics: Record<Metric, (totals: Totals) => number> = {
  net: (t) => t.net,
  orders: (t) => t.o,
  aov: (t) => divide(t.net, t.o),
  cac: (t) => divide(t.spend, t.o),
  cr: (t) => 100 * divide(t.o, t.sess),
  spend: (t) => t.spend,
  roas: (t) => divide(t.net, t.spend),
  margin: (t) => profitAndMargin({ netSales: t.net, landedCost: t.net * 0.25, adSpend: t.spend }).margin,
  ukcpo: (t) => metaCostPerOrder(t.ukM,t.uk),
  uscpo: (t) => metaCostPerOrder(t.usM,t.us),
};

export interface HeroRangeOptions {
  today: string;
  name?: string;
  market?: import('./dashboard-types.js').HeroMarket;
  blendedMetaTripwireGbp?: number;
}

/** Weighted ratios are calculated from summed numerators and denominators. */
export function buildHeroRange(rows: readonly DailyMetrics[], from: string, to: string, options: HeroRangeOptions): HeroPeriod {
  if (!realDate(from) || !realDate(to) || from > to || dayCount(from, to) > 366) throw new HeroRangeError();
  const indexed = new Map(rows.map((row) => [row.date, row]));
  const select = (first: string, last: string): DailyMetrics[] => {
    const result: DailyMetrics[] = [];
    for (let date = first; date <= last; date = addDays(date, 1)) {
      const row = indexed.get(date);
      if (row) result.push(row);
    }
    return result;
  };
  const selected = select(from, to);
  const marketSpikes = (date: string) => spikeMarkets(date).filter(market => !options.market || options.market === 'all' || market.toLowerCase() === options.market);
  const n = dayCount(from, to);
  if (selected.length !== n) throw new HeroRangeError();
  const t = aggregateDays(selected);
  const firstCac = t.o>0 && t.flaggedOrders===t.o;
  const valueFor = (metric:Metric,total:Totals) => metric==='cac'&&firstCac ? divide(total.spend,total.firstOrders??0) : metrics[metric](total);
  const cacMissing = (list:readonly DailyMetrics[]) => list.some(row=>row.spendKnown===false) || firstCac && list.some(row=>row.flaggedOrders!==row.o || row.o>0&&!row.firstOrders);
  const one = n === 1;
  const partial = to === options.today;
  const label = rangeLabel(from, to);
  const weekday = weekdayDate(from);
  const on = one ? `on ${weekday}` : `over ${label}`;
  const when = `${label}${partial ? ', today so far' : ''}`;
  const comparisonDays = one ? 7 : n;
  const previous = select(addDays(from, -comparisonDays), addDays(from, -1));
  const base = previous.length === comparisonDays ? aggregateDays(previous) : null;
  const countMetrics = new Set<Metric>(['orders', 'aov', 'cac', 'cr']);
  const salesMetrics = new Set<Metric>(['net', 'aov', 'roas', 'margin']);
  const comparison = (metric: Metric): number | null => base && !(metric === 'cac' && cacMissing(previous)) && !(salesMetrics.has(metric) && previous.some(row => row.netKnown === false)) && !(countMetrics.has(metric) && previous.some(row => row.countsKnown === false)) && !(metric === 'cr' && previous.some(row => row.sessionsKnown === false)) ? valueFor(metric,base) / (one && additive.has(metric) ? 7 : 1) : null;
  const spikeRows = selected.filter((row) => marketSpikes(row.date).length);
  const spikeSummary = spikeRows.length > 5 ? `${formatNumber(spikeRows.length)} spike days in this range`
    : `Spike days: ${spikeRows.map((row) => `${shortDate(row.date)} (${marketSpikes(row.date).join(' and ')})`).join(', ')}`;
  const spikeNote = spikeRows.length ? `${spikeSummary}. Do not base a verdict on a spike day alone.` : '';
  const state = (value: number, compared: number | null): State => partial ? 'sofar' : one && spikeRows.length ? 'info'
    : compared === null ? 'info' : value >= compared ? 'good' : value < 0.85 * compared ? 'warn' : 'info';
  const percent = (value: number, compared: number): number => compared ? Math.round(Math.abs(value / compared - 1) * 100) : 0;
  const comparisonText = (value: number, compared: number, format: (value: number) => string): string => compared === 0
    ? `${format(value)} against ${one ? 'a 7-day average' : `the previous ${n} days`} of zero; a percentage change is unavailable.`
    : one ? `${percent(value, compared)}% ${value >= compared ? 'above' : 'below'} the 7-day average of ${format(compared)}`
      : `${value >= compared ? 'Up' : 'Down'} ${percent(value, compared)}% on the previous ${n} days (${format(compared)})`;
  const ruleBase = base ? one
    ? 'Green when at or above the 7-day average. Amber under 85% of it. Red is never used here: a quiet day is not a failure.'
    : `Green when at or above the previous ${n} days, amber under 85% of it.`
    : 'There are not enough earlier available days to compare with.';
  const later = (rule: string): string => partial ? `No judgement until today ends. ${rule}` : rule;
  const rule = `${later(ruleBase)}${spikeNote ? ` ${spikeNote}` : ''}`;

  const chartRows = one ? select(addDays(from, -6), to) : selected;
  const weekly = chartRows.length > 31;
  const bins: DailyMetrics[][] = [];
  for (let i = 0; i < chartRows.length; i += weekly ? 7 : 1) bins.push(chartRows.slice(i, i + (weekly ? 7 : 1)));
  const firstChartDate = chartRows[0]!.date;
  const lastBinStart = bins.at(-1)![0]!.date;
  const hl: [string, string] = weekly ? [`week of ${shortDate(from)}`, `week of ${shortDate(lastBinStart)}`]
    : [shortDate(firstChartDate), partial ? 'today so far' : shortDate(to)];
  const hm = bins.map((bin) => {
    const marks = bin.filter((row) => marketSpikes(row.date).length).map((row) => `${shortDate(row.date)} (${marketSpikes(row.date).join(' and ')})`);
    return marks.length ? `Spike days: ${marks.join(', ')}` : '';
  });
  const ha = `${weekly ? 'Week by week, average a day' : 'Day by day'}, ${rangeLabel(firstChartDate, to)}${spikeNote ? `. ${spikeNote}` : ''}`;
  const history = (metric: Metric): number[] => (metric === 'cac' && cacMissing(chartRows) || salesMetrics.has(metric) && chartRows.some(row => row.netKnown === false) || countMetrics.has(metric) && chartRows.some(row => row.countsKnown === false) || metric === 'cr' && chartRows.some(row => row.sessionsKnown === false)) ? [] : bins.map((bin) => {
    const total = aggregateDays(bin);
    const value = valueFor(metric,total);
    return additive.has(metric) ? Math.round(value / total.days) : rounded(value, metric === 'cr' ? 1 : metric === 'margin' ? 0 : 2);
  });
  const detail = (metric: Metric, value: Pick<Detail, 'why' | 'src'> & Partial<Detail>): Detail => ({
    rule, hist: history(metric), hl, ha, ...(metric === 'orders' ? { hm } : {}), ...value,
    ...(spikeNote ? { extra: [...(value.extra ?? []), ['Spike days', spikeNote]] as [string, string][] } : {}),
  });
  const provenance = (source: SourceId[]) => ({ source, mode: 'sample' as const });
  const cNet = comparison('net');
  const cOrders = comparison('orders');
  const cCr = comparison('cr');
  const aov = metrics.aov(t), cac = valueFor('cac',t);
  const cAov = comparison('aov'), cCac = comparison('cac');
  const ratioComparison = (value: number, base: number | null): string => base === null ? 'no earlier days to compare' : `${one ? '7-day avg' : `prev ${n} days`} ${formatPounds(base)}${!partial && base ? ` · ${value >= base ? '+' : '−'}${percent(value, base)}%` : ''}`;
  const cr = metrics.cr(t);
  const roas = metrics.roas(t);
  const result = profitAndMargin({ netSales: t.net, landedCost: t.net * 0.25, adSpend: t.spend });
  const { profit, margin } = result;
  const sampleWaterfall: [string, string][] = [['Net sales', formatPounds(t.net)],
    ['Contribution', formatPounds(result.contribution)], ['Ad spend', formatPounds(t.spend)],
    ['After ad spend', formatPounds(result.contribution - t.spend)], ['Net profit', formatPounds(profit)]];
  const geoUnknown = selected.some((row) => row.date === '2026-09-22' || row.date === '2026-09-23');
  const marketRates = geoUnknown ? 'UK unknown · US unknown'
    : `UK ${rounded(100 * divide(t.uk, t.ukS), 1)}% · US ${rounded(100 * divide(t.us, t.usS), 1)}%`;
  const marketDetail = geoUnknown ? 'UK and US conversion is unknown: country tagging was unreliable on 22–23 Sep 2026. Store-wide conversion and orders by market are unaffected.'
    : `UK ${integer(t.uk)} of ${integer(t.ukS)} (${rounded(100 * divide(t.uk, t.ukS), 1)}%), US ${integer(t.us)} of ${integer(t.usS)} (${rounded(100 * divide(t.us, t.usS), 1)}%).`;
  const best = selected.reduce((best, row) => row.o > best.o ? row : best);
  const metric = (value: Omit<HeroMetric, 'source' | 'mode'>, source: SourceId[]): HeroMetric => ({ ...value, ...provenance(source) });
  const bar = options.blendedMetaTripwireGbp ?? 28;
  const amber = rounded(bar * 0.9);
  const poundsBar = formatPounds(bar, value => formatNumber(Math.round(value * 100) / 100));
  const zones: Zone[] = [[Math.min(12, bar / 2), amber, 'good'], [amber, bar, 'warn'], [bar, Math.max(40, bar + 12), 'decide']];
  const cpoDial = (key: 'ukcpo' | 'uscpo', country: 'UK' | 'US'): HeroPeriod['ukcpo'] => {
    const {value,over} = cpo(t,selected,key,bar);
    return {
      v: rounded(value), min: zones[0]![0], max: zones[2]![1], t: formatPounds(value), l: `${country} Meta cost per order`, z: structuredClone(zones),
      s: `${partial ? 'so far · ' : one ? '' : `${n}-day blend · `}bar ${poundsBar}`,
      ...(partial ? { cap: 'sofar' as const } : one && spikeMarkets(from).includes(country) ? { cap: 'info' as const } : {}),
      d: detail(key, { hp: '£',
        rule: `${later(`Amber from 90% of the ${poundsBar} blended bar (${formatPounds(amber)}). Over ${poundsBar} is a decision, not an alarm. Red is never used here.`)}${spikeNote ? ` ${spikeNote}` : ''}`,
        src: `Meta spend ${country} ÷ Shopify ${country} orders, ${when}`,
        why: `${country} Meta spend ${on} ÷ ${country} orders: ${formatPounds(value)}. ${over} of ${n} days were over ${poundsBar}.`,
      }),
      ...provenance(['shopify', 'meta']),
    };
  };
  return {
    market: options.market ?? 'all', from, to, short: label, gross: selected.reduce((sum, row) => sum + (row.gross ?? row.net), 0), grossUnavailable: selected.some(row => row.grossKnown === false), spark: history('net'),
    eyebrow: one ? `${weekday} · ${partial ? 'today so far' : 'one day'}` : `${label} · ${options.name ?? `${n} days`}${partial ? ', today so far' : ''}`,
    sub1: one ? `${integer(t.o)} orders on ${weekday}${partial ? ' so far' : ''}.` : `${integer(t.o)} orders over ${label}${partial ? ' so far' : ''}, avg ${integer(t.o / n)} a day.`,
    per: options.name ?? (one ? weekday : label),
    net: metric({ n: Math.round(t.net), state: state(t.net, cNet), pre: '£',
      ss: one ? cNet === null ? 'no earlier days to compare' : `7-day avg ${money(cNet)}${cNet && !partial ? ` · ${t.net >= cNet ? '+' : '−'}${percent(t.net, cNet)}%` : ''}`
        : `avg ${money(t.net / n)} a day${cNet === null ? '' : ` · prev ${n} days ${money(cNet)}`}`,
      d: detail('net', { hp: '£', src: `Shopify Analytics, net sales, UK and US markets, ${when}`,
        why: `${money(t.net)} net sales ${on}${partial ? ' so far' : ''}${one ? '' : `, ${money(t.net / n)} a day`}.${cNet === null || partial ? '' : ` ${comparisonText(t.net, cNet, money)}.`} Shopify's Total sales: items after discounts, plus shipping and tax, minus refunds.` }),
    }, ['shopify']),
    orders: metric({ n: t.o, state: state(t.o, cOrders),
      ss: `${one && cOrders !== null ? `avg ${integer(cOrders)} · ` : ''}UK ${integer(t.uk)} · US ${integer(t.us)}${!one && cOrders !== null ? ` · prev ${n} days ${integer(cOrders)}` : ''}`,
      d: detail('orders', { src: `Shopify orders, paid, both markets, ${when}`,
        why: `${integer(t.o)} orders ${on}. UK ${integer(t.uk)}, US ${integer(t.us)}.${one ? '' : ` Best day ${weekdayDate(best.date)} with ${integer(best.o)}.`}${spikeNote ? ` ${spikeNote}` : ''}` }),
    }, ['shopify']),
    aov: metric({ n: rounded(aov), state: state(aov, cAov), pre: '£', dp: 2,
      ss: ratioComparison(aov, cAov),
      d: detail('aov', { hp: '£', src: `Shopify net sales ÷ counted orders, ${when}`,
        why: `${formatPounds(t.net)} net sales ÷ ${integer(t.o)} orders = ${formatPounds(aov)}.`,
        rule: `Net sales ÷ orders. ${rule}` }),
    }, ['shopify']),
    cac: metric({ n: rounded(cac), state: partial ? 'sofar' : one && spikeRows.length ? 'info' : cCac === null ? 'info' : cac <= cCac ? 'good' : cac > 1.15 * cCac ? 'warn' : 'info', pre: '£', dp: 2,
      ss: ratioComparison(cac, cCac),
      d: detail('cac', { hp: '£', src: `Meta + Google + TikTok spend ÷ counted Shopify orders, ${when}`,
        why: `${formatPounds(t.spend)} all ad spend ÷ ${integer(t.o)} orders = ${formatPounds(cac)}.`,
        rule: `Cost per order until first orders can be told apart; no bar of its own yet, the Meta cost-per-order dials carry the bar. ${later(`Green when at or below ${one ? 'the 7-day average' : `the previous ${n} days`}; amber over 115% of it. Red is never used here.`)}${spikeNote ? ` ${spikeNote}` : ''}` }),
    }, ['shopify', 'meta', 'google-ads', 'tiktok']),
    cr: metric({ n: rounded(cr, 1), state: state(cr, cCr), suf: '%', dp: 1,
      ss: `${integer(t.o)} of ${integer(t.sess)} sessions · ${marketRates}`,
      d: detail('cr', { hs: '%', src: `Shopify Analytics, orders ÷ sessions, both markets, ${when}`,
        why: `${integer(t.o)} orders from ${integer(t.sess)} sessions ${on}, ${rounded(cr, 1)}%. ${marketDetail}` }),
    }, ['shopify']),
    spend: metric({ n: Math.round(t.spend), state: partial ? 'sofar' : 'info', pre: '£',
      ss: `ours ${money(t.ours)} · Laszlo ${money(t.meta - t.ours)} · Google ${money(t.g)}`,
      d: detail('spend', { hp: '£', rule: 'Spend has no bar of its own. The budget dial under Ads watches ours against the day plan.',
        src: `Meta Ads Manager (ours and Laszlo), Google Ads, ${when}`,
        why: `${money(t.spend)} ${on}: Meta ${money(t.meta)} (ours ${money(t.ours)}, Laszlo ${money(t.meta - t.ours)}), Google ${money(t.g)}.` }),
    }, ['meta', 'google-ads']),
    roas: metric({ n: rounded(roas), state: 'info', suf: '×', dp: 2, ss: 'net sales ÷ all ad spend · set a bar',
      d: detail('roas', { hs: '×', rule: 'No bar yet. Break-even ROAS comes from costs.md: 1 ÷ (1 − non-ad cost share). Grey until then.',
        src: 'Shopify net sales ÷ Meta + Google + TikTok spend', why: `${money(t.net)} ÷ ${money(t.spend)} ${on} = ${formatNumber(roas, 2)}×.` }),
    }, ['shopify', 'meta', 'google-ads']),
    margin: metric({ n: margin, state: 'est', suf: '%', dp: 1, ss: 'sample estimate · costs model not built',
      d: detail('margin', { hs: '%', rule: `No bar until the costs are real. At ${formatNumber(roas, 2)}× ROAS the true number may be near zero.`,
        src: 'Shopify net sales and orders, knowledge/costs.md, Meta + Google + TikTok spend',
        why: `Sample only. Assumes non-ad costs at 25% of net sales until knowledge/costs.md is filled: 1 − ${money(t.spend)} ÷ ${money(t.net)} − 25% = ${Math.round(margin)}%.`, extra: sampleWaterfall }),
    }, ['shopify', 'meta', 'google-ads', 'github-hq']),
    contribution: contributionMetric({ result,
      net: metric({ n: t.net, state: 'est', ss: '', unavailable: selected.some(row => row.netKnown === false),
        d: { why: '', rule: '', src: `Shopify sample data and invented costs · UK days ${when}` } }, ['shopify']),
      orders: selected.some(row => row.countsKnown === false) ? null : t.o,
      components: [['Net sales', formatPounds(t.net)], ['Shipping income net of tax', '£0.00'], ['Shipping refunds', '£0.00'],
        ['Landed cost', `${formatPounds(t.net * 0.25)} · sample assumption`], ['Fulfilment', '£0.00'], ['Payment fees', '£0.00']],
      afterAds: formatPounds(result.contribution - t.spend), omitted: [], soFar: partial,
      rule: 'Sample only. Invented non-ad costs are 25% of net sales until known costs replace this preview.',
    }),
    profit: metric({ n: profit, state: 'est', pre: '£', dp: 2, ss: 'sample estimate · costs model not built',
      d: { rule: 'Sample only. Assumes non-ad costs at 25% of net sales until known costs replace this preview.',
        src: 'Shopify net sales and orders, knowledge/costs.md, Meta + Google + TikTok spend',
        why: `Sample only. Net sales less ad spend and assumed non-ad costs of 25%: ${formatPounds(profit)}. This is the same pound total used to calculate net margin.`,
        extra: sampleWaterfall,
      },
    }, ['shopify', 'meta', 'google-ads', 'github-hq']),
    ukcpo: cpoDial('ukcpo', 'UK'), uscpo: cpoDial('uscpo', 'US'),
  };
}

/** Shared unrounded blend and daily threshold count used by hero dials and risk rules. */
export function cpo(t: Totals, selected: readonly DailyMetrics[], key: 'ukcpo'|'uscpo', bar: number) {
  return {value:metrics[key](t),over:selected.filter(row=>metrics[key](aggregateDays([row]))>bar).length};
}

export const metaCostPerOrder = (spend:number,orders:number):number => divide(spend,orders);
