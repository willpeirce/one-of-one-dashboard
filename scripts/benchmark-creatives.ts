import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import Fastify from 'fastify';
import { chromium } from 'playwright';
import type { Auth } from '../src/auth.js';
import { readSettings, saveSettings } from '../src/settings.js';
import { registerCreatives } from '../src/creatives/routes.js';
import { readCreativeData } from '../src/creatives/store.js';
import { creativeDialogHtml } from '../src/creatives/view.js';
import type { CreativeReader } from '../src/creatives/model.js';
import type { CreativeSheet } from '../src/creatives/presentation-types.js';
import { createTestDatabase } from '../test/helpers/database.js';
import { creativePerformanceFixture as fixture, seedCreativePerformanceFixture } from '../test/fixtures/meta/creative-performance.js';

// npm run build, then TEST_DATABASE_URL=<disposable PostgreSQL server> node --import tsx scripts/benchmark-creatives.ts
// The harness creates/drops a separate database, never contacts Meta, and reports
// three runs plus their median. Set CREATIVE_BENCH_BROWSER=1 to measure tap-to-sheet.
if (!process.env.TEST_DATABASE_URL) throw new Error('Set TEST_DATABASE_URL to a disposable PostgreSQL server.');
const db = await createTestDatabase();
const app = Fastify({ logger: false });
const readings = new Map<string, number[]>();
const record = (name: string, elapsed: number) => {
  const values = readings.get(name) ?? [];
  values.push(elapsed); readings.set(name, values);
  console.log(JSON.stringify({ name, run: values.length, ms: Math.round(elapsed) }));
};
try {
  const initial = await readSettings(db);
  await saveSettings(db, { ...initial, values: { ...initial.values, metaAdAccountId: fixture.account } }, 'invented-benchmark');
  const settings = (await readSettings(db)).values;
  await seedCreativePerformanceFixture(db);
  const env = { META_ACCESS_TOKEN: randomBytes(24).toString('hex') };
  const now = new Date(`${fixture.today}T12:00:00Z`);
  // Authentication is replaced only in this isolated benchmark server.
  const auth = { config: { origin: 'https://example.test' }, session: async () => 'invented-benchmark' } as unknown as Auth;
  const reader: CreativeReader = {
    async *readCatalogue() { yield []; }, async readInsights() { return []; },
    async videoSource() { return 'https://example.test/invented'; },
    async imageBytes() { return new Uint8Array(); }, async videoFrames() { return []; },
  };
  registerCreatives(app, db, auth, env, () => now, async () => ({ count: 123, mode: 'live' }), async () => {}, reader);
  app.get('/benchmark', async (_request, reply) => reply.type('text/html').send(`<!doctype html><html><head>
    <meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/dashboard.css">
    <link rel="stylesheet" href="/assets/creatives.css"><script type="module" src="/assets/creatives.js"></script></head><body>
    <p>Sample data · every account, ad and figure is invented.</p>
    <button data-creative-open="${fixture.groupId}">Open invented creative</button>${creativeDialogHtml()}</body></html>`));
  for (const name of ['creatives.js', 'dashboard.css', 'creatives.css']) {
    app.get(`/assets/${name}`, async (_request, reply) => reply.type(name.endsWith('.js') ? 'text/javascript' : 'text/css')
      .send(await readFile(new URL(`../dist/public/${name}`, import.meta.url))));
  }
  console.log(JSON.stringify({ fixture: 'Invented Meta catalogue', groups: fixture.groups,
    ads: fixture.groups * fixture.adsPerGroup, insights: fixture.groups * fixture.adsPerGroup * fixture.days }));
  for (let run = 0; run < 3; run++) {
    let start = performance.now();
    await readCreativeData(db, settings, env, now);
    record('database-read', performance.now() - start);
    for (const [name, url] of [['library-api', '/api/creatives'], ['sheet-api', `/api/creatives/${fixture.groupId}`]]) {
      start = performance.now();
      const response = await app.inject(url!);
      record(name!, performance.now() - start);
      assert.equal(response.statusCode, 200);
      if (name === 'sheet-api') assert.equal(response.json<CreativeSheet>().group.group.id, fixture.groupId);
    }
  }
  if (process.env.CREATIVE_BENCH_BROWSER === '1') {
    const origin = await app.listen({ host: '127.0.0.1', port: 0 });
    const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      // Media is deliberately unavailable: sheet text and metrics must still fill promptly.
      await page.route('**/media/**', route => route.abort());
      await page.goto(`${origin}/benchmark`);
      for (let run = 0; run < 3; run++) {
        const start = performance.now();
        await page.locator('[data-creative-open]').click();
        await page.locator('#creative-sheet .creative-performance-table').waitFor();
        record('tap-to-sheet', performance.now() - start);
        assert.doesNotMatch(await page.locator('#creative-sheet-body').innerText(), /Opening creative/);
        await page.locator('[data-creative-close]').click();
      }
    } finally { await browser.close(); }
  }
  for (const [name, values] of readings) {
    const sorted = [...values].sort((a, b) => a - b);
    console.log(JSON.stringify({ name, medianMs: Math.round(sorted[1]!), minMs: Math.round(sorted[0]!), maxMs: Math.round(sorted[2]!) }));
  }
} finally {
  try { await app.close(); } finally { await db.close(); }
}
