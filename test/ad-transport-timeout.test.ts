import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { MetaSpend } from '../src/ad-spend/clients.js';
import { AdTransport, adRequestLogLine, type AdRequestLogEntry } from '../src/ad-spend/http.js';
import { AdError } from '../src/ad-spend/model.js';
import { defaultSettings } from '../src/settings.js';

// All identifiers, pages and provider responses in these tests are invented.
const response = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const collect = async (pages: AsyncIterable<any[]>): Promise<any[]> => {
  const rows: any[] = [];
  for await (const page of pages) rows.push(...page);
  return rows;
};
const noWait = async () => {};

test('transport injects one timeout signal per attempt, with ten seconds by default and a per-request override', async () => {
  const timeouts: number[] = [], signals: AbortSignal[] = [];
  const transport = new AdTransport('meta', {
    sleep: noWait,
    timeoutSignal: timeoutMs => {
      timeouts.push(timeoutMs);
      const signal = new AbortController().signal;
      signals.push(signal); return signal;
    },
    fetch: async (_url, init) => {
      assert.equal(init?.signal, signals.at(-1));
      assert.equal(init?.redirect, 'error');
      return response({ data: [] });
    },
  });
  await transport.request('https://example.test/invented', { method: 'GET' });
  await transport.request('https://example.test/invented', { method: 'GET' }, 60_000);
  assert.deepEqual(timeouts, [10_000, 60_000]);
});

test('Meta spend and campaign reads retain ten-second requests', async () => {
  const timeouts: number[] = [], paths: string[] = [];
  const client = new MetaSpend(randomBytes(16).toString('hex'), {
    sleep: noWait,
    timeoutSignal: ms => { timeouts.push(ms); return new AbortController().signal; },
    fetch: async (input, init) => {
      const url = new URL(String(input)); paths.push(url.pathname);
      assert.equal(init?.method, 'GET');
      return response(url.searchParams.get('fields') === 'currency,timezone_name'
        ? { currency: 'GBP', timezone_name: 'Europe/London' } : { data: [] });
    },
  });
  await client.read('9000000000', '2026-10-13', '2026-10-13', defaultSettings());
  await client.readCampaigns('9000000000');
  assert.deepEqual(timeouts, [10_000, 10_000, 10_000]);
  assert.deepEqual(paths.map(path => path.split('/').at(-1)), ['act_9000000000', 'insights', 'campaigns']);
});

test('two aborted list attempts log their exact safe timeout lines and retry the same page successfully', async () => {
  const token = randomBytes(16).toString('hex'), logs: AdRequestLogEntry[] = [], requests: URL[] = [], timeouts: number[] = [];
  const client = new MetaSpend(token, {
    sleep: noWait, log: entry => logs.push(entry),
    timeoutSignal: ms => { timeouts.push(ms); return new AbortController().signal; },
    fetch: async (input, init) => {
      const url = new URL(String(input)); requests.push(url);
      assert.equal(init?.method, 'GET');
      assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${token}`);
      if (requests.length < 3) throw new Error(`https://private.example.test/${token}`);
      return response({ data: [{ id: '900000000001' }] }, 200, { 'x-fb-trace-id': token });
    },
  });
  const rows = await collect(client.readPages('act_9000000000/ads', { fields: 'id', limit: '25' }, 60_000, { fallbackLimit: 10 }));
  assert.deepEqual(rows, [{ id: '900000000001' }]);
  assert.deepEqual(timeouts, [60_000, 60_000, 60_000]);
  assert.ok(requests.every(url => url.searchParams.get('limit') === '25' && !url.searchParams.has('after')));
  assert.deepEqual(logs.map(adRequestLogLine), [
    'Ad spend meta request timed out after 60 s (attempt 1 of 4).',
    'Ad spend meta request timed out after 60 s (attempt 2 of 4).',
    'Ad spend meta request 200 (no request id).',
  ]);
  assert.ok(!JSON.stringify(logs).includes(token));
  assert.ok(!logs.map(adRequestLogLine).join('\n').includes('https://'));
});

test('an exhausted timeout or 5xx retries the failed cursor at ten and keeps all later pages at ten', async t => {
  for (const failure of ['timeout', '500'] as const) await t.test(failure, async () => {
    const requests: URL[] = [], logs: AdRequestLogEntry[] = [];
    const client = new MetaSpend(randomBytes(16).toString('hex'), {
      sleep: noWait, log: entry => logs.push(entry), timeoutSignal: () => new AbortController().signal,
      fetch: async input => {
        const url = new URL(String(input)); requests.push(url);
        const cursor = url.searchParams.get('after'), limit = url.searchParams.get('limit');
        if (cursor === 'invented-next' && limit === '25') {
          if (failure === 'timeout') throw new Error('invented-network-failure');
          return response({ error: { code: 1, error_subcode: 99, message: 'invented-private-response' } }, 500,
            { 'x-fb-trace-id': 'invented-request-id' });
        }
        return response(!cursor
          ? { data: ['page-one'], paging: { next: 'https://untrusted.example.test/ignore', cursors: { after: 'invented-next' } } }
          : cursor === 'invented-next'
            ? { data: ['page-two'], paging: { next: 'https://untrusted.example.test/ignore', cursors: { after: 'invented-last' } } }
            : { data: ['page-three'] });
      },
    });
    assert.deepEqual(await collect(client.readPages('act_9000000000/ads', {
      fields: 'invented,nested{fields}', effective_status: '["ACTIVE"]', limit: '25',
    }, 60_000, { fallbackLimit: 10 })), ['page-one', 'page-two', 'page-three']);
    assert.deepEqual(requests.map(url => [url.searchParams.get('after'), url.searchParams.get('limit')]), [
      [null, '25'], ['invented-next', '25'], ['invented-next', '25'], ['invented-next', '25'], ['invented-next', '25'],
      ['invented-next', '10'], ['invented-last', '10'],
    ]);
    assert.ok(requests.every(url => url.origin === 'https://graph.facebook.com'
      && url.pathname === '/v25.0/act_9000000000/ads'
      && url.searchParams.get('fields') === 'invented,nested{fields}' && url.searchParams.get('effective_status') === '["ACTIVE"]'));
    if (failure === '500') assert.deepEqual(logs.filter(entry => entry.status === 500).map(adRequestLogLine),
      Array(4).fill('Ad spend meta request 500 (invented-request-id), meta 1/99.'));
  });
});

test('a failed smaller page ends after its own four attempts without another fallback', async () => {
  const limits: string[] = [];
  const client = new MetaSpend(randomBytes(16).toString('hex'), {
    sleep: noWait, timeoutSignal: () => new AbortController().signal,
    fetch: async input => {
      limits.push(new URL(String(input)).searchParams.get('limit')!);
      return response({ error: { code: 2 } }, 503);
    },
  });
  await assert.rejects(collect(client.readPages('act_9000000000/ads', { limit: '25' }, 60_000, { fallbackLimit: 10 })),
    error => error instanceof AdError && error.status === 503);
  assert.deepEqual(limits, ['25', '25', '25', '25', '10', '10', '10', '10']);
});

test('permission, validation, rate-limit and malformed responses never activate the optional small-page fallback', async t => {
  for (const [name, makeResponse, attempts] of [
    ['unauthorized', () => response({ error: { code: 190 } }, 403), 1],
    ['invalid request', () => response({ error: { code: 100 } }, 400), 1],
    ['rate limit', () => response({ error: { code: 17 } }, 429), 4],
    ['malformed data', () => response({ data: null }), 1],
    ['malformed JSON', () => new Response('invented malformed JSON', { status: 200 }), 4],
  ] as const) await t.test(name, async () => {
    const limits: string[] = [];
    const client = new MetaSpend(randomBytes(16).toString('hex'), {
      sleep: noWait, timeoutSignal: () => new AbortController().signal,
      fetch: async input => { limits.push(new URL(String(input)).searchParams.get('limit')!); return makeResponse(); },
    });
    await assert.rejects(collect(client.readPages('act_9000000000/ads', { limit: '25' }, 60_000, { fallbackLimit: 10 })), AdError);
    assert.deepEqual(limits, Array(attempts).fill('25'));
  });
});

test('paging yields each page before fetching the next, and aggregation retains cursor loop protection', async () => {
  let reads = 0;
  const client = new MetaSpend(randomBytes(16).toString('hex'), { sleep: noWait,
    fetch: async () => response(++reads === 1
      ? { data: ['one'], paging: { next: 'ignored', cursors: { after: 'invented-next' } } }
      : { data: ['two'] }),
  });
  const pages = client.readPages('invented-edge');
  assert.equal(reads, 0);
  assert.deepEqual((await pages.next()).value, ['one']);
  assert.equal(reads, 1);
  assert.deepEqual((await pages.next()).value, ['two']);
  assert.equal((await pages.next()).done, true);
  reads = 0;
  assert.deepEqual(await client.readAllPages('invented-edge'), ['one', 'two']);
  const loop = new MetaSpend(randomBytes(16).toString('hex'), { sleep: noWait,
    fetch: async () => response({ data: [], paging: { next: 'ignored', cursors: { after: 'same-cursor' } } }),
  });
  await assert.rejects(loop.readAllPages('invented-edge'), AdError);
});

test('provider log details accept only numeric codes and scrub a trace ID carrying the Meta token', async () => {
  const token = randomBytes(16).toString('hex'), logs: AdRequestLogEntry[] = [];
  const client = new MetaSpend(token, { sleep: noWait, log: entry => logs.push(entry),
    fetch: async () => response({ error: { code: token, error_subcode: 'invented-private-subcode', message: token } }, 400,
      { 'x-fb-trace-id': `invented-${token}` }),
  });
  await assert.rejects(client.readGraph('invented-edge'), error => error instanceof AdError
    && !error.message.includes(token) && !JSON.stringify(error).includes(token));
  assert.deepEqual(logs, [{ source: 'meta', requestId: null, status: 400 }]);
  assert.equal(adRequestLogLine(logs[0]!), 'Ad spend meta request 400 (no request id).');
  const successful: AdRequestLogEntry[] = [];
  await new AdTransport('tiktok', { sleep: noWait, log: entry => successful.push(entry), fetch: async () => response({ code: 0 }) })
    .request('https://example.test/invented');
  assert.deepEqual(successful, [{ source: 'tiktok', requestId: null, status: 200 }]);
});

test('an aborted response body retains the received HTTP status and still fails as a timeout', async () => {
  const logs: AdRequestLogEntry[] = [];
  const transport = new AdTransport('meta', { sleep: noWait, log: entry => logs.push(entry),
    timeoutSignal: () => AbortSignal.abort(),
    fetch: async () => {
      const received = response({});
      received.json = async () => { throw new Error('invented aborted body'); };
      return received;
    },
  });
  await assert.rejects(transport.request('https://example.test/invented', {}, 60_000),
    error => error instanceof AdError && error.code === 'timeout');
  assert.equal(logs.length, 4);
  assert.ok(logs.every(entry => entry.status === 200 && entry.timeoutMs === undefined));
});
