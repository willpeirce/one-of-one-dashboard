import type { HeroMetric } from './dashboard-types.js';

/** Background only: the signed figure and the existing estimate/caveat stay intact. */
export function metricSign(metric: Pick<HeroMetric, 'n' | 'unavailable'>): 'positive' | 'negative' | 'none' {
  return metric.unavailable || !Number.isFinite(metric.n) || metric.n === 0 ? 'none' : metric.n > 0 ? 'positive' : 'negative';
}
