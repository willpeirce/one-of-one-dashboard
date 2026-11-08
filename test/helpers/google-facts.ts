import { addDays } from '../../src/hero-range.js';
import type { GoogleFacts, GoogleSyncState } from '../../src/google-ads/model.js';

/** Invented stored facts for pure presentation checks; API-shaped responses live in fixtures/google-ads. */
export function googlePresentationFacts(): GoogleFacts {
  const at = '2026-10-26T12:00:00Z', from = '2026-10-19', to = '2026-10-25';
  const job = (kind: GoogleSyncState['kind'], coverage: GoogleSyncState['coverage']): GoogleSyncState => ({kind, coverage, lastAttemptAt: at, lastSuccessAt: at, error: null, failures: 0, currency: 'GBP'});
  return { mode: 'live', accountId: '9900001', currency: 'GBP', hours: [], daily: [],
    quota: {day: '2026-10-26', operations: 12, historyOperations: 0, limit: 200, error: null},
    campaigns: [
      {id: '9900101', name: 'Invented search UK', status: 'ENABLED', channelType: 'SEARCH', biddingStrategyType: 'MAXIMIZE_CONVERSION_VALUE', targetRoas: 1.4, budgetMicros: '80000000', targetCountries: ['US']},
      {id: '9900102', name: 'Invented neutral search', status: 'ENABLED', channelType: 'SEARCH', biddingStrategyType: 'MAXIMIZE_CONVERSION_VALUE', targetRoas: null, budgetMicros: '40000000', targetCountries: ['US']},
    ],
    networks: Array.from({length: 7}, (_, i) => [
      {campaignId: '9900101', network: 'SEARCH', day: addDays(from, i), spendMicros: '100000000', conversionValueMicros: '200000000', conversions: 2},
      {campaignId: '9900101', network: 'YOUTUBE_WATCH', day: addDays(from, i), spendMicros: '10000000', conversionValueMicros: '5000000', conversions: 0.1},
      {campaignId: '9900101', network: 'MIXED', day: addDays(from, i), spendMicros: '5000000', conversionValueMicros: '15000000', conversions: 0.2},
      {campaignId: '9900101', network: 'INVENTED_NETWORK', day: addDays(from, i), spendMicros: '3000000', conversionValueMicros: '0', conversions: 0},
      {campaignId: '9900102', network: 'SEARCH', day: addDays(from, i), spendMicros: '50000000', conversionValueMicros: '100000000', conversions: 1},
    ]).flat(),
    conversions: [...Array.from({length: 7}, (_, i) => [
      {campaignId: '9900101', day: addDays(from, i), spendMicros: '120000000', conversionValueMicros: '240000000', conversions: 2},
      {campaignId: '9900102', day: addDays(from, i), spendMicros: '50000000', conversionValueMicros: '75000000', conversions: 1},
    ]).flat(),
    {campaignId: '9900101', day: '2026-10-26', spendMicros: '30000000', conversionValueMicros: '30000000', conversions: 0.5},
    {campaignId: '9900102', day: '2026-10-26', spendMicros: '20000000', conversionValueMicros: '10000000', conversions: 0.2}],
    changes: [{id: 'invented-change', at: '2026-10-26T08:00:00Z', campaignId: '9900101', resourceType: 'CAMPAIGN', operation: 'UPDATE'}],
    jobs: [job('campaigns', null), job('networks', {from, to, basis: 'uk'}),
      job('conversions', {from: '2026-10-18', to: '2026-10-26', basis: 'gmt', ukFrom: from, ukTo: '2026-10-26', completeUkTo: to}),
      job('changes', {from: '2026-10-19T12:00:00Z', to: at, basis: 'instant'}), job('daily', {from, to, basis: 'gmt'})],
  };
}
