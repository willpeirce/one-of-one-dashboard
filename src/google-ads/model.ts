import { addDays, ukToday } from '../hero-range.js';
import { AdError, hourDay } from '../ad-spend/model.js';
import type { Settings } from '../settings.js';

export const GOOGLE_API_VERSION = 'v24';
export const GOOGLE_OPERATION_LIMIT = 200;
export const GOOGLE_HISTORY_ATTEMPTS = 16;
export const GOOGLE_REPORT_INTERVAL_MS = 3 * 60 * 60_000;
export const GOOGLE_CHANGE_INTERVAL_MS = 60 * 60_000;
export const googleJobKinds = ['campaigns', 'networks', 'conversions', 'changes', 'daily'] as const;
export type GoogleJobKind = typeof googleJobKinds[number];
export interface GoogleCampaign {
  id: string; name: string; status: string; channelType: string; biddingStrategyType: string;
  targetRoas: number | null; budgetMicros: string; targetCountries: string[];
}
export interface GoogleAmounts { spendMicros: string; conversionValueMicros: string; conversions: number }
export interface GoogleNetworkSlice extends GoogleAmounts { campaignId: string; network: string; day: string }
/** day/hour are the original GMT bucket, never a UK date relabelled as GMT. */
export interface GoogleHour extends GoogleAmounts { campaignId: string; day: string; hour: number }
export interface GoogleConversionDay extends GoogleAmounts { campaignId: string; day: string }
export interface GoogleChange { id: string; at: string; resourceType: string; operation: string; campaignId: string | null }
export interface GoogleDailyTotal { day: string; spendMicros: string }
export interface GoogleCoverage {
  from: string; to: string; basis: 'gmt' | 'uk' | 'instant';
  /** The complete UK conversion window carried by the GMT hourly report. */
  ukFrom?: string; ukTo?: string; completeUkTo?: string; completeGmtTo?: string;
}
export interface GoogleSyncState {
  kind: GoogleJobKind; lastAttemptAt: string | null; lastSuccessAt: string | null;
  error: string | null; failures: number; coverage: GoogleCoverage | null; currency: string | null;
}
export interface GoogleFacts {
  mode: 'sample' | 'live'; accountId: string; currency: string | null;
  campaigns: GoogleCampaign[]; networks: GoogleNetworkSlice[]; hours: GoogleHour[];
  conversions: GoogleConversionDay[]; changes: GoogleChange[]; daily: GoogleDailyTotal[];
  jobs: GoogleSyncState[];
  quota: { day: string | null; operations: number; historyOperations: number; limit: number; error: string | null };
}
export interface GoogleRead<T> { currency: string; rows: T[] }
/** Fixed reads only. The shared spend adapter owns OAuth, searchStream and the quota. */
export interface GoogleReader {
  readGoogleCampaigns(account: string, settings: Settings): Promise<GoogleRead<GoogleCampaign>>;
  readGoogleNetworks(account: string, from: string, to: string, settings: Settings): Promise<GoogleRead<GoogleNetworkSlice>>;
  readGoogleConversions(account: string, from: string, to: string, settings: Settings): Promise<GoogleRead<GoogleHour>>;
  readGoogleChanges(account: string, from: string, to: string, settings: Settings): Promise<GoogleRead<GoogleChange>>;
  readGoogleDaily(account: string, from: string, to: string, settings: Settings): Promise<GoogleRead<GoogleDailyTotal>>;
}
export type GoogleBudgetContext = { history?: boolean; retry?: boolean };
export class GoogleQuotaError extends AdError {
  constructor(readonly reason: 'daily_cap' | 'reserved' | 'history_allowance') { super('rate_limit'); }
}
export function googleWindow(now: Date) {
  const ukTo = addDays(ukToday(now), -1), ukFrom = addDays(ukTo, -6);
  const gmtTo = addDays(now.toISOString().slice(0, 10), -1), gmtFrom = addDays(gmtTo, -6);
  return { ukFrom, ukTo, gmtFrom, gmtTo,
    hoursFrom: [addDays(ukFrom, -1), gmtFrom].sort()[0]!, hoursTo: now.toISOString().slice(0, 10) };
}
/** Conservative allowance for remaining first attempts: spend, changes, six 3-hour reads and currency. */
export function googleReservedOperations(now: Date): number {
  const remaining = Date.parse(`${addDays(now.toISOString().slice(0, 10), 1)}T00:00:00Z`) - now.getTime();
  return Math.ceil(remaining / (30 * 60_000)) + Math.ceil(remaining / GOOGLE_CHANGE_INTERVAL_MS)
    + 6 * Math.ceil(remaining / GOOGLE_REPORT_INTERVAL_MS) + 1;
}
export function googleConversionDays(hours: readonly GoogleHour[], from?: string, to?: string): GoogleConversionDay[] {
  const grouped = new Map<string, GoogleConversionDay>();
  for (const row of hours) {
    const day = hourDay(row.day, row.hour);
    if ((from && day < from) || (to && day > to)) continue;
    const key = `${row.campaignId}:${day}`, previous = grouped.get(key);
    grouped.set(key, { campaignId: row.campaignId, day,
      spendMicros: String(BigInt(row.spendMicros) + BigInt(previous?.spendMicros ?? '0')),
      conversionValueMicros: String(BigInt(row.conversionValueMicros) + BigInt(previous?.conversionValueMicros ?? '0')),
      conversions: row.conversions + (previous?.conversions ?? 0) });
  }
  return [...grouped.values()];
}
