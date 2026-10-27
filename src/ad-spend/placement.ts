import type { SpendRow } from './model.js';

type Market = SpendRow['market'];
type PlacementRow = Pick<SpendRow, 'source' | 'campaignName' | 'adSetName' | 'owner'> & {targetCountries?: readonly string[]};

function campaignMarket(name: string): Market {
  const uk = /\bUK\b/i.test(name), us = /\bUS\b/i.test(name);
  return uk && !us ? 'uk' : us && !uk ? 'us' : 'unknown';
}

export function metaSpendMarket(
  campaignName: string,
  adSetName: string | null,
  owner: SpendRow['owner'],
): Market {
  if (owner === 'ours') {
    const uk = adSetName?.includes(' — UK — ') ?? false,
      us = adSetName?.includes(' — US — ') ?? false;
    if (uk || us) return uk && !us ? 'uk' : us && !uk ? 'us' : 'unknown';
    const setName = adSetName ?? '';
    if (/\b(?:UK|US)\b/i.test(setName)) return campaignMarket(setName);
  }
  return campaignMarket(campaignName);
}

export function googleSpendMarket(campaignName: string): Market {
  return campaignMarket(campaignName);
}

export function tiktokSpendMarket(campaignName: string): Market {
  return campaignMarket(campaignName);
}

export function countryMarket(countries: readonly string[] = []): Market {
  return countries.length && countries.every(c => ['GB','JE','GG','IM'].includes(c)) ? 'uk'
    : countries.length === 1 && countries[0] === 'US' ? 'us' : 'unknown';
}
export function needsMarketName(row: PlacementRow): boolean {
  return row.source === 'meta' && !/\b(?:UK|US)\b/i.test(`${row.campaignName} ${row.adSetName ?? ''}`);
}
/** Names remain authoritative, including conflicting names. Only unnamed sets use stored countries. */
export function spendMarket(row: PlacementRow): Market {
  return row.source === 'meta'
    ? needsMarketName(row) ? countryMarket(row.targetCountries) : metaSpendMarket(row.campaignName, row.adSetName, row.owner)
    : row.source === 'google-ads'
      ? googleSpendMarket(row.campaignName)
      : tiktokSpendMarket(row.campaignName);
}
