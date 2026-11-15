import assert from 'node:assert/strict';
import test from 'node:test';
import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {GorgiasClient, GorgiasReadError, gorgiasCredentials, type GorgiasClientOptions, type GorgiasRequestLog} from '../src/gorgias/client.js';
import {gorgiasWeekStart, type GorgiasPollInput} from '../src/gorgias/model.js';
import {normalizedGorgiasDate, parseGorgiasTicket, scrubGorgiasText} from '../src/gorgias/privacy.js';

// All identities, dates, names, addresses and figures in these fixtures are invented.
const fixture = JSON.parse(await readFile(new URL('./fixtures/gorgias/tickets.json', import.meta.url), 'utf8')) as {data: any[]};
const at = new Date('2032-04-07T12:00:00Z');
const domain = `invented-${randomBytes(6).toString('hex')}`, email = `reader-${randomBytes(6).toString('hex')}@example.invalid`;
const input = (extra: Partial<GorgiasPollInput> = {}): GorgiasPollInput => ({viewId: '', tag: 'ai_handover', knownTickets: [], weekStart: gorgiasWeekStart(at), asOf: at.toISOString(), ...extra});
const page = (data: unknown[], next: string | null = null) => ({data, object: 'list', meta: {next_cursor: next, prev_cursor: null}, uri: '/api/tickets'});
const raw = (id: number, extra: Record<string, unknown> = {}) => ({...structuredClone(fixture.data[0]), id, updated_datetime: '2032-04-07T10:00:00Z', ...extra});
function harness(fetcher: typeof fetch, extra: GorgiasClientOptions = {}) {
  const key = randomBytes(24).toString('hex'), logs: GorgiasRequestLog[] = [], sleeps: number[] = [];
  let now = at.getTime();
  const client = new GorgiasClient({domain: ' invented-helpdesk ', email: ' invented-reader@example.invalid ', key: ` ${key} `}, {
    fetch: fetcher, now: () => now, sleep: async ms => {sleeps.push(ms); now += ms;}, log: entry => logs.push(entry), ...extra});
  return {client, key, logs, sleeps, now: () => now, advance: (ms: number) => {now += ms;}};
}

test('Gorgias has only fixed GET reads, trims credentials and returns the permitted safe ticket fields', async () => {
  const calls: URL[] = [];
  const h = harness(async (url, init) => {
    const target = new URL(String(url)); calls.push(target);
    assert.equal(target.origin, 'https://invented-helpdesk.gorgias.com');
    assert.equal(init?.method, 'GET'); assert.equal(init.redirect, 'error'); assert.equal(init.body, undefined);
    assert.ok(init.signal instanceof AbortSignal);
    const authorization = (init.headers as Record<string, string>).Authorization!;
    assert.equal(Buffer.from(authorization.slice(6), 'base64').toString(), `invented-reader@example.invalid:${h.key}`);
    return Response.json(page(fixture.data), {headers: {'x-request-id': 'invented-request'}});
  });
  const result = await h.client.readHandover(input());
  assert.equal(result.tickets.length, 4); assert.equal(result.closedThisWeek, 0); assert.equal(calls.length, 1);
  assert.equal(calls[0]!.searchParams.get('trashed'), 'false'); assert.equal(calls[0]!.searchParams.get('order_by'), 'updated_datetime:desc');
  assert.equal(calls[0]!.searchParams.has('status'), false); assert.equal(calls[0]!.searchParams.has('tag'), false);
  assert.deepEqual(Object.keys(result.tickets[0]!).sort(), ['id','status','channel','tags','inHandover','viewId','createdAt','updatedAt','lastCustomerMessageAt','customer','subject'].sort());
  assert.equal(result.tickets[0]!.customer, 'Edda M.');
  assert.doesNotMatch(JSON.stringify(result), /Mallow|@|body_text|body_html|private body|integrations|closed_datetime/);
  assert.equal(h.logs[0]!.requestId, 'invented-request'); assert.ok(!JSON.stringify(h.logs).includes(h.key));
  assert.deepEqual(Object.getOwnPropertyNames(GorgiasClient.prototype).sort(), ['constructor', 'readHandover', 'probeTickets', 'probeViews'].sort());
  assert.deepEqual(gorgiasCredentials({GORGIAS_DOMAIN: ` ${domain.toUpperCase()} `, GORGIAS_EMAIL: ` ${email} `, GORGIAS_API_KEY: ` ${h.key} `}),
    {domain, email, key: h.key});
  for (const missing of ['GORGIAS_DOMAIN','GORGIAS_EMAIL','GORGIAS_API_KEY'])
    assert.equal(gorgiasCredentials({...{GORGIAS_DOMAIN: domain, GORGIAS_EMAIL: email, GORGIAS_API_KEY: h.key}, [missing]: '  '}), null);
});

test('tag mode paginates to the end, app-filters exact tags and counts closed tagged tickets without retaining closure times', async () => {
  const calls: URL[] = [];
  const h = harness(async url => {
    const target = new URL(String(url)); calls.push(target);
    return Response.json(!target.searchParams.has('cursor') ? page([raw(81011), raw(81012, {tags: [{name: 'another_tag'}]})], 'invented-next')
      : page([raw(81013, {status: 'closed', closed_datetime: '2032-04-06T08:00:00Z'}), raw(81011)]));
  });
  const result = await h.client.readHandover(input());
  assert.deepEqual(result.tickets.map(row => row.id).sort(), ['81011','81013']);
  assert.equal(result.tickets.find(row => row.id === '81013')!.inHandover, false);
  assert.equal(result.closedThisWeek, 1); assert.equal(calls.length, 2);
  assert.equal(calls[1]!.searchParams.get('cursor'), 'invented-next');
  assert.doesNotMatch(JSON.stringify(result), /closed_datetime|closedAt|another_tag/);
});

test('view mode confirms missing members, includes known former-member closures and stops the recent scan at the UK week boundary', async () => {
  const calls: string[] = [];
  const h = harness(async url => {
    const target = new URL(String(url)); calls.push(target.pathname + target.search);
    if (target.searchParams.has('view_id')) return Response.json(page([raw(81021)]));
    if (target.pathname === '/api/tickets/81024') return Response.json(raw(81024, {updated_datetime: '2032-04-01T08:00:00Z'}));
    return Response.json(page([
      raw(81022, {status: 'closed', closed_datetime: '2032-04-06T10:00:00Z'}),
      raw(81023, {status: 'closed', closed_datetime: '2032-04-06T11:00:00Z'}),
      raw(81025, {status: 'closed', closed_datetime: '2032-04-06T12:00:00Z'}),
      raw(81026, {updated_datetime: '2032-04-01T08:00:00Z'}),
    ], 'older-page-not-needed'));
  });
  const result = await h.client.readHandover(input({viewId: '85001', knownTickets: [
    {id: '81022', status: 'open', inHandover: true}, {id: '81023', status: 'open', inHandover: false},
    {id: '81024', status: 'open', inHandover: true}, {id: '81027', status: 'closed', inHandover: false},
  ]}));
  assert.equal(result.closedThisWeek, 2);
  assert.deepEqual(result.tickets.map(row => row.id).sort(), ['81021','81022','81023','81024']);
  assert.deepEqual(result.tickets.filter(row => row.inHandover).map(row => row.id), ['81021']);
  assert.ok(result.tickets.every(row => row.viewId === '85001')); assert.equal(calls.length, 3);
  assert.ok(calls[0]!.includes('view_id=85001')); assert.ok(calls.at(-1)!.startsWith('/api/tickets/81024'));
  assert.ok(!calls.some(call => call.includes('older-page-not-needed') || call.includes('/81027')));
});

test('a missing former ticket leaves without inventing a closure; any other detail failure rejects the whole poll', async () => {
  for (const status of [404, 503]) {
    const h = harness(async url => new URL(String(url)).pathname.endsWith('/81031') ? new Response('', {status}) : Response.json(page([])));
    const request = h.client.readHandover(input({viewId: '85001', knownTickets: [{id: '81031', status: 'open', inHandover: true}]}));
    if (status === 404) assert.deepEqual(await request, {tickets: [], closedThisWeek: 0});
    else await assert.rejects(request, (error: unknown) => error instanceof GorgiasReadError && error.code === 'http' && error.status === 503);
  }
});

test('repeated cursors, missing pagination metadata and malformed rows never produce a partial success', async () => {
  for (const response of [page([raw(81041)], 'repeated-cursor'), {data: [raw(81041)]}, page([raw(81041, {created_datetime: 'invalid'})])]) {
    let calls = 0;
    const h = harness(async () => {calls++; return Response.json(response);});
    await assert.rejects(h.client.readHandover(input()), GorgiasReadError);
    assert.ok(calls <= 2);
  }
});

test('Gorgias retries three times, honours Retry-After, and preserves a long deferral for the worker', async () => {
  let calls = 0;
  const retry = harness(async () => ++calls < 4 ? new Response('', {status: 503}) : Response.json(page([])));
  await retry.client.readHandover(input()); assert.equal(calls, 4);
  assert.deepEqual(retry.sleeps, [1000,2000,4000]);
  calls = 0;
  const rate = harness(async () => ++calls === 1 ? new Response('', {status: 429, headers: {'Retry-After': '8'}}) : Response.json(page([])));
  await rate.client.readHandover(input()); assert.equal(calls, 2); assert.deepEqual(rate.sleeps, [8000]);
  calls = 0;
  const long = harness(async () => {calls++; return new Response('', {status: 429, headers: {'Retry-After': '3600'}});});
  for (let read = 0; read < 2; read++) await assert.rejects(long.client.readHandover(input()), (error: unknown) =>
    error instanceof GorgiasReadError && error.code === 'rate_limit' && error.retryAt === at.getTime() + 3_600_000);
  assert.equal(calls, 1); assert.deepEqual(long.sleeps, []);
});

test('all view, recent and missing-ticket reads share one minute budget, with no per-ticket budget reset', async () => {
  let calls = 0;
  const h = harness(async () => {calls++; h.advance(20_000); return Response.json(page([]));});
  await assert.rejects(h.client.readHandover(input({viewId: '85001', knownTickets: Array.from({length: 10}, (_, index) =>
    ({id: String(81100 + index), status: 'open', inHandover: true}))})), GorgiasReadError);
  assert.equal(calls, 3);
});

test('invalid domains fail after construction, unauthorized reads never retry and errors cannot reflect a key', async () => {
  let calls = 0;
  const h = harness(async () => {calls++; return new Response('', {status: 401, headers: {'x-request-id': h.key}});});
  await assert.rejects(h.client.readHandover(input()), (error: unknown) => error instanceof GorgiasReadError
    && error.status === 401 && !error.message.includes(h.key));
  assert.equal(calls, 1); assert.equal(h.logs[0]!.requestId, null);
  for (const domain of ['invented.example/path', 'invented.gorgias.com', 'invented:443', 'invented@outside.invalid']) {
    const client = new GorgiasClient({domain, email: 'reader@example.invalid', key: h.key}, {fetch: async () => {calls++; throw new Error(h.key);}});
    await assert.rejects(client.readHandover(input()), GorgiasReadError);
  }
  assert.equal(calls, 1);
});

test('subjects and tags scrub emails, phones, postcodes, URLs, long digits, known full names and street addresses before truncation', () => {
  const examples = ['edda@invented.example', '+44 7700 900123', '(555) 016-9021', 'AB1 2CD', '90210', '90210-1234',
    'https://invented.example/ticket/1', 'www.invented.example', '123456', 'Edda Mallow', '12 Invented Lane', '12345 Invented Road', 'Flat 4, 19 Imaginary Street', 'PO Box 78'];
  for (const value of examples) assert.equal(scrubGorgiasText(`Before ${value} after`, ['Edda Mallow']), 'Before … after', value);
  assert.equal(Array.from(scrubGorgiasText('🌿'.repeat(100))).length, 80);
  const parsed = parseGorgiasTicket(raw(81051, {subject: 'Edda Mallow sent edda@invented.example from 12 Invented Lane', tags: [{name: 'edda@invented.example'}]}), {inHandover: true, viewId: null});
  assert.equal(parsed.subject, '… sent … from …'); assert.deepEqual(parsed.tags, ['…']);
  assert.equal(parsed.customer, 'Edda M.');
  assert.equal(normalizedGorgiasDate('2032-04-07T10:00:00.123456'), '2032-04-07T10:00:00.123Z');
  assert.equal(normalizedGorgiasDate('2032-04-07T10:00:00+01:00'), '2032-04-07T09:00:00.000Z');
  assert.equal(normalizedGorgiasDate(null), null);
  assert.throws(() => normalizedGorgiasDate('2032-02-31T10:00:00Z'));
});
