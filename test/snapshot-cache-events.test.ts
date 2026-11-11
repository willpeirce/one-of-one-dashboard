import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerDashboardEvents } from '../src/events.js';
import { readRuntime } from '../src/runtime.js';
import { SnapshotCache } from '../src/snapshot-cache.js';

const turn = () => new Promise<void>(resolve => setImmediate(resolve));

test('explicit publish invalidates once without SSE subscribers, while heartbeat and waiting reads do not rebuild', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const app = Fastify({ logger: false });
  let builds = 0, snapshots = 0, release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const cache = new SnapshotCache(async () => {
    const revision = ++builds;
    if (revision === 2) await blocked;
    return { revision };
  }, { onBuilt: () => events.refresh() });
  const events = registerDashboardEvents(app, {
    config: readRuntime({ DATABASE_URL: 'postgresql://localhost/pulse_invented_events' }), session: async () => null,
  }, async () => { snapshots++; return cache.read(); }, { onPublish: () => { void cache.invalidate(); } });
  app.post('/auth/logout', async () => ({ signedOut: true }));
  t.after(async () => { release(); await app.close(); await cache.stop(); });
  assert.equal((await app.inject('/api/events')).statusCode, 401); assert.equal(builds, 0);
  assert.equal((await app.inject({ method: 'POST', url: '/auth/logout' })).statusCode, 200);
  await turn(); assert.equal(builds, 0, 'Signed-out logout does not start a cold expensive snapshot build');
  await cache.read(); assert.equal(builds, 1);
  assert.equal((await app.inject({ method: 'POST', url: '/auth/logout' })).statusCode, 200);
  await turn(); assert.equal(builds, 1, 'Logout only refreshes subscriber authentication, never invalidates observations');
  await Promise.all([events.publish(), events.publish(), events.publish()]);
  await turn(); assert.equal(builds, 2);
  const reads = await Promise.all(Array.from({ length: 8 }, () => cache.read()));
  assert.ok(reads.every(value => value.revision === 1)); assert.equal(builds, 2);
  t.mock.timers.tick(45_000); await turn();
  assert.equal(builds, 2, 'SSE heartbeat refreshes must not invalidate the background observations');
  release(); await turn();
  assert.deepEqual(await cache.read(), { revision: 2 }); assert.equal(builds, 2);
  assert.equal(snapshots, 0, 'No authenticated subscriber requested a dashboard projection');
});
