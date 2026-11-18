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
  const signedOut = await h.app.inject('/api/kits/box-b');
  assert.equal(signedOut.statusCode, 401); assert.equal(signedOut.headers['cache-control'], 'no-store');
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

test('kit details keep the same sample/live boundary as Home, even for a guessed sample id', async t => {
  for (const dashboardMode of ['sample', 'live'] as const) for (const sourceMode of ['sample', 'live'] as const) {
    const h = harness(t, dashboardMode); h.facts({...sampleKitFacts(now), mode: sourceMode});
    const response = await h.app.inject({url: '/api/kits/box-b', headers: h.headers});
    assert.equal(response.statusCode, sourceMode === 'sample' && dashboardMode === 'live' ? 404 : 200,
      `${sourceMode} HQ beside ${dashboardMode} Shopify`);
    assert.equal(response.headers['cache-control'], 'no-store');
    if (response.statusCode === 200) {
      assert.match(response.body, /Box B/);
      assert.doesNotMatch(response.body, /"supplier"|a supplier|"ref"/, 'The Home sheet does not send supplier or reference data');
    } else assert.doesNotMatch(response.body, /Box B|sample/i);
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
});
