import type { SourceHealth, SourceId } from './sources.js';

export type State = 'good' | 'warn' | 'decide' | 'alarm' | 'info' | 'sofar' | 'est';
export type Period = 'today' | 'yday' | '7d' | '30d';
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
  state: State;
  d: Detail;
  ss: string;
  pre?: string;
  suf?: string;
  dp?: number;
}

export interface HeroPeriod {
  from: string;
  to: string;
  short: string;
  spark: number[];
  eyebrow: string;
  sub1: string;
  per: string;
  net: HeroMetric;
  orders: HeroMetric;
  cr: HeroMetric;
  spend: HeroMetric;
  roas: HeroMetric;
  margin: HeroMetric;
  ukcpo: DialModel & SampleProvenance;
  uscpo: DialModel & SampleProvenance;
  business?: {
    email: { count: number; detail: Detail };
    refill: { count: number; detail: Detail };
    orderDays: { day: string; UK: number; US: number; EU: number; TikTok: number; unknown: number; total: number; detailAvailable: boolean }[];
  };
}

export type DashboardWidget = SampleProvenance & (
  | { kind: 'dial'; value: DialModel }
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
  shopify?: import('./shopify/dashboard.js').ShopifyDashboard;
  banner?: string;
  fulfilment?: import('./fulfilment/view.js').Summary;
}
