import type { Detail, HeroMetric, HeroPeriod, State, Zone } from './dashboard-types.js';
import type { SourceId } from './sources.js';

const DAY = 86_400_000;
const fields = ['net', 'o', 'uk', 'us', 'sess', 'ukS', 'ukM', 'usM', 'g', 'ours'] as const;

/** Additive day facts; neither aggregation nor range validation reads a source. */
export interface DailyMetrics {
  date: string;
  net: number;
  o: number;
  uk: number;
  us: number;
  sess: number;
  ukS: number;
  ukM: number;
  usM: number;
  g: number;
  ours: number;
}
export type Totals = Omit<DailyMetrics, 'date'> & {
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
  totals.usS = totals.sess - totals.ukS;
  totals.meta = totals.ukM + totals.usM;
  totals.spend = totals.meta + totals.g;
  return totals;
}

const divide = (numerator: number, denominator: number): number => denominator ? numerator / denominator : 0;
const rounded = (value: number, places = 2): number => Math.round(value * 10 ** places) / 10 ** places;
const integer = (value: number): string => Math.round(value).toLocaleString('en-GB');
const money = (value: number): string => `£${integer(value)}`;
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const shortDate = (date: string): string => `${Number(date.slice(-2))} ${months[Number(date.slice(5, 7)) - 1]}`;
const weekdayDate = (date: string): string => `${weekdays[new Date(`${date}T00:00:00Z`).getUTCDay()]} ${shortDate(date)}`;
function rangeLabel(from: string, to: string): string {
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

type Metric = 'net' | 'orders' | 'cr' | 'spend' | 'roas' | 'margin' | 'ukcpo' | 'uscpo';
const additive = new Set<Metric>(['net', 'orders', 'spend']);
const metrics: Record<Metric, (totals: Totals) => number> = {
  net: (t) => t.net,
  orders: (t) => t.o,
  cr: (t) => 100 * divide(t.o, t.sess),
  spend: (t) => t.spend,
  roas: (t) => divide(t.net, t.spend),
  margin: (t) => t.net ? 100 * (1 - t.spend / t.net - 0.25) : 0,
  ukcpo: (t) => divide(t.ukM, t.uk),
  uscpo: (t) => divide(t.usM, t.us),
};

export interface HeroRangeOptions {
  today: string;
  name?: string;
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
  const n = dayCount(from, to);
  if (selected.length !== n) throw new HeroRangeError();
  const t = aggregateDays(selected);
  const one = n === 1;
  const partial = to === options.today;
  const label = rangeLabel(from, to);
  const weekday = weekdayDate(from);
  const on = one ? `on ${weekday}` : `over ${label}`;
  const when = `${label}${partial ? ', today so far' : ''}`;
  const comparisonDays = one ? 7 : n;
  const previous = select(addDays(from, -comparisonDays), addDays(from, -1));
  const base = previous.length === comparisonDays ? aggregateDays(previous) : null;
  const comparison = (metric: Metric): number | null => base ? metrics[metric](base) / (one && additive.has(metric) ? 7 : 1) : null;
  const spikeRows = selected.filter((row) => spikeMarkets(row.date).length);
  const spikeSummary = spikeRows.length > 5 ? `${spikeRows.length} spike days in this range`
    : `Spike days: ${spikeRows.map((row) => `${shortDate(row.date)} (${spikeMarkets(row.date).join(' and ')})`).join(', ')}`;
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
    const marks = bin.filter((row) => spikeMarkets(row.date).length).map((row) => `${shortDate(row.date)} (${spikeMarkets(row.date).join(' and ')})`);
    return marks.length ? `Spike days: ${marks.join(', ')}` : '';
  });
  const ha = `${weekly ? 'Week by week, average a day' : 'Day by day'}, ${rangeLabel(firstChartDate, to)}${spikeNote ? `. ${spikeNote}` : ''}`;
  const history = (metric: Metric): number[] => bins.map((bin) => {
    const total = aggregateDays(bin);
    const value = metrics[metric](total);
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
  const cr = metrics.cr(t);
  const roas = metrics.roas(t);
  const margin = metrics.margin(t);
  const geoUnknown = selected.some((row) => row.date === '2026-09-22' || row.date === '2026-09-23');
  const marketRates = geoUnknown ? 'UK unknown · US unknown'
    : `UK ${rounded(100 * divide(t.uk, t.ukS), 1)}% · US ${rounded(100 * divide(t.us, t.usS), 1)}%`;
  const marketDetail = geoUnknown ? 'UK and US conversion is unknown: country tagging was unreliable on 22–23 Sep 2026. Store-wide conversion and orders by market are unaffected.'
    : `UK ${integer(t.uk)} of ${integer(t.ukS)} (${rounded(100 * divide(t.uk, t.ukS), 1)}%), US ${integer(t.us)} of ${integer(t.usS)} (${rounded(100 * divide(t.us, t.usS), 1)}%).`;
  const best = selected.reduce((best, row) => row.o > best.o ? row : best);
  const metric = (value: Omit<HeroMetric, 'source' | 'mode'>, source: SourceId[]): HeroMetric => ({ ...value, ...provenance(source) });
  const bar = options.blendedMetaTripwireGbp ?? 28;
  const amber = rounded(bar * 0.9);
  const poundsBar = `£${bar.toLocaleString('en-GB', { maximumFractionDigits: 2 })}`;
  const zones: Zone[] = [[Math.min(12, bar / 2), amber, 'good'], [amber, bar, 'warn'], [bar, Math.max(40, bar + 12), 'decide']];
  const cpo = (key: 'ukcpo' | 'uscpo', country: 'UK' | 'US'): HeroPeriod['ukcpo'] => {
    const value = metrics[key](t);
    const over = selected.filter((row) => metrics[key](aggregateDays([row])) > bar).length;
    return {
      v: rounded(value), min: zones[0]![0], max: zones[2]![1], t: `£${value.toFixed(2)}`, l: `${country} Meta cost per order`, z: structuredClone(zones),
      s: `${partial ? 'so far · ' : one ? '' : `${n}-day blend · `}bar ${poundsBar}`,
      ...(partial ? { cap: 'sofar' as const } : one && spikeMarkets(from).includes(country) ? { cap: 'info' as const } : {}),
      d: detail(key, { hp: '£',
        rule: `${later(`Amber from 90% of the ${poundsBar} blended bar (£${amber.toFixed(2)}). Over ${poundsBar} is a decision, not an alarm. Red is never used here.`)}${spikeNote ? ` ${spikeNote}` : ''}`,
        src: `Meta spend ${country} ÷ Shopify ${country} orders, ${when}`,
        why: `${country} Meta spend ${on} ÷ ${country} orders: £${value.toFixed(2)}. ${over} of ${n} days were over ${poundsBar}.`,
      }),
      ...provenance(['shopify', 'meta']),
    };
  };
  return {
    from, to, short: label, spark: history('net'),
    eyebrow: one ? `${weekday} · ${partial ? 'today so far' : 'one day'}` : `${label} · ${options.name ?? `${n} days`}${partial ? ', today so far' : ''}`,
    sub1: one ? `${t.o} orders on ${weekday}${partial ? ' so far' : ''}.` : `${integer(t.o)} orders over ${label}${partial ? ' so far' : ''}, avg ${integer(t.o / n)} a day.`,
    per: options.name ?? (one ? weekday : label),
    net: metric({ n: Math.round(t.net), state: state(t.net, cNet), pre: '£',
      ss: one ? cNet === null ? 'no earlier days to compare' : `7-day avg ${money(cNet)}${cNet && !partial ? ` · ${t.net >= cNet ? '+' : '−'}${percent(t.net, cNet)}%` : ''}`
        : `avg ${money(t.net / n)} a day${cNet === null ? '' : ` · prev ${n} days ${money(cNet)}`}`,
      d: detail('net', { hp: '£', src: `Shopify Analytics, net sales, UK and US markets, ${when}`,
        why: `${money(t.net)} net sales ${on}${partial ? ' so far' : ''}${one ? '' : `, ${money(t.net / n)} a day`}.${cNet === null || partial ? '' : ` ${comparisonText(t.net, cNet, money)}.`}` }),
    }, ['shopify']),
    orders: metric({ n: t.o, state: state(t.o, cOrders),
      ss: `${one && cOrders !== null ? `avg ${integer(cOrders)} · ` : ''}UK ${integer(t.uk)} · US ${integer(t.us)}${!one && cOrders !== null ? ` · prev ${n} days ${integer(cOrders)}` : ''}`,
      d: detail('orders', { src: `Shopify orders, paid, both markets, ${when}`,
        why: `${integer(t.o)} orders ${on}. UK ${integer(t.uk)}, US ${integer(t.us)}.${one ? '' : ` Best day ${weekdayDate(best.date)} with ${best.o}.`}${spikeNote ? ` ${spikeNote}` : ''}` }),
    }, ['shopify']),
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
        src: 'Shopify net sales ÷ Meta + Google + TikTok spend', why: `${money(t.net)} ÷ ${money(t.spend)} ${on} = ${roas.toFixed(2)}×.` }),
    }, ['shopify', 'meta', 'google-ads']),
    margin: metric({ n: Math.round(margin), state: 'est', suf: '%', ss: 'sample estimate · costs model not built',
      d: detail('margin', { hs: '%', rule: `No bar until the costs are real. At ${roas.toFixed(2)}× ROAS the true number may be near zero.`,
        src: 'Shopify net sales and orders, knowledge/costs.md, Meta + Google + TikTok spend',
        why: `Sample only. Assumes non-ad costs at 25% of net sales until knowledge/costs.md is filled: 1 − ${money(t.spend)} ÷ ${money(t.net)} − 25% = ${Math.round(margin)}%.` }),
    }, ['shopify', 'meta', 'google-ads', 'github-hq']),
    ukcpo: cpo('ukcpo', 'UK'), uscpo: cpo('uscpo', 'US'),
  };
}
