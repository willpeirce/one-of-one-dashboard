import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import {registerKitDetails} from '../src/kits/routes.js';
import {sampleKitFacts} from '../src/kits/sample.js';
import type {KitFacts} from '../src/kits/model.js';
import type {SourceMode} from '../src/sources.js';

const now = new Date('2032-04-07T12:00:00Z');

function harness(t: test.TestContext, dashboardMode: SourceMode = 'sample') {
  const app = Fastify({logger: false});
  let reads = 0, facts = sampleKitFacts(now), failure = false;
  registerKitDetails(app, {session: async request => request.headers['x-invented-session'] === 'yes' ? 'invented-device' : null}, {
    dashboardMode, clock: () => now, load: async at => {
      reads++; assert.equal(at, now);
      if (failure) throw new Error('Invented private failure detail');
      return facts;
    },
  });
  t.after(() => app.close());
  return {app, headers: {'x-invented-session': 'yes'}, reads: () => reads,
    facts: (value: KitFacts) => {facts = value;}, fail: () => {failure = true;}};
}

test('kit details authenticate before reading and reject invalid or oversized ids without a data read', async t => {
  const h = harness(t);
  const page = await h.app.inject('/kits');
  assert.equal(page.statusCode, 302); assert.equal(page.headers.location, '/login');
  assert.equal(page.headers['cache-control'], 'no-store');
  const signedOut = await h.app.inject('/api/kits/box-b');
  assert.equal(signedOut.statusCode, 401); assert.equal(signedOut.headers['cache-control'], 'no-store');
  assert.equal((await h.app.inject('/api/kits/box-b?suppliers=wrong&extra=value')).statusCode, 401,
    'Authentication also precedes query validation');
  assert.equal(h.reads(), 0);
  for (const id of ['x'.repeat(41), '<script>', 'two words', '../box-b']) {
    const response = await h.app.inject({url: `/api/kits/${encodeURIComponent(id)}`, headers: h.headers});
    assert.equal(response.statusCode, 404, id);
  }
  assert.equal(h.reads(), 0, 'Invalid ids cannot trigger a stored-data read');
  assert.equal((await h.app.inject({method: 'POST', url: '/api/kits/box-b', headers: h.headers})).statusCode, 404);
  const facts = sampleKitFacts(now); facts.kits.rows[0]!.id = 'box--a-'; h.facts(facts);
  const permitted = await h.app.inject({url: '/api/kits/box--a-', headers: h.headers});
  assert.equal(permitted.statusCode, 200, 'The route accepts the same slug shape as the parser and stored schema');
  assert.equal(permitted.json<{id: string}>().id, 'box--a-');
});

test('kit supplier details require the single explicit bounded query and Home stays supplier-free', async t => {
  const h = harness(t);
  for (const query of ['suppliers=', 'suppliers=0', 'suppliers=true', 'suppliers=1&suppliers=1',
    'suppliers=1&extra=value', 'extra=value', 'suppliers%5B%5D=1']) {
    const response = await h.app.inject({url: `/api/kits/box-b?${query}`, headers: h.headers});
    assert.equal(response.statusCode, 400, query);
    assert.deepEqual(response.json(), {error: 'Kit details request refused.'});
  }
  assert.equal(h.reads(), 0, 'Invalid query shapes cannot trigger a stored-data read');
  const home = await h.app.inject({url: '/api/kits/box-b', headers: h.headers});
  const page = await h.app.inject({url: '/api/kits/box-b?suppliers=1', headers: h.headers});
  assert.equal(home.statusCode, 200); assert.equal(page.statusCode, 200);
  const homeView = home.json<{orders: Record<string, unknown>[]}>(), pageView = page.json<typeof homeView>();
  assert.equal(pageView.orders.length, 5);
  assert.ok(pageView.orders.every(row => row.supplier === 'a supplier'));
  assert.ok(homeView.orders.every(row => !Object.hasOwn(row, 'supplier')));
  assert.deepEqual({...pageView, orders: pageView.orders.map(({supplier: _supplier, ...order}) => order)}, homeView,
    'The explicit Kits view adds only supplier fields to the existing sheet');
  assert.doesNotMatch(page.body, /"ref"/);
});

test('kit page and both detail views keep the same sample/live boundary as Home', async t => {
  for (const dashboardMode of ['sample', 'live'] as const) for (const sourceMode of ['sample', 'live'] as const) {
    const h = harness(t, dashboardMode); h.facts({...sampleKitFacts(now), mode: sourceMode});
    const suppressed = sourceMode === 'sample' && dashboardMode === 'live';
    for (const query of ['', '?suppliers=1']) {
      const response = await h.app.inject({url: `/api/kits/box-b${query}`, headers: h.headers});
      assert.equal(response.statusCode, suppressed ? 404 : 200, `${sourceMode} HQ beside ${dashboardMode} Shopify`);
      assert.equal(response.headers['cache-control'], 'no-store');
      if (response.statusCode === 200) {
        assert.match(response.body, /Box B/);
        if (!query) assert.doesNotMatch(response.body, /"supplier"|a supplier|"ref"/, 'The Home sheet does not send supplier or reference data');
        else assert.match(response.body, /"supplier":"a supplier"/);
      } else assert.doesNotMatch(response.body, /Box B|sample/i);
    }
    const page = await h.app.inject({url: '/kits', headers: h.headers});
    assert.equal(page.statusCode, 200); assert.match(String(page.headers['content-type']), /text\/html/);
    assert.equal(page.headers['cache-control'], 'no-store');
    if (suppressed) {
      assert.match(page.body, /Not set up yet/); assert.doesNotMatch(page.body, /Box [A-F]|the kit maker|a supplier|Sample data/);
    } else {
      for (const name of ['Box A', 'Box B', 'Box C', 'Box D', 'Box E', 'Box F']) assert.ok(page.body.includes(name));
      assert.match(page.body, /a supplier/);
      if (sourceMode === 'sample') assert.match(page.body, /Sample data/);
      else assert.doesNotMatch(page.body, /Sample data/);
    }
  }
});

test('kit details return a quiet not-found and contain read failures without exposing their values', async t => {
  const h = harness(t);
  assert.equal((await h.app.inject({url: '/api/kits/unknown-box', headers: h.headers})).statusCode, 404);
  h.fail();
  const response = await h.app.inject({url: '/api/kits/box-b', headers: h.headers});
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), {error: 'Kit details could not be read. Try again later.'});
  assert.doesNotMatch(response.body, /private failure/);
  const page = await h.app.inject({url: '/kits', headers: h.headers});
  assert.equal(page.statusCode, 503);
  assert.equal(page.body, 'Kits could not be read. Try again later.');
  assert.doesNotMatch(page.body, /Not set up yet|private failure/);
});
