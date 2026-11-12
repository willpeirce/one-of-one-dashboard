import assert from 'node:assert/strict';
import test from 'node:test';
import { packName, stockPackRows, stockPacksHtml } from '../src/stock/view.js';
import type { ShopifyDashboard } from '../src/shopify/dashboard.js';

type Row = ShopifyDashboard['stock'][number];
const row = (product: string, market: 'uk' | 'us', available: number | null, required: number | null): Row => ({ market, product, productId: `gid://shopify/Product/${product.length}`,
  locationId: market, name: `${product} · ${market}`, available, required, dailyRate: null, cover: null, runOut: null, basis: 'Invented' });
const model = (stock: Row[]): ShopifyDashboard => ({ mode: 'sample', stock, checks: [], needs: [], detail: {}, live: { lastOrder: '', dispatch: '', carts: '' } } as unknown as ShopifyDashboard);

test('the stock card leaves out kits and the three bundles that have no stock of their own', () => {
  const rows = ['ONE OF ONE', 'STARTER', 'ULTIMATE', 'DUO PACK', 'SLABS & LABEL PACK'].flatMap(product => [row(product, 'uk', 10, 5), row(product, 'us', 10, 5)]);
  assert.deepEqual([...new Set(stockPackRows(rows).map(r => r.product))], ['SLABS & LABEL PACK']);
  const html = stockPacksHtml(model(rows));
  assert.doesNotMatch(html, /Starter|Ultimate|Duo|One Of One/i);
});

test('pack names read as plain words', () => {
  assert.equal(packName('SLABS & LABEL PACK'), 'Slabs & Label');
  assert.equal(packName('CERTIFIED SLAB PACK'), 'Certified Slab');
  assert.equal(packName('THE FRAME'), 'The Frame');
});

test('each pack shows in stock against needed, short packs first and enough-stock packs folded', () => {
  const html = stockPacksHtml(model([
    row('CERTIFIED SLAB PACK', 'uk', 2250, 1980.2), row('CERTIFIED SLAB PACK', 'us', 400, 1200),
    row('REFILL PACK', 'uk', 900, 300), row('REFILL PACK', 'us', 700, 200),
    row('THE FRAME', 'uk', null, null), row('THE FRAME', 'us', 50, null),
  ]));
  assert.match(html, /data-stock-product="CERTIFIED SLAB PACK" data-stock-market="us" data-stock-state="warn"[^>]*aria-label="Watch · Certified Slab · US · 400 in stock, 1,200 needed"/);
  assert.match(html, /2,250 <small>\/ 1,981<\/small>/, 'Needed rounds up to a whole pack');
  assert.match(html, /width:33\.3%/);
  assert.match(html, /<details class="stock-fine"><summary>1 more with enough stock<\/summary>[\s\S]*Refill/);
  assert.match(html, /data-stock-product="THE FRAME" data-stock-market="uk" data-stock-state="info"[^>]*>.*Unknown/);
  assert.match(html, /50 in stock/);
  assert.doesNotMatch(html, / data-state=/, 'Stock cells never feed the dial health counts');
  assert.equal(stockPacksHtml(model([])), '');
});
