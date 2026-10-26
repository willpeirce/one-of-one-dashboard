import type { SourceHealth, SourceId } from './sources.js';

export type State = 'good' | 'warn' | 'decide' | 'alarm' | 'info' | 'sofar' | 'est';
export type Period = 'today' | 'yday' | '7d' | '30d';
export type HeroMarket = 'all' | 'uk' | 'us';
export type Zone = [number, number, State];

export interface Detail {
  why: string;
  rule: string;
  src: string;
  hist?: number[];
  hl?: [string, string];
  ha?: string;
  hm?: string[];
  hp?: string;
  hs?: string;
  extra?: [string, string][];
}

export interface DialModel {
  v: number;
  min: number;
  max: number;
  t: string;
  l: string;
  s: string;
  z: Zone[];
  d: Detail;
  cap?: State;
  hidePointer?: boolean;
}

export interface RingModel {
  v: number;
  max: number;
  t: string;
  l: string;
  s: string;
  state?: State;
  z?: Zone[];
  d: Detail;
}

export interface SheetModel extends Detail {
  state: State;
  title: string;
}

export interface TestModel {
  metric: string;
  unit: string;
  arms: { k: string; l: string; x: number }[];
  day: number;
  min: number;
  max: number;
  minx: number;
  prev: number;
  denom: string;
  strip: string[];
  note: string;
  presentation: {
    sure: number;
    state: State;
    chipText: string;
    say: string;
    small: string;
    progress: string;
    buttonText: string;
    sureZones: Zone[];
    sureLabel: string;
    stripLabel: string;
    sureCaption: string;
  };
}

export interface SampleProvenance {
  source: SourceId[];
  mode: 'sample' | 'live';
}

export interface HeroMetric extends SampleProvenance {
  n: number;
  unavailable?: boolean;
  unavailableLabel?: string;
  state: State;
  d: Detail;
  ss: string;
  statusLabel?: string;
  pre?: string;
  suf?: string;
  dp?: number;
}

export interface HourlyOrders {
  today: (number | null)[];
  yesterday: number[];
  todayDay: string;
  yesterdayDay: string;
  nowHour: number;
  ready: boolean;
}

export interface HeroPeriod {
  hourly?: HourlyOrders;
  market?: HeroMarket;
  /** All three independent market views travel with each period; children have no markets map. */
  markets?: Record<HeroMarket, HeroPeriod>;
  from: string;
  to: string;
  short: string;
  spark: number[];
  eyebrow: string;
  sub1: string;
  per: string;
  net: HeroMetric;
  gross: number;
  grossUnavailable?: boolean;
  orders: HeroMetric;
  aov: HeroMetric;
  cac: HeroMetric;
  cr: HeroMetric;
  spend: HeroMetric;
  roas: HeroMetric;
  margin: HeroMetric;
  contribution: HeroMetric;
  profit: HeroMetric;
  ukcpo: DialModel & SampleProvenance;
  uscpo: DialModel & SampleProvenance;
  business?: {
    email: { count: number; detail: Detail };
    refill: { count: number; detail: Detail };
    orderDays: { day: string; UK: number; US: number; EU: number; TikTok: number; unknown: number; total: number; detailAvailable: boolean }[];
  };
}

export type DashboardWidget = SampleProvenance & (
  | { kind: 'dial'; value: DialModel; markets?: Record<HeroMarket,DialModel> }
  | { kind: 'series-pace'; value: import('./series-pace/presentation.js').SeriesPaceCard }
  | { kind: 'ring'; value: RingModel }
  | { kind: 'detail'; value: Detail }
  | { kind: 'sheet'; value: SheetModel }
  | { kind: 'test'; value: TestModel }
);

export interface SampleText extends SampleProvenance {
  value: string;
}

/** Presentation data is deliberately independent of source-key readiness in stage 0b. */
export interface DashboardSnapshot {
  adSets?: import('./meta-adsets/presentation.js').AdSetsView;
  schemaVersion: 1;
  mode: 'sample';
  brand: 'one-of-one';
  asOf: string;
  generatedAt: string;
  bounds: { min: string; max: string; today: string };
  hero: Record<Period, HeroPeriod>;
  widgets: Record<string, DashboardWidget>;
  textValues: Record<string, SampleText>;
  sourceHealth?: SourceHealth[];
  adSources?: import('./radar.js').RadarAdSource[];
  shopify?: import('./shopify/dashboard.js').ShopifyDashboard;
  banner?: string;
  fulfilment?: import('./fulfilment/view.js').Summary;
  metaCampaigns?: { unconfirmedCount: number };
  reviews?: import('./judgeme/model.js').ReviewsPanel;
  creatives?: import('./creatives/presentation-types.js').CreativeView;
}
