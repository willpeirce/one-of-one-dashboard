import assert from 'node:assert/strict';
import type { BrowserContext, Page } from 'playwright';
import type { DashboardSnapshot, HeroMarket, HeroPeriod } from '../src/dashboard-types.js';
import { formatMetricNumber } from '../src/money.js';
import { addDays } from '../src/hero-range.js';

/** Install before page navigation, so a browser test can replay an SSE snapshot. */
export async function installMarketUpdateHook(context: BrowserContext): Promise<void> {
  await context.addInitScript(`(() => {
    const Native = window.EventSource;
    class MarketEventSource extends Native {
      constructor(url, options) {
        super(url, options);
        window.pulseMarketStream = this;
      }
    }
    window.EventSource = MarketEventSource;
  })();`);
}

export async function checkMarketHero(page: Page, snapshot: DashboardSnapshot, width: number): Promise<void> {
  const checkView = async (period: HeroPeriod, market: HeroMarket) => {
    const model = market === 'all' ? period : period.markets![market];
    const expected = Object.fromEntries((['net', 'orders', 'aov', 'cac', 'cr', 'spend', 'roas', 'margin', 'profit'] as const)
      .map(key => [key, model[key].unavailable ? model[key].unavailableLabel ?? 'No data' : formatMetricNumber(model[key].n, model[key])]));
    await page.waitForFunction(values => Object.entries(values).every(([key, value]) => document.querySelector(`#hero [data-k="${key}"] .sv`)?.textContent === value), expected);
    assert.equal(await page.locator('#eyebrow').textContent(), model.eyebrow);
    assert.equal(await page.locator('#market [aria-selected="true"]').getAttribute('data-market'), market);
    assert.equal(await page.locator('[data-k="ukcpo"]').isVisible(), market !== 'us');
    assert.equal(await page.locator('[data-k="uscpo"]').isVisible(), market !== 'uk');
  };
  await page.locator('[data-tab="ads"]').click();
  await page.locator('[data-period="today"]').click();
  let heroRequests = 0;
  const listener = (request: { url(): string }) => { if (new URL(request.url()).pathname === '/api/hero') heroRequests++; };
  page.on('request', listener);
  try {
    for (const market of ['all', 'uk', 'us'] as const) {
      await page.locator(`#market [data-market="${market}"]`).click();
      await checkView(snapshot.hero.today, market);
      assert.equal(await page.locator('#hero .hero-grid > .tile').count(), 8);
      const columns = await page.locator('.hero-grid').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length);
      assert.equal(columns, width < 761 ? 2 : 4);
      const periodBox = await page.locator('#period').boundingBox(), marketBox = await page.locator('#market').boundingBox();
      assert.ok(periodBox && marketBox);
      if (width >= 761) assert.ok(Math.abs(periodBox.y - marketBox.y) < 1, 'Desktop period and market controls sit beside each other');
      else assert.ok(marketBox.y >= periodBox.y + periodBox.height, 'Phone market control gets its own row');
      assert.equal(await page.locator('#hero .per').count(), 0);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    assert.equal(heroRequests, 0, 'market taps use views already in the snapshot');
    await page.locator('[data-period="7d"]').click();
    await checkView(snapshot.hero['7d'], 'us');
    const replay = structuredClone(snapshot);
    replay.generatedAt = new Date(Date.parse(snapshot.generatedAt) + 1000).toISOString();
    await page.evaluate(next => {
      const stream = (window as unknown as { pulseMarketStream: EventSource }).pulseMarketStream;
      if (!stream) throw new Error('Install the market update hook before navigation.');
      stream.dispatchEvent(new MessageEvent('dashboard', { data: JSON.stringify(next) }));
    }, replay);
    await page.waitForFunction(stamp => document.documentElement.dataset.updatedAt === stamp, replay.generatedAt);
    await checkView(snapshot.hero['7d'], 'us');
    const from = addDays(snapshot.bounds.today, -5), to = addDays(snapshot.bounds.today, -3);
    const response = await page.request.get(`/api/hero?from=${from}&to=${to}`);
    assert.equal(response.status(), 200);
    const picked = await response.json() as HeroPeriod;
    await page.locator('#pickbtn').click();
    await page.locator('#pkclear').click();
    await page.locator(`#pkcal [data-date="${from}"]`).click();
    await page.locator(`#pkcal [data-date="${to}"]`).click();
    await page.locator('#pkgo').click();
    await page.locator('#picker').waitFor({ state: 'hidden' });
    await checkView(picked, 'us');
    await page.locator('#market [data-market="uk"]').click();
    await checkView(picked, 'uk');
    assert.equal(await page.locator('#hero').getAttribute('data-from'), from);
    assert.equal(await page.locator('#hero').getAttribute('data-to'), to);
    await page.locator('#market [data-market="all"]').click();
    await page.locator('[data-period="today"]').click();
    await checkView(snapshot.hero.today, 'all');
  } finally { page.off('request', listener); }
}
