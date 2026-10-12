import type { SpendRow } from './model.js';

type Market = SpendRow['market'];
type PlacementRow = Pick<SpendRow, 'source' | 'campaignName' | 'adSetName' | 'owner'>;

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
  }
  return campaignMarket(campaignName);
}

export function googleSpendMarket(campaignName: string): Market {
  const ending = /\b(UK|US)$/i.exec(campaignName.trim())?.[1]?.toUpperCase();
  return ending === 'UK' ? 'uk' : ending === 'US' ? 'us' : 'unknown';
}

export function tiktokSpendMarket(campaignName: string): Market {
  return campaignMarket(campaignName);
}

/** Names and current local ownership are authoritative; targeting never allocates spend. */
export function spendMarket(row: PlacementRow): Market {
  return row.source === 'meta'
    ? metaSpendMarket(row.campaignName, row.adSetName, row.owner)
    : row.source === 'google-ads'
      ? googleSpendMarket(row.campaignName)
      : tiktokSpendMarket(row.campaignName);
}
