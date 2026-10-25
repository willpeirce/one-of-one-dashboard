import { formatUkTime } from '../uk-time.js';
import type { CampaignSyncState } from './campaign-cache.js';

export function campaignSyncText(sync: CampaignSyncState): string {
  if (sync.state === 'pending' || !sync.at) return 'Campaigns will appear after the next Meta ad spend sync.';
  const time = formatUkTime(sync.at);
  return sync.state === 'success'
    ? `Campaigns updated ${time}`
    : `Campaigns could not be read at ${time} (${sync.code ?? 'unknown'}). Spend is unaffected.`;
}
