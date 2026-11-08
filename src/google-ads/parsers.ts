import { AdError, hourDay } from '../ad-spend/model.js';
import { addDays } from '../hero-range.js';
import type { GoogleCampaign, GoogleChange, GoogleDailyTotal, GoogleHour, GoogleNetworkSlice } from './model.js';
export const googleId = (value: unknown): string => {
  const id = String(value ?? '');
  if (!/^\d{1,30}$/.test(id)) throw new AdError('invalid');
  return id;
};
const word = (value: unknown, fallback?: string): string => {
  if (value == null && fallback !== undefined) return fallback;
  if (typeof value !== 'string' || !value.trim() || value.length > 300) throw new AdError('invalid');
  return value;
};
export function googleDay(value: unknown): string {
  const day = word(value);
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(`${day}T00:00:00Z`))
    || new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) throw new AdError('invalid');
  return day;
}
export function googleRange(from: string, to: string): void {
  googleDay(from); googleDay(to);
  if (from > to || (Date.parse(to) - Date.parse(from)) / 86400000 > 31) throw new AdError('invalid');
}
const micros = (value: unknown): string => {
  const result = String(value ?? '0');
  if (!/^\d{1,24}$/.test(result)) throw new AdError('invalid');
  return BigInt(result).toString();
};
const count = (value: unknown): number => {
  const result = Number(value ?? 0);
  if (!Number.isFinite(result) || result < 0) throw new AdError('invalid');
  return result;
};
const amountMicros = (value: unknown): string => {
  const valueNumber = count(value);
  if (valueNumber > 1e12) throw new AdError('invalid');
  return String(BigInt(Math.round(valueNumber * 1_000_000)));
};
const amounts = (row: any) => ({ spendMicros: micros(row.metrics?.costMicros),
  conversionValueMicros: amountMicros(row.metrics?.conversionsValue), conversions: count(row.metrics?.conversions) });
export function parseGoogleCampaigns(rows: any[], locations: any[], geo: any[]): GoogleCampaign[] {
  const countries = new Map<string, string>();
  for (const row of geo) {
    const value = row.geoTargetConstant, code = word(value?.countryCode);
    if (!/^[A-Z]{2}$/.test(code)) throw new AdError('invalid');
    const id = googleId(value.id ?? String(value.resourceName ?? '').split('/').at(-1));
    countries.set(`geoTargetConstants/${id}`, code);
  }
  return rows.map(row => {
    const c = row.campaign, id = googleId(c?.id), targets = new Set<string>();
    for (const location of locations.filter(l => googleId(l.campaign?.id) === id)) {
      if (location.campaignCriterion?.negative === true) continue;
      const country = countries.get(location.campaignCriterion?.location?.geoTargetConstant);
      // Missing resolution must not turn a multi-country campaign into a single known market.
      targets.add(country ?? 'ZZ');
    }
    const target = c.maximizeConversionValue?.targetRoas ?? c.targetRoas?.targetRoas;
    return { id, name: word(c.name), status: word(c.status, 'UNKNOWN'),
      channelType: word(c.advertisingChannelType, 'UNKNOWN'), biddingStrategyType: word(c.biddingStrategyType, 'UNKNOWN'),
      targetRoas: target == null ? null : count(target), budgetMicros: micros(row.campaignBudget?.amountMicros), targetCountries: [...targets].sort() };
  });
}
export function parseGoogleHours(rows: any[]): GoogleHour[] {
  return rows.map(row => {
    const day = googleDay(row.segments?.date), hour = Number(row.segments?.hour ?? 0);
    hourDay(day, hour);
    return { campaignId: googleId(row.campaign?.id), day, hour, ...amounts(row) };
  });
}
export function parseGoogleNetworks(rows: any[], from: string, to: string): GoogleNetworkSlice[] {
  const grouped = new Map<string, GoogleNetworkSlice>();
  for (const row of rows) {
    const day = hourDay(googleDay(row.segments?.date), Number(row.segments?.hour ?? 0));
    if (day < from || day > to) continue;
    const campaignId = googleId(row.campaign?.id), network = word(row.segments?.adNetworkType, 'UNSPECIFIED');
    const key = JSON.stringify([campaignId, network, day]), previous = grouped.get(key), values = amounts(row);
    grouped.set(key, { campaignId, network, day,
      spendMicros: String(BigInt(values.spendMicros) + BigInt(previous?.spendMicros ?? '0')),
      conversionValueMicros: String(BigInt(values.conversionValueMicros) + BigInt(previous?.conversionValueMicros ?? '0')),
      conversions: values.conversions + (previous?.conversions ?? 0) });
  }
  return [...grouped.values()];
}
export function parseGoogleDaily(rows: any[], from: string, to: string): GoogleDailyTotal[] {
  const totals = new Map<string, bigint>();
  for (const row of rows) {
    const day = googleDay(row.segments?.date);
    if (day < from || day > to) throw new AdError('invalid');
    totals.set(day, (totals.get(day) ?? 0n) + BigInt(micros(row.metrics?.costMicros)));
  }
  const result: GoogleDailyTotal[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) result.push({ day, spendMicros: String(totals.get(day) ?? 0n) });
  return result;
}
export function googleInstant(value: string): string {
  if (!/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) throw new AdError('invalid');
  return new Date(value).toISOString().slice(0, 19).replace('T', ' ');
}
export function parseGoogleChanges(rows: any[]): GoogleChange[] {
  if (rows.length >= 10_000) throw new AdError('invalid'); // A capped report cannot establish complete change coverage.
  return rows.map(row => {
    const c = row.changeEvent, id = word(c?.resourceName), raw = word(c.changeDateTime);
    if (!/^customers\/\d+\/changeEvents\/[\w~.-]+$/.test(id)
      || !/^20\d{2}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(raw)) throw new AdError('invalid');
    const at = new Date(raw.replace(' ', 'T') + 'Z').toISOString();
    return { id, at, resourceType: word(c.changeResourceType, 'UNKNOWN'), operation: word(c.resourceChangeOperation, 'UNKNOWN'),
      campaignId: c.campaign ? googleId(String(c.campaign).split('/').at(-1)) : null };
  });
}
