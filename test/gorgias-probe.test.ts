import assert from 'node:assert/strict';
import test from 'node:test';
import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {GorgiasClient, GorgiasReadError, type GorgiasProbeReader} from '../src/gorgias/client.js';
import {runGorgiasProbe} from '../src/gorgias/probe.js';
import {probeGorgiasCommand} from '../scripts/probe-gorgias.js';

const tickets = JSON.parse(await readFile(new URL('./fixtures/gorgias/tickets.json', import.meta.url), 'utf8'));
const views = JSON.parse(await readFile(new URL('./fixtures/gorgias/views.json', import.meta.url), 'utf8'));
const domain = `invented-${randomBytes(6).toString('hex')}`, email = `reader-${randomBytes(6).toString('hex')}@example.invalid`;

test('the real Gorgias probe reads exactly one page each and prints no ticket, credential or cursor values', async () => {
  const key = randomBytes(24).toString('hex'), calls: URL[] = [], lines: string[] = [], logs: unknown[] = [];
  let now = Date.parse('2032-04-07T12:00:00Z');
  const client = new GorgiasClient({domain: 'invented-helpdesk', email: 'probe@example.invalid', key}, {
    now: () => now, sleep: async ms => {now += ms;}, log: entry => logs.push(entry), fetch: async (url, init) => {
      const target = new URL(String(url)); calls.push(target);
      assert.equal(init?.method, 'GET'); assert.equal(target.searchParams.has('cursor'), false);
      const body = structuredClone(target.pathname === '/api/tickets' ? tickets : views);
      body.meta.next_cursor = 'invented-hidden-cursor';
      body.data[0].invented_schema_field = 'Invented unseen ticket value';
      body.data[0][key] = 'Invented hidden credential field';
      if (target.pathname === '/api/views') body.data[0].name = `Invented handover ${key} probe@example.invalid`;
      return Response.json(body, {headers: {'x-request-id': 'invented-hidden-request'}});
    }});
  const result = await runGorgiasProbe(client, line => lines.push(line));
  assert.equal(result.complete, true); assert.deepEqual(calls.map(url => url.pathname), ['/api/tickets','/api/views']);
  const output = lines.join('\n');
  assert.match(output, /GET \/api\/tickets: 4 rows/); assert.match(output, /customer\.firstname/);
  assert.match(output, /invented_schema_field/);
  assert.match(output, /Pagination: meta=object; next_cursor=string; prev_cursor=null/);
  assert.match(output, /View 85001: Invented handover … …/);
  for (const value of [key, 'probe@example.invalid', '81001', 'Edda', 'Mallow', 'A slab arrived', 'private body', 'invented-hidden-cursor', 'invented-hidden-request', 'Invented unseen ticket value', 'Invented hidden credential field'])
    assert.ok(!output.includes(value), `Probe output contains an unexpected value: ${value === key ? 'credential' : value}`);
  assert.deepEqual(logs, [], 'Probe suppresses routine request logging as well as ticket values');
});

test('probe errors are fixed and each endpoint makes at most one attempt rather than retrying', async () => {
  let now = 0;
  const lines: string[] = [], calls: string[] = [];
  const client = new GorgiasClient({domain: 'invented-helpdesk', email: 'probe@example.invalid', key: randomBytes(24).toString('hex')}, {
    now: () => now, sleep: async ms => {now += ms;}, fetch: async url => {
      const path = new URL(String(url)).pathname; calls.push(path);
      return path === '/api/tickets' ? new Response('Invented private response', {status: 503}) : Response.json(views);
    }});
  const result = await runGorgiasProbe(client, line => lines.push(line));
  assert.equal(result.complete, false); assert.deepEqual(calls, ['/api/tickets','/api/views']);
  assert.match(lines.join('\n'), /tickets: failed \(http 503\)/);
  assert.doesNotMatch(lines.join('\n'), /Invented private response/);
  const error = new GorgiasReadError('http', 401); error.message = 'Invented private error text';
  const reader: GorgiasProbeReader = {probeTickets: async () => {throw error;}, probeViews: async () => {throw new Error('Invented private other text');}};
  const failure: string[] = [];
  await runGorgiasProbe(reader, line => failure.push(line));
  assert.doesNotMatch(failure.join('\n'), /private|other text/);
});

test('probe command requires all three trimmed keys, accepts only help and never echoes unknown arguments', async () => {
  const key = randomBytes(24).toString('hex'), lines: string[] = [];
  let builds = 0;
  const factory = () => {builds++; throw new Error('Should not construct');};
  for (const missing of ['GORGIAS_DOMAIN','GORGIAS_EMAIL','GORGIAS_API_KEY'])
    assert.equal(await probeGorgiasCommand([], {GORGIAS_DOMAIN: domain, GORGIAS_EMAIL: email, GORGIAS_API_KEY: key, [missing]: ' '}, line => lines.push(line), factory), 0);
  assert.equal(await probeGorgiasCommand(['--help'], {}, line => lines.push(line), factory), 0);
  assert.equal(await probeGorgiasCommand(['--unexpected', key], {}, line => lines.push(line), factory), 2);
  assert.equal(builds, 0); assert.ok(!lines.join('\n').includes(key));
  assert.equal(await probeGorgiasCommand([], {GORGIAS_DOMAIN: ` ${domain.toUpperCase()} `, GORGIAS_EMAIL: ` ${email} `, GORGIAS_API_KEY: ` ${key} `}, line => lines.push(line), credentials => {
    assert.deepEqual(credentials, {domain, email, key});
    return {probeTickets: async () => {throw new Error(key);}, probeViews: async () => {throw new Error(key);}};
  }), 1);
  assert.ok(!lines.join('\n').includes(key));
});
