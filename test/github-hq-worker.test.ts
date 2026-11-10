import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { HQWorker, HQ_HOURLY_MS, HQ_MORNING_MS, hqMonthInterval } from '../src/github-hq/worker.js';
import { readHQFacts } from '../src/github-hq/store.js';
import { readSourceHealth, syncSourceHealth } from '../src/sources.js';
import { createTestDatabase } from './helpers/database.js';

const month = (day: string, run = 'run 1 May 07:41') => `# Invented checks\n## ${day} (Fri), ${run}\n\n**Needs Will:** nothing.\n\n### Ignored\nDo not persist this free section.`;
const register = (bad = false) => `# Invented register\n## Live\n| Id | Lane | Question | Arms | Metric and bar | Started | Ends | Where measured | Status |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n| T1 Invented test | Site | Invented question | A vs B | Invented bar | 2032-03-02 | Later | Invented source | Waiting |\n${bad ? '| T2 Invented bad row | missing cells |\n' : ''}\n## History\n| Id | Question | Verdict | Rule | Evidence |\n| --- | --- | --- | --- | --- |\n| T3 Invented past | Invented question | Draw | Invented rule | Invented evidence |`;
const health = async (db: Awaited<ReturnType<typeof createTestDatabase>>) => (await readSourceHealth(db)).find(row => row.source === 'github-hq')!;
const secret = () => randomBytes(24).toString('hex');
const quiet = {log: () => {}, sleep: async () => {}};

test('HQ scheduling uses UK morning boundaries in summer and winter and slows once yesterday is found', () => {
  for (const [before, start, end] of [
    ['2032-06-10T06:29:00Z', '2032-06-10T06:30:00Z', '2032-06-10T08:30:00Z'],
    ['2032-12-10T07:29:00Z', '2032-12-10T07:30:00Z', '2032-12-10T09:30:00Z'],
  ]) {
    assert.equal(hqMonthInterval(new Date(before!), false), HQ_HOURLY_MS);
    assert.equal(hqMonthInterval(new Date(start!), false), HQ_MORNING_MS);
    assert.equal(hqMonthInterval(new Date(end!), false), HQ_HOURLY_MS);
    assert.equal(hqMonthInterval(new Date(start!), true), HQ_HOURLY_MS);
  }
});

test('HQ sample mode makes no calls or storage reads, and construction never starts the worker', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const noReads = {...db, query: async () => {throw new Error('No reads in sample mode');}};
  let calls = 0;
  const sample = new HQWorker(noReads, {}, {...quiet, fetch: async () => {calls++; throw new Error('No source read');}});
  sample.start(); await sample.tick(); await sample.stop(); assert.equal(sample.mode, 'sample'); assert.equal(calls, 0);
  const live = new HQWorker(db, {GITHUB_HQ_TOKEN: secret()}, {...quiet, fetch: async () => {calls++; throw new Error('No constructor read');}});
  assert.equal(live.mode, 'live'); assert.equal(calls, 0); await live.stop();
});

test('HQ configured-key whitespace is normalized before either file reaches its transport', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const key = secret(), env = {GITHUB_HQ_TOKEN: ` \n${key}\r\n\t`}; await syncSourceHealth(db, env);
  let calls = 0;
  const worker = new HQWorker(db, env, {...quiet, clock: () => new Date('2032-05-01T08:00:00Z'), fetch: async (input, init) => {
    calls++; assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${key}`);
    return new Response(new URL(String(input)).pathname.endsWith('/register.md') ? register() : month('2032-04-30'));
  }}); t.after(() => worker.stop());
  assert.equal(worker.mode, 'live'); await worker.tick(); assert.equal(calls, 2); assert.equal((await health(db)).status, 'healthy');
});

test('HQ month-turn reads yesterday’s month, falls back only when absent, then switches to hourly and main reruns', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const env = {GITHUB_HQ_TOKEN: secret()}; await syncSourceHealth(db, env);
  let now = new Date('2032-05-01T06:30:00Z'), branchReady = false, mainReady = false;
  const calls: string[] = [];
  const worker = new HQWorker(db, env, {...quiet, clock: () => now, fetch: async input => {
    const url = new URL(String(input)); calls.push(`${url.pathname}?${url.searchParams.get('ref')}`);
    if (url.pathname.endsWith('/register.md')) return new Response(register(), {headers: {etag: '"register"'}});
    assert.ok(url.pathname.endsWith('/ops/ads-daily/2032-04.md'));
    if (url.searchParams.get('ref') === 'main') return new Response(mainReady ? month('2032-04-30', 're-run 1 May 09:50') : '# Invented month with no entry yet', {headers: {etag: mainReady ? '"main-ready"' : '"main-empty"'}});
    return branchReady ? new Response(month('2032-04-30'), {headers: {etag: '"branch"'}}) : new Response(null, {status: 404});
  }}); t.after(() => worker.stop());
  await worker.tick(); assert.equal(calls.length, 3); assert.equal((await health(db)).status, 'healthy');
  assert.equal((await readHQFacts(db, now, 'live')).report, null);
  now = new Date('2032-05-01T06:39:00Z'); await worker.tick(); assert.equal(calls.length, 3);
  now = new Date('2032-05-01T06:40:00Z'); await worker.tick(); assert.equal(calls.length, 5);
  branchReady = true; now = new Date('2032-05-01T06:50:00Z'); await worker.tick(); assert.equal(calls.length, 7);
  assert.equal((await readHQFacts(db, now, 'live')).report!.ref, 'claude/ads-daily');
  now = new Date('2032-05-01T07:00:00Z'); await worker.tick(); assert.equal(calls.length, 7, 'Finding yesterday slows month polling during the morning window');
  mainReady = true; now = new Date('2032-05-01T07:50:00Z'); await worker.tick();
  assert.equal(calls.length, 9, 'Main with yesterday skips the branch; the register remains hourly');
  const facts = await readHQFacts(db, now, 'live'); assert.equal(facts.report!.ref, 'main'); assert.match(facts.report!.runLabel, /re-run/);
});

test('HQ 304 reuses stored summaries, restores health on restart, and a confirmed missing main uses the branch', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const env = {GITHUB_HQ_TOKEN: secret()}; await syncSourceHealth(db, env);
  let now = new Date('2032-05-01T08:00:00Z'), phase = 0, calls = 0;
  const options = {...quiet, clock: () => now, fetch: (async (input, init) => {
    calls++; const url = new URL(String(input)), headers = new Headers(init?.headers);
    if (phase === 1) {
      assert.equal(headers.get('if-none-match'), url.pathname.endsWith('/register.md') ? '"register"' : '"main"');
      return new Response(null, {status: 304});
    }
    if (url.pathname.endsWith('/register.md')) return new Response(register(), {headers: {etag: '"register"'}});
    if (phase === 2 && url.searchParams.get('ref') === 'main') return new Response(null, {status: 404});
    return new Response(month('2032-04-30', phase === 2 ? 're-run 1 May 11:41' : 'run 1 May 07:41'), {headers: {etag: '"main"'}});
  }) as typeof fetch};
  const worker = new HQWorker(db, env, options); t.after(() => worker.stop());
  await worker.tick(); assert.equal(calls, 2);
  phase = 1; now = new Date('2032-05-01T09:00:00Z'); await worker.tick();
  assert.equal(calls, 4); const cached = await readHQFacts(db, now, 'live'); assert.equal(cached.report!.readAt, now.toISOString()); assert.equal(cached.registerReadOk, true);
  await syncSourceHealth(db, env); assert.equal((await health(db)).status, 'not_implemented');
  const restarted = new HQWorker(db, env, options); t.after(() => restarted.stop());
  await restarted.tick(); assert.equal(calls, 4); assert.equal((await health(db)).status, 'healthy');
  phase = 2; now = new Date('2032-05-01T10:00:00Z'); await worker.tick();
  const branch = (await readHQFacts(db, now, 'live')).report!;
  assert.equal(branch.ref, 'claude/ads-daily'); assert.match(branch.runLabel, /re-run/); assert.equal((await health(db)).status, 'healthy');
});

test('HQ worker shares in-flight reads, contains failures, retains unreadable register cache and keeps partial reads healthy', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const env = {GITHUB_HQ_TOKEN: secret()}; await syncSourceHealth(db, env);
  let now = new Date('2032-05-01T08:00:00Z'), phase = 0, calls = 0, release: () => void = () => {};
  const gate = new Promise<void>(resolve => {release = resolve;});
  const worker = new HQWorker(db, env, {...quiet, clock: () => now, fetch: async input => {
    calls++; if (phase === 0) await gate;
    const isRegister = new URL(String(input)).pathname.endsWith('/register.md');
    if (phase === 1 && isRegister) return new Response('Invented unreadable file');
    if (phase === 2 && isRegister) return new Response(null, {status: 304});
    if (phase === 4 && !isRegister) throw new Error('Invented transport failure');
    return new Response(isRegister ? register(phase === 3) : month('2032-04-30'), {headers: {etag: '"invented"'}});
  }}); t.after(() => worker.stop());
  const first = worker.tick(), concurrent = worker.tick(); assert.equal(first, concurrent); release(); await first;
  assert.equal(calls, 2); const initial = await readHQFacts(db, now, 'live'); assert.equal(initial.tests.length, 2);
  phase = 1; now = new Date('2032-05-01T09:00:00Z'); await worker.tick();
  assert.deepEqual((await readHQFacts(db, now, 'live')).tests, initial.tests); assert.equal((await health(db)).status, 'error');
  phase = 2; now = new Date('2032-05-01T10:00:00Z'); await worker.tick(); assert.equal((await health(db)).status, 'error');
  assert.equal((await readHQFacts(db, now, 'live')).registerReadOk, false, '304 of unreadable content remains unreadable');
  phase = 3; now = new Date('2032-05-01T11:00:00Z'); await worker.tick();
  assert.equal((await health(db)).status, 'healthy'); const partial = await readHQFacts(db, now, 'live');
  assert.equal(partial.registerSkippedRows, 1); assert.equal(partial.registerReadOk, false);
  phase = 4; now = new Date('2032-05-01T12:00:00Z'); const before = calls; await worker.tick();
  assert.equal(calls - before, 5, 'Four month attempts do not prevent the independent register read');
  assert.equal((await health(db)).status, 'error'); assert.equal((await readHQFacts(db, now, 'live')).registerReadOk, true);
  await worker.stop(); await worker.tick(); assert.equal(calls - before, 5, 'Stopped workers never restart');
});

test('HQ rate limits pause both files across worker restarts and a report-month change', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const env = {GITHUB_HQ_TOKEN: secret()}; await syncSourceHealth(db, env);
  let now = new Date('2032-05-01T08:00:00Z'), calls = 0;
  const options = {...quiet, clock: () => now, fetch: (async input => {
    if (++calls === 1) return new Response(null, {status: 429, headers: {'retry-after': '172800'}});
    return new Response(new URL(String(input)).pathname.endsWith('/register.md') ? register() : month('2032-05-02'));
  }) as typeof fetch};
  const worker = new HQWorker(db, env, options); t.after(() => worker.stop());
  await worker.tick(); assert.equal(calls, 1, 'The register shares the token’s rate-limit pause');
  now = new Date('2032-05-02T08:00:00Z');
  const restarted = new HQWorker(db, env, options); t.after(() => restarted.stop());
  await syncSourceHealth(db, env); await restarted.tick(); assert.equal(calls, 1); assert.equal((await health(db)).status, 'error');
  now = new Date('2032-05-03T08:00:00Z'); await restarted.tick();
  assert.equal(calls, 3); assert.equal((await health(db)).status, 'healthy');
});
