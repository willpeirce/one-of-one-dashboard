import assert from 'node:assert/strict';
import type { BrowserContext } from 'playwright';
import { sourceHealthPage } from '../src/views.js';
import type { SourceHealth } from '../src/sources.js';

export async function checkGrossHistoryProgress(context: BrowserContext): Promise<void> {
  // Entirely invented history; no source credentials or real sales dates are used.
  const state = {
    first: '2026-03-01', last: '2026-03-17', next: '2026-03-15',
    filled: [{ from: '2026-03-01', to: '2026-03-07' }],
    skipped: [{ from: '2026-03-08', to: '2026-03-14' }],
  };
  const health: SourceHealth = {
    source: 'shopify', name: 'Shopify', stage: 1, requiredKeys: [], mode: 'live', status: 'healthy',
    lastSuccessAt: null, lastAttemptAt: null, consecutiveFailures: 0, updatedAt: new Date('2026-03-18T12:00:00Z'),
  };
  const imports: NonNullable<Parameters<typeof sourceHealthPage>[1]> = {
    mode: 'live', sample: false, counts: {}, notices: [], geoNotice: null, pendingWebhooks: 0,
    jobs: [{ name: 'gross_history', state, failures: 0, last_success_at: null }],
  };
  const page = await context.newPage();
  try {
    await page.route('**/sources', route => route.fulfill({ contentType: 'text/html', body: sourceHealthPage([health], imports) }));
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/sources');
      assert.equal(await page.locator('[data-gross-history]').innerText(), 'Total sales history: 1 of 3 weeks filled, 1 skipped');
      assert.match(await page.locator('#source-health tbody tr td').nth(1).innerText(), /^Healthy\n/);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
  } finally { await page.close(); }
}
