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
  const markets = googleNameMarkets(campaignName);
  return markets.size === 1 ? markets.has('UK') ? 'uk' : 'us' : 'unknown';
}
function googleNameMarkets(name: string): Set<string> {
  // Underscores are separators in campaign names, but letters/numbers must not match substrings.
  return new Set([...name.matchAll(/(?:^|[^\p{L}\p{N}])(UK|US)(?=$|[^\p{L}\p{N}])/gu)].map(match => match[1]!));
}

export function tiktokSpendMarket(campaignName: string): Market {
  return campaignMarket(campaignName);
}

export function countryMarket(countries: readonly string[] = []): Market {
  return countries.length && countries.every(c => ['GB','JE','GG','IM'].includes(c)) ? 'uk'
    : countries.length === 1 && countries[0] === 'US' ? 'us' : 'unknown';
}
export function needsMarketName(row: PlacementRow): boolean {
  return row.source === 'meta' ? !/\b(?:UK|US)\b/i.test(`${row.campaignName} ${row.adSetName ?? ''}`)
    : row.source === 'google-ads' && googleNameMarkets(row.campaignName).size === 0;
}
/** Names remain authoritative, including conflicts. Unnamed Meta sets and Google campaigns use country codes. */
export function spendMarket(row: PlacementRow): Market {
  return row.source === 'meta'
    ? needsMarketName(row) ? countryMarket(row.targetCountries) : metaSpendMarket(row.campaignName, row.adSetName, row.owner)
    : row.source === 'google-ads'
      ? needsMarketName(row) ? countryMarket(row.targetCountries) : googleSpendMarket(row.campaignName)
      : tiktokSpendMarket(row.campaignName);
}
