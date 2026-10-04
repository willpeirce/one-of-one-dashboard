import type { SourceHealth, SourceId } from './sources.js';

export type State = 'good' | 'warn' | 'decide' | 'alarm' | 'info' | 'sofar' | 'est';
export type Period = 'today' | 'yday' | '7d';
export type Zone = [number, number, State];

export interface Detail {
  why: string;
  rule: string;
  src: string;
  hist?: number[];
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
  mode: 'sample';
}

export interface HeroMetric extends SampleProvenance {
  n: number;
  state: State;
  d: Detail;
  ss: string;
  pre?: string;
  suf?: string;
  dp?: number;
}

export interface HeroPeriod {
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
  hero: Record<Period, HeroPeriod>;
  widgets: Record<string, DashboardWidget>;
  textValues: Record<string, SampleText>;
  sourceHealth?: SourceHealth[];
}
