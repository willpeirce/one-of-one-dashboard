import assert from 'node:assert/strict';
import type { BrowserContext, Page } from 'playwright';
import type { DashboardSnapshot } from '../src/dashboard-types.js';
import { morningInputFromDashboard } from '../src/morning/inputs.js';
import { morningDeck } from '../src/morning/model.js';
import { curateMorningSample } from '../src/morning/sample.js';
import type { TickerSnapshot } from '../src/ticker/model.js';
import type { MorningSnapshot } from '../src/morning/model-types.js';
import type { Settings, SettingsSnapshot } from '../src/settings.js';

const keys = ['googleContentShareMaxPct', 'googleContentSpendFloorGbp', 'googleNoSaleSpendFloorGbp',
  'googleBreakEvenReturnUk', 'googleBreakEvenReturnUs', 'googleContactName'] as const;
type GoogleSettings = Pick<Settings, typeof keys[number]>;
const pick = (values: Settings): GoogleSettings => Object.fromEntries(keys.map(key => [key, values[key]])) as GoogleSettings;

async function openAdSettings(page: Page): Promise<void> {
  const field = page.locator('input[name="googleNetworkSpendFloorGbp"]');
  await field.locator('xpath=ancestor::details').evaluate(element => { (element as HTMLDetailsElement).open = true; });
  const group = field.locator('xpath=ancestor::details');
  for (const key of keys) assert.equal(await group.locator(`input[name="${key}"]`).isVisible(), true, `${key} stays with the Google network settings`);
}

/** Exercise real Settings saves and the same sample candidate builder, then focus its copy UI with an intercepted read. */
export async function checkGoogleJunk(signedIn: BrowserContext): Promise<void> {
  const response = await signedIn.request.get('/api/settings'); assert.equal(response.status(), 200);
  const before = await response.json() as SettingsSnapshot, original = pick(before.values), origin = new URL(response.url()).origin;
  const context = await signedIn.browser()!.newContext({baseURL: origin, storageState: await signedIn.storageState()});
  const errors: string[] = [], unexpectedWrites: string[] = [];
  let external = 0;
  context.on('page', page => page.on('pageerror', error => errors.push(error.name)));
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin) { external++; await route.abort('blockedbyclient'); }
    else if (!['GET', 'HEAD'].includes(request.method()) && url.pathname !== '/api/settings') {
      unexpectedWrites.push(`${request.method()} ${url.pathname}`); await route.abort('blockedbyclient');
    } else await route.continue();
  });
  // Raw browser code avoids a transpiler helper being captured in the page function.
  await context.addInitScript({content: `(() => {
    const copied = [];
    Object.defineProperty(window, '__googleNoteClipboard', {value: copied});
    Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText: async value => { copied.push(value); }}});
  })();`});
  const readSettings = async (): Promise<SettingsSnapshot> => {
    const reply = await context.request.get('/api/settings'); assert.equal(reply.status(), 200); return await reply.json() as SettingsSnapshot;
  };
  try {
    for (const width of [390, 1280]) {
      const page = await context.newPage(); await page.setViewportSize({width, height: width === 390 ? 844 : 960});
      const wanted: GoogleSettings = width === 390
        ? {googleContentShareMaxPct: 3.5, googleContentSpendFloorGbp: 8.25, googleNoSaleSpendFloorGbp: 35.5,
          googleBreakEvenReturnUk: 1.4, googleBreakEvenReturnUs: 1.6, googleContactName: 'Invented phone helper'}
        : {googleContentShareMaxPct: 4.5, googleContentSpendFloorGbp: 9.75, googleNoSaleSpendFloorGbp: 45.5,
          googleBreakEvenReturnUk: 1.7, googleBreakEvenReturnUs: 1.9, googleContactName: 'Invented desktop helper'};
      try {
        await page.goto('/settings'); await openAdSettings(page);
        for (const key of keys) await page.locator(`input[name="${key}"]`).fill(String(wanted[key]));
        const save = page.waitForResponse(reply => new URL(reply.url()).pathname === '/api/settings' && reply.request().method() === 'POST');
        await page.locator('#settings-save').click(); assert.equal((await save).status(), 200);
        await page.waitForFunction(() => document.querySelector('#settings-message')?.textContent === 'Settings saved.');
        assert.deepEqual(pick((await readSettings()).values), wanted, `${width}: all six Google Settings persist`);
        await page.reload(); await openAdSettings(page);
        for (const key of keys) assert.equal(await page.locator(`input[name="${key}"]`).inputValue(), String(wanted[key]));

        const morningResponse = await context.request.get('/api/morning'); assert.equal(morningResponse.status(), 200);
        const actual = await morningResponse.json() as MorningSnapshot;
        assert.equal(actual.mode, 'sample');
        assert.ok(!actual.cards.some(card => card.kind === 'google'), 'The Google Watch candidate stays out of the decision deck');
        const [dashboardResponse, tickerResponse] = await Promise.all([
          context.request.get('/api/dashboard'), context.request.get('/api/ticker'),
        ]);
        assert.equal(dashboardResponse.status(), 200); assert.equal(tickerResponse.status(), 200);
        const dashboard = await dashboardResponse.json() as DashboardSnapshot;
        const ticker = await tickerResponse.json() as TickerSnapshot;
        const clock = new Date(`${actual.day}T12:00:00Z`);
        const input = curateMorningSample(morningInputFromDashboard(dashboard, (await readSettings()).values, ticker, 'sample'), clock);
        const google = morningDeck(input, [], clock).candidates.find(card => card.kind === 'google');
        assert.ok(google, 'The same sample builder retains the Google candidate and its copy note');
        assert.equal(google.primary.kind, 'copy');
        if (google.primary.kind !== 'copy') throw new Error('Expected a copy-only Google card');
        const note = google.primary.text;
        assert.equal(google.primary.label, `Note for ${wanted.googleContactName}`);
        assert.match(note, /Google/i); assert.match(note, /\d/, 'The copy note keeps the flag figures');
        assert.ok(![google.primary, google.secondary, ...google.menu].some(button => button?.kind === 'live'));
        const focused: MorningSnapshot = {...actual, cards: [google], more: 0, completed: 0, total: 1};
        await page.route('**/api/morning', route => route.fulfill({json: focused}));
        await page.goto('/morning'); await page.locator('#mn-root[data-mn-ready="true"]').waitFor();
        await page.locator('#mn-card[data-mn-kind="google"]').waitFor();
        assert.match(await page.locator('#mn-day').innerText(), /sample data/i);
        assert.match(await page.locator('#mn-card .mn-lane').innerText(), /sample/i);
        assert.equal(await page.locator('#mn-primary').innerText(), google.primary.label);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.locator('#mn-primary').click(); await page.locator('#mn-dialog').waitFor({state: 'visible'});
        assert.equal(await page.locator('#mn-dialog').evaluate(element => element.matches(':modal')), true);
        assert.equal(await page.locator('#mn-copy-text').inputValue(), note);
        await page.locator('#mn-copy').click();
        await page.waitForFunction(() => document.querySelector('#mn-toast-message')?.textContent?.includes('Copied. You send it.'));
        assert.equal(await page.evaluate(() => (window as unknown as {__googleNoteClipboard: string[]}).__googleNoteClipboard.at(-1)), note);
        await page.locator('#mn-dialog').waitFor({state: 'hidden'});
        assert.equal(await page.evaluate(() => document.activeElement?.id), 'mn-primary');
      } finally { await page.close(); }
    }
    assert.deepEqual(errors, []); assert.deepEqual(unexpectedWrites, []); assert.equal(external, 0);
    console.log('Google junk browser checks passed: six saved Settings, labelled sample card and copy-only note at 390 and 1280.');
  } finally {
    try {
      const current = await readSettings();
      const restored = await context.request.post('/api/settings', {headers: {origin}, data: {...current, values: {...current.values, ...original}}});
      assert.equal(restored.status(), 200); assert.deepEqual(pick((await readSettings()).values), original);
    } finally { await context.close(); }
  }
}
