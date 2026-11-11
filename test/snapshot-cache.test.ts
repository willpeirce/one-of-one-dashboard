import assert from 'node:assert/strict';
import test from 'node:test';
import { SnapshotCache } from '../src/snapshot-cache.js';

const turn = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

test('two cold opens share one build and subsequent opens inside the minute reuse it', async t => {
  const first = deferred<{ revision: number }>(); let builds = 0, time = 1_000;
  const cache = new SnapshotCache(async () => { builds++; return first.promise; }, { now: () => time });
  t.after(() => cache.stop());
  const left = cache.read(), right = cache.read();
  await turn(); assert.equal(builds, 1);
  first.resolve({ revision: 1 }); assert.deepEqual(await Promise.all([left, right]), [{ revision: 1 }, { revision: 1 }]);
  time += 59_999;
  for (let index = 0; index < 4; index++) assert.deepEqual(await cache.read(), { revision: 1 });
  assert.equal(builds, 1);
});

test('warm expired opens serve the last good value immediately and share one background refresh', async t => {
  const next = deferred<{ revision: number }>(); let builds = 0, time = 1_000;
  const cache = new SnapshotCache(async () => ++builds === 1 ? { revision: 1 } : next.promise, { now: () => time });
  t.after(() => cache.stop());
  await cache.read(); time += 60_001;
  const opened = await Promise.all(Array.from({ length: 8 }, () => cache.read()));
  assert.ok(opened.every(value => value.revision === 1));
  await turn(); assert.equal(builds, 2);
  next.resolve({ revision: 2 }); await turn();
  assert.deepEqual(await cache.read(), { revision: 2 }); assert.equal(builds, 2, 'Waiting requests never schedule redundant follow-up builds');
});

test('simultaneous invalidations coalesce and a publish during a build requests one follow-up without overlap', async t => {
  const gates = [deferred<number>(), deferred<number>()]; let builds = 0, active = 0, maximum = 0;
  const cache = new SnapshotCache(async () => {
    const build = ++builds; active++; maximum = Math.max(maximum, active);
    try { return await gates[build - 1]!.promise; } finally { active--; }
  });
  t.after(() => cache.stop());
  const early = [cache.invalidate(), cache.invalidate(), cache.invalidate()];
  await turn(); assert.equal(builds, 1);
  const during = [cache.invalidate(), cache.invalidate(), cache.invalidate()];
  await turn(); assert.equal(builds, 1, 'Invalidation does not overlap the build in progress');
  gates[0]!.resolve(1); await turn(); assert.equal(builds, 2);
  gates[1]!.resolve(2); await Promise.all([...early, ...during]);
  assert.equal(maximum, 1); assert.equal(builds, 2); assert.equal(await cache.read(), 2);
});

test('failed rebuilds keep the last good snapshot, log without error values, and can recover', async t => {
  const logs: string[] = []; let builds = 0, failing = false;
  const cache = new SnapshotCache(async () => {
    builds++;
    if (failing) throw new Error('invented-private-provider-value');
    return { revision: builds };
  }, { log: line => logs.push(line) });
  t.after(() => cache.stop());
  assert.deepEqual(await cache.read(), { revision: 1 }); failing = true;
  await assert.doesNotReject(cache.invalidate());
  assert.deepEqual(await cache.read(), { revision: 1 });
  assert.equal(logs.length, 1); assert.doesNotMatch(logs[0]!, /invented-private-provider-value/);
  failing = false; await cache.invalidate(); assert.deepEqual(await cache.read(), { revision: builds });
  assert.ok(builds >= 3);
});

test('a cold failed read has no snapshot to serve, while background invalidation failure remains non-fatal', async t => {
  const logs: string[] = []; let failing = true;
  const cache = new SnapshotCache(async () => {
    if (failing) throw new Error('invented-private-build-error');
    return 7;
  }, { log: line => logs.push(line) });
  t.after(() => cache.stop());
  await assert.rejects(cache.read());
  await assert.doesNotReject(cache.invalidate());
  assert.ok(logs.length > 0); assert.ok(logs.every(line => !line.includes('invented-private-build-error')));
  failing = false; await cache.invalidate(); assert.equal(await cache.read(), 7);
});

test('explicit post-listen start warms once, refreshes each minute and stops its timer', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let builds = 0, time = 1_000;
  const cache = new SnapshotCache(async () => ++builds, { now: () => time });
  t.after(() => cache.stop());
  await turn(); assert.equal(builds, 0, 'Constructing a cache does not begin pre-listen work');
  cache.start(); cache.start(); await turn(); assert.equal(builds, 1);
  time += 59_999; t.mock.timers.tick(59_999); await turn(); assert.equal(builds, 1);
  time++; t.mock.timers.tick(1); await turn(); assert.equal(builds, 2);
  await cache.stop(); t.mock.timers.tick(120_000); await turn(); assert.equal(builds, 2);
});

test('a delayed first build refreshes around one minute after completion and a recent publish resets that age', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const first = deferred<number>(); let builds = 0, time = 0;
  const cache = new SnapshotCache(async () => ++builds === 1 ? first.promise : builds, { now: () => time });
  t.after(() => cache.stop());
  cache.start(); await turn(); assert.equal(builds, 1);
  time = 10_000; t.mock.timers.tick(10_000); first.resolve(1); await turn();
  time = 65_000; t.mock.timers.tick(55_000); await turn(); assert.equal(builds, 1);
  time = 70_000; t.mock.timers.tick(5_000); await turn();
  assert.equal(builds, 2, 'A slow first build must not wait until the next two-minute boundary');
  time = 125_000; t.mock.timers.tick(55_000); await turn(); assert.equal(builds, 2);
  await cache.invalidate(); assert.equal(builds, 3);
  time = 130_000; t.mock.timers.tick(5_000); await turn();
  assert.equal(builds, 3, 'A recent publish already refreshed the snapshot; the former age boundary is no longer due');
  time = 185_000; t.mock.timers.tick(55_000); await turn(); assert.equal(builds, 4);
});

test('stop waits for the single running refresh without throwing on its failure', async () => {
  const gate = deferred<number>(), logs: string[] = [];
  const cache = new SnapshotCache(() => gate.promise, { log: line => logs.push(line) });
  cache.start(); await turn();
  let stopped = false; const closing = cache.stop().then(() => { stopped = true; });
  await turn(); assert.equal(stopped, false);
  gate.reject(new Error('invented-private-shutdown-error')); await closing;
  assert.equal(stopped, true); assert.equal(logs.length, 1); assert.doesNotMatch(logs[0]!, /invented-private-shutdown-error/);
});

test('failed notifications or diagnostics cannot discard a built snapshot or escape a background refresh', async t => {
  let builds = 0, failing = false;
  const cache = new SnapshotCache(async () => {
    if (failing) throw new Error('invented-private-build-detail');
    return ++builds;
  }, { onBuilt: async () => { throw new Error('invented-private-notification-detail'); },
    log: () => { throw new Error('invented-private-log-detail'); } });
  t.after(() => cache.stop());
  assert.equal(await cache.read(), 1);
  failing = true; await assert.doesNotReject(cache.invalidate());
  assert.equal(await cache.read(), 1);
});
