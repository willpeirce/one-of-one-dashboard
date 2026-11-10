import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { appConfig } from '../src/config.js';
import { HQClient, HQReadError, HQ_BODY_LIMIT, HQ_TIMEOUT_MS, hqTargetInfo, type HQRequestLog, type HQTarget } from '../src/github-hq/client.js';

const register: HQTarget = {kind: 'register'};
const token = () => randomBytes(24).toString('hex');
const quiet = {log: () => {}};

test('HQ client builds only its typed month/register paths and sends raw GET headers with stored ETag', async () => {
  const secret = token(), calls: {url: URL; init: RequestInit}[] = [];
  const client = new HQClient(` \n${secret}\r\n\t`, {...quiet, fetch: async (input, init) => {
    calls.push({url: new URL(String(input)), init: init!});
    return new Response('invented markdown', {headers: {etag: '"invented-next"'}});
  }});
  const targets: HQTarget[] = [register, {kind: 'month', month: '2032-04', ref: 'main'}, {kind: 'month', month: '2032-03', ref: 'claude/ads-daily'}];
  for (const target of targets) assert.deepEqual(await client.read(target, {etag: '"invented-previous"'}),
    {status: 'modified', text: 'invented markdown', etag: '"invented-next"'});
  for (const [index, call] of calls.entries()) {
    const expected = hqTargetInfo(targets[index]!);
    assert.equal(call.url.origin, 'https://api.github.com');
    assert.equal(call.url.pathname, `/repos/${appConfig.github.owner}/${appConfig.github.repository}/contents/${expected.path}`);
    assert.equal(call.url.searchParams.get('ref'), expected.ref);
    assert.equal(call.init.method, 'GET'); assert.equal(call.init.redirect, 'error'); assert.equal(call.init.body, undefined);
    const headers = new Headers(call.init.headers);
    assert.equal(headers.get('accept'), 'application/vnd.github.raw+json');
    assert.equal(headers.get('authorization'), `Bearer ${secret}`);
    assert.equal(headers.get('x-github-api-version'), '2022-11-28'); assert.equal(headers.get('if-none-match'), '"invented-previous"');
  }
  const invalid: unknown[] = ['ops/tests/register.md', null, {kind: 'other'}, {kind: 'register', path: '../private'},
    {kind: 'month', month: '../private', ref: 'main'}, {kind: 'month', month: '2032-13', ref: 'main'},
    {kind: 'month', month: '0000-01', ref: 'main'}, {kind: 'month', month: '2032-04', ref: 'other'},
    {kind: 'month', month: '2032-04', ref: 'main', path: 'other'}];
  for (const target of invalid) await assert.rejects(client.read(target as HQTarget), (error: unknown) => error instanceof HQReadError && error.code === 'target');
  assert.equal(calls.length, 3, 'Rejected targets never reach a transport');
});

test('HQ 304 is a success and does not read or parse a body', async () => {
  const client = new HQClient(token(), {...quiet, fetch: async () => new Response(null, {status: 304})});
  assert.deepEqual(await client.read(register, {etag: '"invented"'}), {status: 'not-modified', etag: '"invented"'});
});

test('HQ accepts raw files beyond one MiB and exactly four MiB, then cancels before consuming overflow', async () => {
  for (const length of [1_048_577, HQ_BODY_LIMIT]) {
    const text = 'x'.repeat(length), client = new HQClient(token(), {...quiet, fetch: async () => new Response(text)});
    const result = await client.read(register); assert.equal(result.status, 'modified');
    if (result.status === 'modified') assert.equal(result.text.length, length);
  }
  let reads = 0, cancelled = false, calls = 0;
  const client = new HQClient(token(), {...quiet, fetch: async () => {
    calls++;
    return new Response(new ReadableStream<Uint8Array>({pull(controller) {
      reads++; controller.enqueue(new Uint8Array(1024 * 1024));
    }, cancel() {cancelled = true;}}, {highWaterMark: 0}));
  }});
  await assert.rejects(client.read(register), (error: unknown) => error instanceof HQReadError && error.code === 'too_large');
  assert.equal(reads, 5); assert.equal(cancelled, true); assert.equal(calls, 1, 'Oversize bodies are not retried');
  let pulled = false;
  const declared = new HQClient(token(), {...quiet, fetch: async () => new Response(new ReadableStream({pull() {pulled = true;}}, {highWaterMark: 0}), {headers: {'content-length': String(HQ_BODY_LIMIT + 1)}})});
  await assert.rejects(declared.read(register), (error: unknown) => error instanceof HQReadError && error.code === 'too_large');
  assert.equal(pulled, false);
});

test('HQ retries transient failures three times with backoff and rejects redirect, denial and bad UTF-8 immediately', async () => {
  const waits: number[] = []; let calls = 0;
  const client = new HQClient(token(), {...quiet, sleep: async ms => {waits.push(ms);}, fetch: async () => {
    calls++; return calls < 4 ? new Response(null, {status: 503}) : new Response('invented');
  }});
  await client.read(register); assert.equal(calls, 4); assert.deepEqual(waits, [250, 500, 1000]);
  for (const [status, code] of [[302, 'redirect'], [401, 'denied'], [403, 'denied'], [404, 'not_found']] as const) {
    let attempts = 0;
    const refused = new HQClient(token(), {...quiet, fetch: async () => {attempts++; return new Response(null, {status, headers: {location: 'https://invented.invalid/private'}});}});
    await assert.rejects(refused.read(register), (error: unknown) => error instanceof HQReadError && error.code === code);
    assert.equal(attempts, 1);
  }
  const invalid = new HQClient(token(), {...quiet, fetch: async () => new Response(new Uint8Array([0xff]))});
  await assert.rejects(invalid.read(register), (error: unknown) => error instanceof HQReadError && error.code === 'invalid');
});

test('HQ ten-second timeout bounds both connection and a stalled body, with four attempts', async () => {
  for (const stalledBody of [false, true]) {
    let attempts = 0, cancelled = 0;
    const signals: number[] = [];
    const client = new HQClient(token(), {...quiet, sleep: async () => {}, timeoutSignal: ms => {
      signals.push(ms); const abort = new AbortController(); setTimeout(() => abort.abort(), 5); return abort.signal;
    }, fetch: async () => {
      attempts++;
      if (!stalledBody) return new Promise<Response>(() => {});
      return new Response(new ReadableStream({pull() {}, cancel() {cancelled++;}}, {highWaterMark: 0}));
    }});
    await assert.rejects(client.read(register), (error: unknown) => error instanceof HQReadError && error.code === 'timeout');
    assert.equal(attempts, 4); assert.deepEqual(signals, [HQ_TIMEOUT_MS, HQ_TIMEOUT_MS, HQ_TIMEOUT_MS, HQ_TIMEOUT_MS]);
    if (stalledBody) assert.equal(cancelled, 4);
  }
});

test('HQ retries an interrupted response stream as a transport failure', async () => {
  let attempts = 0; const waits: number[] = [];
  const client = new HQClient(token(), {...quiet, sleep: async ms => {waits.push(ms);}, fetch: async () => {
    if (++attempts > 1) return new Response('Invented recovered body');
    return new Response(new ReadableStream({start(controller) {controller.error(new Error('Invented interrupted stream'));}}));
  }});
  assert.deepEqual(await client.read(register), {status: 'modified', text: 'Invented recovered body', etag: null});
  assert.equal(attempts, 2); assert.deepEqual(waits, [250]);
});

test('HQ honors short rate-limit waits and returns long waits to its scheduler without exposing provider prose', async () => {
  const waits: number[] = []; let attempts = 0;
  const client = new HQClient(token(), {...quiet, sleep: async ms => {waits.push(ms);}, fetch: async () => ++attempts === 1
    ? new Response(null, {status: 429, headers: {'retry-after': '2'}}) : new Response('invented')});
  await client.read(register); assert.deepEqual(waits, [2000]);
  const secondary = new HQClient(token(), {...quiet, fetch: async () => new Response(null, {status: 403, headers: {'x-ratelimit-remaining': '9', 'retry-after': '120'}})});
  await assert.rejects(secondary.read(register), (error: unknown) => error instanceof HQReadError && error.code === 'rate_limit' && error.retryAfterMs === 120_000);
  const long = new HQClient(token(), {...quiet, fetch: async () => new Response(null, {status: 403, headers: {'x-ratelimit-remaining': '0', 'retry-after': '3600'}})});
  await assert.rejects(long.read(register), (error: unknown) => error instanceof HQReadError && error.code === 'rate_limit' && error.retryAfterMs === 3_600_000);
});

test('HQ diagnostics and errors never include the token, response prose or reflected headers', async () => {
  const secret = token(), logs: HQRequestLog[] = [];
  const client = new HQClient(` \n${secret}\r\n`, {sleep: async () => {}, log: entry => logs.push(entry), fetch: async () =>
    new Response(secret, {status: 503, headers: {'x-github-request-id': secret}})});
  await assert.rejects(client.read(register), (error: unknown) => error instanceof HQReadError && !error.message.includes(secret));
  assert.equal(logs.length, 4); assert.ok(!JSON.stringify(logs).includes(secret));
  const failed = new HQClient(secret, {sleep: async () => {}, log: entry => logs.push(entry), fetch: async () => {throw new Error(secret);}});
  await assert.rejects(failed.read(register), (error: unknown) => error instanceof HQReadError && !error.message.includes(secret));
  assert.ok(!JSON.stringify(logs).includes(secret));
});
