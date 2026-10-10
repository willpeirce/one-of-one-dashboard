import type { CampaignSyncState } from './campaign-cache.js';

const ukTime = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London',
});

export function campaignSyncText(sync: CampaignSyncState): string {
  if (sync.state === 'pending' || !sync.at) return 'Campaigns will appear after the next Meta ad spend sync.';
  const time = `${ukTime.format(new Date(sync.at))} UK`;
  return sync.state === 'success'
    ? `Campaigns updated ${time}`
    : `Campaigns could not be read at ${time} (${sync.code ?? 'unknown'}). Spend is unaffected.`;
}
