import assert from 'node:assert/strict';
import test from 'node:test';
import { campaignSyncText } from '../src/ad-spend/campaign-status.js';
import type { CampaignSyncState } from '../src/ad-spend/campaign-cache.js';
import { defaultSettings } from '../src/settings.js';
import { settingsPage } from '../src/settings-view.js';
import { sourceHealthPage } from '../src/views.js';
import type { SourceHealth } from '../src/sources.js';
import type { ShopifyDashboard } from '../src/shopify/dashboard.js';

test('Settings distinguishes pending, successful-empty and failed campaign reads in UK time', () => {
  const cases: [CampaignSyncState, string][] = [
    [{ state: 'pending', at: null }, 'Campaigns will appear after the next Meta ad spend sync.'],
    [{ state: 'success', at: '2026-10-10T11:00:00Z' }, 'Campaigns updated 10 Oct 2026, 12:00 UK'],
    [{ state: 'error', at: '2026-10-10T11:00:00Z', code: 'http 400, meta 100/42' }, 'Campaigns could not be read at 10 Oct 2026, 12:00 UK (http 400, meta 100/42). Spend is unaffected.'],
  ];
  for (const [state, message] of cases) {
    assert.equal(campaignSyncText(state), message);
    const html = settingsPage({ version: 0, values: defaultSettings() }, [], 'live', new Date('2026-10-10T11:00:00Z'), [], state);
    assert.ok(html.includes(message));
    assert.equal((html.match(/data-campaign-sync/g) ?? []).length, 1);
    assert.equal(html.includes('Campaigns will appear after the next Meta ad spend sync.'), state.state === 'pending');
    assert.ok(html.indexOf('data-campaign-sync') < html.indexOf('class="setting-campaigns"'));
  }
  assert.equal(campaignSyncText({ state: 'success', at: '2026-12-10T11:00:00Z' }), 'Campaigns updated 10 Dec 2026, 11:00 UK');
});

test('a campaign failure is a secondary line on the same healthy Meta source row', () => {
  const meta: SourceHealth = { source: 'meta', name: 'Meta Ads', stage: 2, requiredKeys: [], mode: 'live', status: 'healthy', lastSuccessAt: new Date('2026-10-10T11:00:00Z'), lastAttemptAt: null, consecutiveFailures: 0, updatedAt: new Date('2026-10-10T11:00:00Z') };
  const shopify: ShopifyDashboard = { mode: 'sample', checks: [], stock: [], needs: [], detail: {}, live: { lastOrder: 'Unknown', dispatch: 'Unknown', carts: 'Unknown' } };
  const html = sourceHealthPage([meta], undefined, undefined, undefined, {
    summary: 'Invented sample sources.', shopify, checkedAt: '2026-10-10T11:00:00Z',
    campaigns: { state: 'error', at: '2026-10-10T11:00:00Z', code: 'http 400, meta 100/42' },
  });
  assert.equal((html.match(/<th scope="row">Meta Ads<\/th>/g) ?? []).length, 1);
  assert.match(html, /<td>Healthy<br><small data-campaign-sync data-state="error">Campaigns could not be read/);
  assert.match(html, /Spend is unaffected\./);
  assert.doesNotMatch(html, /Meta campaign not assigned|class="(?:alarm|warn)"/);
});
