import assert from 'node:assert/strict';
import test from 'node:test';
import { applySpend } from '../src/ad-spend/metrics.js';
import { sampleSpend } from '../src/ad-spend/store.js';
import { buildHeroRange } from '../src/hero-range.js';
import { defaultSettings } from '../src/settings.js';
import { cleanOrder, type Order } from '../src/shopify/model.js';
import { fixture } from '../src/shopify/sample.js';
const day = '2026-10-09', today = '2026-10-10';
async function calculation(missing: 'google-ads' | 'meta' | 'meta-disconnected') {
  const base = cleanOrder((await fixture('order')).data.order);
  const orders = (['UK', 'US'] as const).map((market, index): Order => ({ ...base, id: `gid://shopify/Order/${990400 + index}`, day, market, refunds: [] }));
  const spend = sampleSpend(day, day); spend.mode = 'live';
  spend.sources = spend.sources.map(source => ({ ...source, live: source.source !== 'tiktok', ready: source.source !== 'tiktok', status: source.source === 'tiktok' ? 'waiting for keys' : 'live', fetchedAt: source.source === 'tiktok' ? null : '2026-10-10T10:00:00Z' }));
  const prototype = spend.rows[0]!;
  spend.rows = [
    { ...prototype, market: 'uk', campaignName: 'Invented Meta UK', adSetName: 'Invented source — UK — set', amount: '20.000000' },
    { ...prototype, market: 'us', campaignName: 'Invented Meta US', adSetName: 'Invented source — US — set', amount: '10.000000' },
    { ...prototype, source: 'google-ads', market: 'uk', campaignName: 'Invented Google UK', amount: '99.000000' },
  ];
  const source = spend.sources.find(source => source.source === (missing === 'meta-disconnected' ? 'meta' : missing))!;
  if (missing === 'meta-disconnected') Object.assign(source, { live: false, ready: false, status: 'waiting for keys', fetchedAt: null });
  else Object.assign(source, { failures: 2, status: 'source unavailable' });
  const hero = buildHeroRange([{ date: day, net: 100, o: 2, uk: 1, us: 1, sess: 20, ukS: 10, ukM: 0, usM: 0, g: 0, ours: 0 }], day, day, { today });
  applySpend(hero, orders, defaultSettings(), today, { spend, costs: [], estimates: [] }); return hero;
}
test('Google gaps do not degrade measured Meta-only cost-per-order dials, while all-spend metrics retain their warning', async () => {
  const h = await calculation('google-ads'); assert.equal(h.ukcpo.t, '£20.00'); assert.equal(h.uscpo.t, '£10.00');
  for (const dial of [h.ukcpo, h.uscpo]) { assert.equal(dial.cap, 'info'); assert.equal(dial.d.src, 'Meta'); assert.deepEqual(dial.source, ['shopify', 'meta']); assert.doesNotMatch(dial.s, /Google|TikTok|Excludes/); assert.ok(dial.d.extra!.every(([name]) => /Meta/.test(name))); }
  for (const metric of [h.cac, h.spend, h.roas, h.margin, h.profit]) { assert.equal(metric.state, 'warn'); assert.match(metric.ss, /Google/); }
});
test('healthy Google never supplies a valid zero or freshness to unavailable or disconnected Meta', async () => {
  for (const missing of ['meta', 'meta-disconnected'] as const) {
    const h = await calculation(missing); assert.equal(h.spend.n, 99); assert.equal(h.cac.n, 49.5);
    for (const dial of [h.ukcpo, h.uscpo]) { assert.equal(dial.t, '—'); assert.equal(dial.hidePointer, true); assert.deepEqual(dial.source, ['shopify', 'meta']); assert.doesNotMatch(dial.s, /Google|TikTok/); if (missing === 'meta') { assert.equal(dial.cap, 'warn'); assert.match(dial.s, /Excludes Meta spend/); } else { assert.equal(dial.cap, 'info'); assert.match(dial.s, /Meta waiting for keys/); } }
  }
});
