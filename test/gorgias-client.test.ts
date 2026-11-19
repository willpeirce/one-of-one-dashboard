import assert from 'node:assert/strict';
import test from 'node:test';
import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {GorgiasClient, GorgiasReadError, gorgiasCredentials, type GorgiasClientOptions, type GorgiasRequestLog} from '../src/gorgias/client.js';
import {gorgiasWeekStart, type GorgiasPollInput} from '../src/gorgias/model.js';
import {normalizeGorgiasIntent, normalizedGorgiasDate, parseGorgiasIntentFields, parseGorgiasTicket, scrubGorgiasText} from '../src/gorgias/privacy.js';

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
    return Response.json(page(target.pathname === '/api/custom-fields' ? [] : fixture.data), {headers: {'x-request-id': 'invented-request'}});
  });
  const result = await h.client.readHandover(input());
  assert.equal(result.tickets.length, 4); assert.equal(result.closedThisWeek, 0); assert.equal(calls.length, 2);
  assert.equal(calls[1]!.pathname, '/api/custom-fields');
  assert.deepEqual([...calls[1]!.searchParams.entries()], [['object_type', 'Ticket'], ['limit', '100']]);
  assert.equal(calls[0]!.searchParams.get('trashed'), 'false'); assert.equal(calls[0]!.searchParams.get('order_by'), 'updated_datetime:desc');
  assert.equal(calls[0]!.searchParams.has('status'), false); assert.equal(calls[0]!.searchParams.has('tag'), false);
  assert.deepEqual(Object.keys(result.tickets[0]!).sort(), ['id','status','channel','tags','inHandover','viewId','createdAt','updatedAt','lastCustomerMessageAt','customer','subject','aiIntent'].sort());
  assert.equal(result.tickets[0]!.aiIntent, null);
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
    if (target.pathname === '/api/custom-fields') return Response.json(page([]));
    return Response.json(!target.searchParams.has('cursor') ? page([raw(81011), raw(81012, {tags: [{name: 'another_tag'}]})], 'invented-next')
      : page([raw(81013, {status: 'closed', closed_datetime: '2032-04-06T08:00:00Z'}), raw(81011)]));
  });
  const result = await h.client.readHandover(input());
  assert.deepEqual(result.tickets.map(row => row.id).sort(), ['81011','81013']);
  assert.equal(result.tickets.find(row => row.id === '81013')!.inHandover, false);
  assert.equal(result.closedThisWeek, 1); assert.equal(calls.length, 3);
  assert.equal(calls[1]!.searchParams.get('cursor'), 'invented-next');
  assert.doesNotMatch(JSON.stringify(result), /closed_datetime|closedAt|another_tag/);
});

test('view mode confirms missing members, includes known former-member closures and stops the recent scan at the UK week boundary', async () => {
  const calls: string[] = [];
  const h = harness(async url => {
    const target = new URL(String(url)); calls.push(target.pathname + target.search);
    if (target.pathname === '/api/custom-fields') return Response.json(page([]));
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
  assert.ok(result.tickets.every(row => row.viewId === '85001')); assert.equal(calls.length, 4);
  assert.ok(calls[0]!.includes('view_id=85001')); assert.ok(calls[2]!.startsWith('/api/tickets/81024'));
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
  await retry.client.readHandover(input()); assert.equal(calls, 5);
  assert.deepEqual(retry.sleeps, [1000,2000,4000,550]);
  assert.deepEqual(retry.logs.map(row => row.endpoint), ['tickets','tickets','tickets','tickets','custom-fields']);
  calls = 0;
  const rate = harness(async () => ++calls === 1 ? new Response('', {status: 429, headers: {'Retry-After': '8'}}) : Response.json(page([])));
  await rate.client.readHandover(input()); assert.equal(calls, 3); assert.deepEqual(rate.sleeps, [8000,550]);
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

const intentField = (id: number, extra: Record<string, unknown> = {}) => ({id, object_type: 'Ticket', managed_type: 'ai_intent',
  label: 'Invented field label', deactivated_datetime: null, ...extra});
const intentFields = (id: number, value: unknown) => ({[String(id)]: {id, value}});

test('AI Intent is found by managed type at a changing id, with pagination and deactivated fields ignored', async () => {
  for (const fieldId of [82341, 98765]) {
    const calls: URL[] = [];
    const h = harness(async url => {
      const target = new URL(String(url)); calls.push(target);
      if (target.pathname === '/api/tickets') return Response.json(page([raw(81201, {custom_fields: intentFields(fieldId, 'Order::Damaged::Other')})]));
      assert.equal(target.pathname, '/api/custom-fields'); assert.equal(target.searchParams.get('object_type'), 'Ticket');
      return Response.json(target.searchParams.has('cursor') ? page([intentField(fieldId)]) : page([
        intentField(82342, {managed_type: 'contact_reason', label: 'AI Intent'}),
        intentField(82343, {deactivated_datetime: '2032-04-06T12:00:00Z'}),
        intentField(82344, {object_type: 'Customer'}),
      ], 'invented-fields-page'));
    });
    const result = await h.client.readHandover(input());
    assert.equal(result.tickets[0]!.aiIntent, 'Order::Damaged'); assert.equal(result.intentFieldAvailable, true);
    assert.equal(calls.length, 3); assert.equal(calls[2]!.searchParams.get('cursor'), 'invented-fields-page');
    assert.doesNotMatch(JSON.stringify(result), /custom_fields|Other|managed_type|Invented field label/);
  }
});

test('intent discovery caches a found id for twenty-four hours across queued reads, then refreshes it', async () => {
  let fields = 0;
  const h = harness(async url => new URL(String(url)).pathname === '/api/custom-fields'
    ? (fields++, Response.json(page([intentField(82401)])))
    : Response.json(page([raw(81202, {custom_fields: intentFields(82401, 'Shipping::Delay')})])));
  const results = await Promise.all([h.client.readHandover(input()), h.client.readHandover(input())]);
  assert.equal(fields, 1); assert.ok(results.every(result => result.tickets[0]!.aiIntent === 'Shipping::Delay'));
  h.advance(23 * 3_600_000); await h.client.readHandover(input()); assert.equal(fields, 1);
  h.advance(3_600_000); await h.client.readHandover(input()); assert.equal(fields, 2);
});

test('no matching intent field is cached and does not request backfill or claim intent was checked', async () => {
  let fields = 0, details = 0;
  const h = harness(async url => {
    const path = new URL(String(url)).pathname;
    if (path === '/api/custom-fields') {fields++; return Response.json(page([intentField(82402, {managed_type: 'contact_reason'})]));}
    if (path !== '/api/tickets') details++;
    return Response.json(page([raw(81203, {custom_fields: intentFields(82402, 'Order::Damaged')})]));
  });
  for (let i = 0; i < 2; i++) {
    const result = await h.client.readHandover(input({intentBackfillIds: ['81204']}));
    assert.equal(result.tickets[0]!.aiIntent, null); assert.equal(result.intentFieldAvailable, undefined); assert.equal(result.intentBackfill, undefined);
  }
  assert.equal(fields, 1); assert.equal(details, 0);
});

test('failed optional intent discovery preserves the main read through retries, a long rate limit and invalid pagination', async () => {
  for (const failure of ['http', 'rate_limit', 'pagination'] as const) {
    let fields = 0;
    const h = harness(async url => {
      if (new URL(String(url)).pathname === '/api/tickets') return Response.json(page([raw(81205)]));
      fields++;
      return failure === 'http' ? new Response('', {status: 503}) : failure === 'rate_limit'
        ? new Response('', {status: 429, headers: {'Retry-After': '3600'}})
        : Response.json(page([intentField(82403, {managed_type: 'contact_reason'})], 'repeated-fields-cursor'));
    });
    const result = await h.client.readHandover(input({intentBackfillIds: ['81206']}));
    assert.deepEqual(result.tickets.map(row => [row.id, row.inHandover, row.aiIntent]), [['81205', true, null]]);
    assert.equal(result.closedThisWeek, 0); assert.equal(result.intentFieldAvailable, undefined);
    assert.equal(fields, failure === 'http' ? 4 : failure === 'rate_limit' ? 1 : 2);
    assert.ok(h.now() - at.getTime() <= 60_000);
  }
});

test('an expired discovery failure does not reuse its old field id, and the next successful poll can recover', async () => {
  let fields = 0;
  const h = harness(async url => {
    if (new URL(String(url)).pathname === '/api/tickets') return Response.json(page([raw(81207, {custom_fields: intentFields(82404, 'Order::Damaged')})]));
    fields++;
    return fields > 1 && fields < 6 ? new Response('', {status: 503}) : Response.json(page([intentField(82404)]));
  });
  assert.equal((await h.client.readHandover(input())).tickets[0]!.aiIntent, 'Order::Damaged');
  h.advance(24 * 3_600_000);
  assert.equal((await h.client.readHandover(input())).tickets[0]!.aiIntent, null);
  assert.equal((await h.client.readHandover(input())).tickets[0]!.aiIntent, 'Order::Damaged');
});

test('intent projection keeps only two strict levels, never a third-level value or other custom fields', () => {
  for (const [value, expected] of [['Order::Damaged', 'Order::Damaged'], ['Order::Damaged::Other', 'Order::Damaged'],
    ['Promotion & Discount::Issue::an invented private leaf', 'Promotion & Discount::Issue'],
    [' order  :: Wrong  Item ', 'order::Wrong  Item'], ['A::' + 'B'.repeat(77), 'A::' + 'B'.repeat(77)]] as const)
    assert.equal(normalizeGorgiasIntent(value), expected);
  for (const value of [undefined, null, {}, [], 5, 'Order', 'Order:', 'Order::', '::Damaged', 'Order::&',
    'Order::Damaged2', 'Order::Damaged-box', 'Order::Damaged<script>', 'Ordér::Damaged', 'Order\n::Damaged',
    'Order::Damaged\t', 'Order::Damaged\n', 'Order::Damaged\r\n', 'Order::Dama\u0000ged',
    'Order:::Damaged', 'A::' + 'B'.repeat(78)]) assert.equal(normalizeGorgiasIntent(value), null, String(value));
  assert.equal(parseGorgiasIntentFields(intentFields(82405, 'Order::Damaged'), null), null);
  assert.equal(parseGorgiasIntentFields(intentFields(82405, 'Order::Damaged'), '82406'), null);
  assert.equal(parseGorgiasIntentFields({'82405': {id: 82406, value: 'Order::Damaged'}}, '82405'), null);
  const parsed = parseGorgiasTicket(raw(81208, {custom_fields: {...intentFields(82405, 'Order::Damaged::private invented leaf'),
    ...intentFields(82406, 'private invented other field')}}), {inHandover: true, viewId: null}, '82405');
  assert.equal(parsed.aiIntent, 'Order::Damaged'); assert.doesNotMatch(JSON.stringify(parsed), /private|custom_fields|82405|82406/);
});

test('intent backfill is capped at twenty oldest candidates, skips current and duplicate tickets, and returns intent only', async () => {
  const reads: string[] = [];
  const h = harness(async url => {
    const path = new URL(String(url)).pathname;
    if (path === '/api/custom-fields') return Response.json(page([intentField(82407)]));
    if (path === '/api/tickets') return Response.json(page([raw(81210, {custom_fields: intentFields(82407, 'Order::Status')})]));
    const id = path.split('/').at(-1)!; reads.push(id);
    return Response.json({id, status: 'closed', closed_datetime: 'invalid and ignored', subject: 'private invented subject',
      custom_fields: intentFields(82407, 'Order::Damaged::private invented leaf')});
  });
  const candidates = Array.from({length: 25}, (_, i) => String(81300 + i));
  const result = await h.client.readHandover(input({intentBackfillIds: ['81210', candidates[0]!, ...candidates]}));
  assert.deepEqual(reads, candidates.slice(0, 20));
  assert.deepEqual(result.intentBackfill, candidates.slice(0, 20).map(id => ({id, aiIntent: 'Order::Damaged'})));
  assert.equal(result.tickets.length, 1); assert.equal(result.tickets[0]!.id, '81210'); assert.equal(result.tickets[0]!.status, 'open');
  assert.equal(result.tickets[0]!.inHandover, true); assert.equal(result.closedThisWeek, 0);
  assert.doesNotMatch(JSON.stringify(result), /private|invalid and ignored/);
});

test('a backfill 404 is checked without inventing a ticket, while any other failed detail stops optional work', async () => {
  const reads: string[] = [];
  const h = harness(async url => {
    const path = new URL(String(url)).pathname;
    if (path === '/api/custom-fields') return Response.json(page([intentField(82408)]));
    if (path === '/api/tickets') return Response.json(page([raw(81211)]));
    const id = path.split('/').at(-1)!; reads.push(id);
    return new Response('', {status: id === '81400' ? 404 : 503});
  });
  const result = await h.client.readHandover(input({intentBackfillIds: ['81400','81401','81402']}));
  assert.deepEqual(result.intentBackfill, [{id: '81400', aiIntent: null}]);
  assert.deepEqual(reads, ['81400','81401','81401','81401','81401']);
  assert.equal(result.tickets.length, 1); assert.equal(result.closedThisWeek, 0);
});

test('optional discovery and backfill use only the time remaining after the main read', async () => {
  for (const mainMs of [45_000, 52_000]) {
    let fields = 0, details = 0;
    const h = harness(async url => {
      const path = new URL(String(url)).pathname;
      if (path === '/api/tickets') {h.advance(mainMs); return Response.json(page([raw(81212)]));}
      if (path === '/api/custom-fields') {fields++; return Response.json(page([intentField(82409)]));}
      details++; h.advance(3_000); return Response.json({id: path.split('/').at(-1), custom_fields: intentFields(82409, 'Order::Damaged')});
    });
    const result = await h.client.readHandover(input({intentBackfillIds: Array.from({length: 20}, (_, i) => String(81500 + i))}));
    assert.equal(result.tickets.length, 1); assert.equal(result.closedThisWeek, 0);
    assert.equal(fields, mainMs === 45_000 ? 1 : 0); assert.equal(details, mainMs === 45_000 ? 2 : 0);
    assert.ok(h.now() - at.getTime() <= 60_000);
  }
});

test('intent backfill reuses a main-read 404 only for an eligible candidate and never reads it twice', async () => {
  const details: string[] = [];
  const h = harness(async url => {
    const path = new URL(String(url)).pathname;
    if (path === '/api/custom-fields') return Response.json(page([intentField(82410)]));
    if (path === '/api/tickets') return Response.json(page([]));
    const id = path.split('/').at(-1)!; details.push(id);
    return new Response('', {status: 404});
  });
  const result = await h.client.readHandover(input({viewId: '85001', knownTickets: [
    {id: '81600', status: 'open', inHandover: true}, {id: '81601', status: 'open', inHandover: true},
  ], intentBackfillIds: ['81600', '81600']}));
  assert.deepEqual(details, ['81600', '81601']);
  assert.deepEqual(result.intentBackfill, [{id: '81600', aiIntent: null}]);
  assert.deepEqual(result.tickets, []); assert.equal(result.closedThisWeek, 0);
});
