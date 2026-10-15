import assert from 'node:assert/strict';
import type { BrowserContext, Page } from 'playwright';
import type { DashboardSnapshot, HeroMarket, HeroPeriod } from '../src/dashboard-types.js';
import { formatMetricNumber, formatPounds } from '../src/money.js';
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
    const expected = Object.fromEntries((['net', 'orders', 'aov', 'cac', 'cr', 'spend', 'roas', 'margin', 'contribution', 'profit'] as const)
      .map(key => [key, model[key].unavailable ? model[key].unavailableLabel ?? 'No data' : formatMetricNumber(model[key].n, model[key])]));
    await page.waitForFunction(values => Object.entries(values).every(([key, value]) => document.querySelector(`#hero [data-k="${key}"] .sv`)?.textContent === value), expected);
    assert.equal(await page.locator('#eyebrow').textContent(), model.eyebrow);
    assert.equal(await page.locator('#hero [data-k="net"] .gross').innerText(), model.grossUnavailable ? 'Total unavailable' : `Total ${formatPounds(model.gross)}`);
    assert.equal(await page.locator('#hero .gross').count(), 1);
    await page.locator('#hero [data-k="net"]').click();
    assert.match(await page.locator('#sh-extra').textContent() ?? '', /Total sales \(incl\. shipping and tax\)/);
    if (!model.grossUnavailable) assert.ok((await page.locator('#sh-extra').textContent() ?? '').includes(formatPounds(model.gross)));
    await page.locator('#sh-x').click();
    assert.equal(await page.locator('#hero [data-k="contribution"] .ss').innerText(), model.contribution.ss);
    assert.doesNotMatch(model.contribution.ss, /before overheads|store-wide/);
    await page.locator('#hero [data-k="contribution"]').click();
    assert.equal(await page.locator('#sh-title').innerText(), 'Contribution');
    assert.deepEqual(await page.locator('#sh-extra dd').allTextContents(), model.contribution.d.extra!.map(([, value]) => value));
    await page.locator('#sh-x').click();
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
      await page.locator('#market').evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
      const scrollBefore = await page.evaluate(() => scrollY);
      await page.locator(`#market [data-market="${market}"]`).click();
      const expectedNet = market === 'all' ? snapshot.hero.today.net : snapshot.hero.today.markets![market].net;
      await page.waitForFunction(value => document.querySelector('#hero [data-k="net"] .sv')?.textContent === value,
        expectedNet.unavailable ? expectedNet.unavailableLabel ?? 'No data' : formatMetricNumber(expectedNet.n, expectedNet));
      assert.ok(Math.abs(await page.evaluate(() => scrollY) - scrollBefore) < 1, 'A market tap updates the hero without scrolling');
      const netInView = await page.locator('#hero [data-k="net"]').evaluate(element => {
        const rect = element.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= innerHeight;
      });
      assert.ok(netInView, 'The first hero tile is visible beside the market choice');
      await checkView(snapshot.hero.today, market);
      assert.equal(await page.locator('#hero .hero-grid > .tile').count(), 8);
      const columns = await page.locator('.hero-grid').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length);
      assert.equal(columns, width < 761 ? 2 : 4);
      const periodBox = await page.locator('#period').boundingBox(), marketBox = await page.locator('#market').boundingBox();
      const radarBox = await page.locator('#radar').boundingBox(), heroBox = await page.locator('.hero-grid').boundingBox();
      assert.ok(periodBox && marketBox && radarBox && heroBox);
      assert.ok(periodBox.y < radarBox.y, 'Period tabs stay above the radar');
      assert.ok(marketBox.y >= radarBox.y + radarBox.height, 'The market switch sits below the radar');
      assert.ok(heroBox.y >= marketBox.y + marketBox.height && heroBox.y - marketBox.y - marketBox.height < 32,
        'The market switch sits directly above the hero tiles');
      assert.equal(await page.locator('#market').evaluate(element => element.nextElementSibling?.classList.contains('hero-grid')), true);
      assert.equal(await page.locator('#hero .per').count(), 0);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    assert.equal(heroRequests, 0, 'market taps use views already in the snapshot');
    const zero = structuredClone(snapshot); zero.generatedAt = new Date(Date.parse(snapshot.generatedAt) + 500).toISOString();
    zero.hero.today.markets!.us.gross = 0; zero.hero.today.markets!.us.grossUnavailable = false;
    const updated = zero.hero.today.markets!.us.contribution;
    updated.n += 5;
    updated.d.extra = updated.d.extra!.map(([label, value]) => [label, label === 'Contribution' ? formatPounds(updated.n) : value]);
    await page.locator('#hero [data-k="contribution"]').click();
    await page.evaluate(next => (window as unknown as { pulseMarketStream: EventSource }).pulseMarketStream.dispatchEvent(new MessageEvent('dashboard', { data: JSON.stringify(next) })), zero);
    await page.waitForFunction(() => document.querySelector('#hero .gross')?.textContent === 'Total £0.00');
    assert.equal(await page.locator('#hero [data-k="contribution"] .sv').innerText(), formatPounds(updated.n));
    assert.equal(await page.locator('#sh-title').innerText(), 'Contribution');
    assert.equal(await page.locator('#sh-extra dt:text-is("Contribution") + dd').innerText(), formatPounds(updated.n));
    await page.locator('#sh-x').click();
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
