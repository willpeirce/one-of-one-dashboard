import { appConfig } from '../config.js';
import type { SeriesPaceMarket } from './model.js';

export interface Series {
  key: string;
  name: string;
  sku: string;
  UKLaunchDate: string;
  UKOrderDate: string;
  UKLandingOffsetDays: number;
  UKTargetDate: string;
  USLaunchDate: string;
  USOrderDate: string;
  USLandingOffsetDays: number;
  USTargetDate: string;
}

export const seriesMarkets = ['UK', 'US'] as const;
export const originalSeriesProduct = appConfig.shopify.stockProducts.find(product => 'originalSeries' in product)!;
export const originalSeriesSku: string = originalSeriesProduct.sku;
export const originalSeriesProductId = `gid://shopify/Product/${originalSeriesProduct.id}`;
export const originalSeriesKey = 'series-1';

export function seriesMarket(series: Series, market: SeriesPaceMarket) {
  return {
    launchDate: series[`${market}LaunchDate`],
    orderDate: series[`${market}OrderDate`],
    landingOffsetDays: series[`${market}LandingOffsetDays`],
    targetDate: series[`${market}TargetDate`],
  };
}

export function originalSeries(legacy: Record<string, unknown> = {}): Series {
  return {
    key: originalSeriesKey, name: 'Series 1', sku: originalSeriesSku,
    UKLaunchDate: '2026-09-01', USLaunchDate: '2026-09-01',
    UKOrderDate: (legacy.series1OrderDate ?? '2026-11-04') as string,
    USOrderDate: (legacy.series1OrderDate ?? '2026-11-04') as string,
    UKLandingOffsetDays: (legacy.series1UkLandingOffsetDays ?? 104) as number,
    USLandingOffsetDays: (legacy.series1UsLandingOffsetDays ?? 74) as number,
    UKTargetDate: (legacy.series1UkTargetDate ?? '') as string,
    USTargetDate: (legacy.series1UsTargetDate ?? '') as string,
  };
}
