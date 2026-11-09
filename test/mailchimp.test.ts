import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { appConfig } from '../src/config.js';
import { MailchimpClient, MailchimpReadError, MAILCHIMP_ORDER_FIELDS, type MailchimpRequestLog } from '../src/mailchimp/client.js';
import { MAILCHIMP_FRESH_MS, MAILCHIMP_POLL_MS, parseMailchimpAudience, parseMailchimpReport } from '../src/mailchimp/model.js';
import { readMailchimpFacts, recordMailchimpFailure, saveMailchimpAudience } from '../src/mailchimp/store.js';
import { MailchimpWorker } from '../src/mailchimp/worker.js';
import { syncSourceHealth } from '../src/sources.js';
import { createTestDatabase } from './helpers/database.js';
import type { Database } from '../src/db.js';

const fixture = async (name: string): Promise<any> => JSON.parse(await readFile(new URL(`./fixtures/mailchimp/${name}.json`, import.meta.url), 'utf8'));
const now = new Date('2026-11-05T12:00:00Z');
const key = () => randomBytes(32).toString('hex');

test('Mailchimp has only fixed GET reads, limits every response and never logs credentials or business identifiers', async () => {
  const token = key(), logs: MailchimpRequestLog[] = [], requests: URL[] = [];
  let clock = now.getTime(), active = 0, maximum = 0;
  const client = new MailchimpClient(token, {now: () => clock, sleep: async ms => { clock += ms; }, log: entry => logs.push(entry),
    fetch: async (input, init) => {
      active++; maximum = Math.max(maximum, active);
      await Promise.resolve();
      const url = new URL(String(input)); requests.push(url);
      assert.equal(init?.method, 'GET'); assert.equal(init?.body, undefined); assert.equal(init?.redirect, 'error');
      assert.ok(init?.signal instanceof AbortSignal);
      assert.equal(url.origin, `https://${appConfig.mailchimp.server}.api.mailchimp.com`);
      assert.equal(url.toString().includes(token), false);
      const selected = url.searchParams.get('fields')!;
      assert.ok(selected); assert.doesNotMatch(selected, /email_address|customer|address|reply_to|subject|title|recipients/i);
      const name = url.pathname.endsWith('/campaigns') ? 'campaigns' : url.pathname.includes('/campaigns/') ? 'campaign'
        : url.pathname.includes('/reports/') ? 'report' : url.pathname.includes('/lists/') ? 'audience' : 'orders';
      if (name === 'orders') assert.equal(selected, MAILCHIMP_ORDER_FIELDS);
      if (name === 'audience') {
        assert.equal(url.pathname, `/${appConfig.mailchimp.apiVersion}/lists/${appConfig.mailchimp.listId}`);
        assert.equal(url.searchParams.get('include_total_contacts'), 'true');
      }
      active--;
      return new Response(JSON.stringify(await fixture(name)), {headers: {'x-request-id': 'invented-request'}});
    }});
  assert.deepEqual(Object.getOwnPropertyNames(MailchimpClient.prototype).sort(), ['constructor', 'audience', 'campaign', 'campaigns', 'orders', 'report'].sort());
  const [campaigns, campaign, report, orders, audience] = await Promise.all([client.campaigns(), client.campaign('invented-campaign'), client.report('invented-campaign'), client.orders('invented-campaign'), client.audience()]);
  assert.equal(maximum, 1); assert.equal(requests.length, 5);
  assert.equal(campaigns.data[0]!.id, campaign.data.id); assert.equal(report.data.revenueUsd, 243.75);
  assert.equal(orders.data[0]!.currency, 'USD'); assert.equal(audience.data.contacts, 813);
  assert.equal(audience.fieldNames.includes('stats.total_contacts'), true);
  assert.ok(logs.every(entry => entry.requestId === 'invented-request' && entry.status === 200));
  assert.doesNotMatch(JSON.stringify(logs), /invented-campaign|invented-audience|243\.75/);
  assert.equal(JSON.stringify(logs).includes(token), false);
  await assert.rejects(client.report('../invented'), error => error instanceof MailchimpReadError && error.code === 'invalid');
  assert.equal(requests.length, 5, 'a caller cannot inject a path or URL');
});

test('every ecommerce page selects exactly the five permitted order fields plus pagination metadata', async () => {
  const sample = (await fixture('orders')).orders[0], urls: URL[] = [];
  let clock = now.getTime();
  const client = new MailchimpClient(key(), {now: () => clock, sleep: async ms => { clock += ms; }, log: () => {}, fetch: async input => {
    const url = new URL(String(input)); urls.push(url);
    const offset = Number(url.searchParams.get('offset'));
    const orders = Array.from({length: offset ? 1 : 100}, (_, index) => ({...sample, id: `invented-order-${offset + index}`}));
    return Response.json({orders, total_items: 101});
  }});
  const result = await client.orders('invented-campaign');
  assert.equal(result.data.length, 101); assert.equal(urls.length, 2);
  for (const url of urls) {
    assert.equal(url.pathname, `/${appConfig.mailchimp.apiVersion}/ecommerce/orders`);
    assert.equal(url.searchParams.get('fields'), 'orders.id,orders.campaign_id,orders.order_total,orders.currency_code,orders.processed_at_foreign,total_items');
    assert.equal(url.searchParams.get('campaign_id'), 'invented-campaign');
  }
  assert.deepEqual(urls.map(url => url.searchParams.get('offset')), ['0', '100']);
});

test('Mailchimp retries three times with backoff and honors Retry-After before another GET', async () => {
  const waits: number[] = [], starts: number[] = [], logs: MailchimpRequestLog[] = [];
  let clock = now.getTime(), attempts = 0;
  const client = new MailchimpClient(key(), {now: () => clock, sleep: async ms => { waits.push(ms); clock += ms; }, log: entry => logs.push(entry), fetch: async () => {
    starts.push(clock); attempts++;
    return attempts === 1 ? new Response('', {status: 429, headers: {'retry-after': '2', 'x-request-id': 'invented-busy'}})
      : attempts < 4 ? new Response('', {status: 503}) : Response.json(await fixture('audience'));
  }});
  await client.audience();
  assert.equal(attempts, 4); assert.deepEqual(waits, [2000, 2000, 4000]);
  assert.equal(starts[1]! - starts[0]!, 2000); assert.deepEqual(logs.map(row => row.status), [429, 503, 503, 200]);
});

test('long Retry-After is deferred beyond the call budget and no queued endpoint calls early', async () => {
  let clock = now.getTime(), attempts = 0;
  const retryAt = clock + 8 * 60 * 60_000;
  const client = new MailchimpClient(key(), {now: () => clock, sleep: async () => { assert.fail('long deferrals must not occupy the read'); }, log: () => {}, fetch: async () => {
    attempts++;
    return attempts === 1 ? new Response('', {status: 429, headers: {'retry-after': new Date(retryAt).toUTCString()}}) : Response.json(await fixture('audience'));
  }});
  await assert.rejects(client.audience(), error => error instanceof MailchimpReadError && error.code === 'rate_limit' && error.retryAt === retryAt);
  await assert.rejects(client.campaigns(), error => error instanceof MailchimpReadError && error.retryAt === retryAt);
  assert.equal(attempts, 1);
  clock = retryAt;
  await client.audience(); assert.equal(attempts, 2);
});

test('transport errors discard upstream secrets, unauthorized reads do not retry and token-shaped request ids are hidden', async () => {
  const token = key(), logs: MailchimpRequestLog[] = [];
  let clock = now.getTime(), attempts = 0;
  const client = new MailchimpClient(token, {now: () => clock, sleep: async ms => {clock += ms;}, log: entry => logs.push(entry), fetch: async () => {attempts++; throw new Error(`unsafe ${token}`);}});
  await assert.rejects(client.audience(), error => error instanceof MailchimpReadError && error.code === 'network' && !error.message.includes(token));
  assert.equal(attempts, 4); assert.equal(JSON.stringify(logs).includes(token), false);
  attempts = 0;
  const denied = new MailchimpClient(token, {log: entry => logs.push(entry), fetch: async () => {attempts++; return new Response('', {status: 401, headers: {'x-request-id': token}});}});
  await assert.rejects(denied.audience(), error => error instanceof MailchimpReadError && error.status === 401);
  assert.equal(attempts, 1); assert.equal(logs.at(-1)!.requestId, null);
});

test('missing audience totals stay unknown and report dollars require an explicit USD currency', async () => {
  const raw = await fixture('audience'); delete raw.stats.total_contacts;
  assert.equal(parseMailchimpAudience(raw).contacts, null);
  const report = await fixture('report'); report.ecommerce.currency_code = 'GBP';
  assert.equal(parseMailchimpReport(report).revenueUsd, null);
  assert.equal(parseMailchimpReport({...report, ecommerce: {}}).orders, null);
  assert.throws(() => parseMailchimpAudience({...raw, stats: {...raw.stats, member_count: -1}}));
});

test('audience upserts preserve source provenance, isolate sample/live and mark stale or failed facts unavailable', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const token = key(); await syncSourceHealth(db, {MAILCHIMP_API_KEY: token});
  assert.equal((await readMailchimpFacts(db, 'live', now)).status, 'pending');
  const sample = await readMailchimpFacts(db, 'sample', now);
  assert.equal(sample.status, 'sample'); assert.equal(sample.flowCoverage, 'unknown');
  const audience = {...sample.audience!, id: appConfig.mailchimp.listId};
  await saveMailchimpAudience(db, audience, now, new Date(now.getTime() + MAILCHIMP_POLL_MS));
  await saveMailchimpAudience(db, {...audience, contacts: 901}, now, new Date(now.getTime() + MAILCHIMP_POLL_MS));
  const stored = await db.query<{source: string; source_id: string; brand: string; mode: string}>('SELECT source,source_id,brand,mode FROM pulse.mailchimp_records');
  assert.deepEqual(stored.rows, [{source: 'mailchimp', source_id: appConfig.mailchimp.listId, brand: appConfig.brand, mode: 'live'}]);
  const live = await readMailchimpFacts(db, 'live', now);
  assert.equal(live.status, 'live'); assert.equal(live.audience!.contacts, 901); assert.equal(live.flowCoverage, 'unknown'); assert.deepEqual(live.reports, []);
  assert.equal((await readMailchimpFacts(db, 'sample', now)).audience!.contacts, sample.audience!.contacts);
  assert.equal((await readMailchimpFacts(db, 'live', new Date(now.getTime() + MAILCHIMP_FRESH_MS + 1))).status, 'unavailable');
  await db.query("UPDATE pulse.mailchimp_sync SET last_error='http',failures=1");
  const failed = await readMailchimpFacts(db, 'live', now);
  assert.equal(failed.status, 'unavailable'); assert.equal(failed.audience!.contacts, 901, 'an outage retains the last good row');
});

test('audience worker starts without IO, runs once at a time and polls independently every three hours', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const env = {MAILCHIMP_API_KEY: key()}; await syncSourceHealth(db, env);
  let clock = now.getTime(), calls = 0, release!: () => void, started!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  const began = new Promise<void>(resolve => {started = resolve;});
  const raw = {...await fixture('audience'), id: appConfig.mailchimp.listId};
  const worker = new MailchimpWorker(db, env, {clock: () => new Date(clock), log: () => {}, fetch: async () => {calls++; started(); await gate; return Response.json(raw);}});
  t.after(() => worker.stop());
  assert.equal(worker.mode, 'live'); assert.equal(calls, 0);
  const first = worker.tick(); await began;
  assert.equal(worker.tick(), first); release(); await first;
  await worker.tick(); assert.equal(calls, 1);
  clock += MAILCHIMP_POLL_MS; await worker.tick(); assert.equal(calls, 2);
  const health = (await db.query<{status: string; consecutive_failures: number}>("SELECT status,consecutive_failures FROM pulse.source_health WHERE source='mailchimp'")).rows[0]!;
  assert.deepEqual(health, {status: 'healthy', consecutive_failures: 0});
});

test('worker persists long rate-limit deferrals through restart and a later success recovers health', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const env = {MAILCHIMP_API_KEY: key()}; await syncSourceHealth(db, env);
  let clock = now.getTime(), calls = 0;
  const first = new MailchimpWorker(db, env, {clock: () => new Date(clock), log: () => {}, fetch: async () => {calls++; return new Response('', {status: 429, headers: {'retry-after': '28800'}});}});
  await first.tick(); await first.stop();
  const scheduled = (await db.query<{next_run_at: Date; failures: number}>('SELECT next_run_at,failures FROM pulse.mailchimp_sync')).rows[0]!;
  assert.equal(scheduled.next_run_at.getTime(), clock + 8 * 60 * 60_000); assert.equal(scheduled.failures, 1);
  const restarted = new MailchimpWorker(db, env, {clock: () => new Date(clock), log: () => {}, fetch: async () => {calls++; return Response.json({...await fixture('audience'), id: appConfig.mailchimp.listId});}});
  t.after(() => restarted.stop());
  clock += MAILCHIMP_POLL_MS; await restarted.tick(); assert.equal(calls, 1);
  clock = scheduled.next_run_at.getTime(); await restarted.tick(); assert.equal(calls, 2);
  assert.equal((await readMailchimpFacts(db, 'live', new Date(clock))).status, 'live');
});

test('restart restores stored healthy or failed Mailchimp health before a deferred poll without making a source call', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const env = {MAILCHIMP_API_KEY: key()}; await syncSourceHealth(db, env);
  const audience = {...parseMailchimpAudience(await fixture('audience')), id: appConfig.mailchimp.listId};
  const nextRun = new Date(now.getTime() + MAILCHIMP_POLL_MS);
  await saveMailchimpAudience(db, audience, now, nextRun);
  const health = async () => (await db.query<{status: string; last_success_at: Date | null; last_attempt_at: Date | null; consecutive_failures: number}>(
    "SELECT status,last_success_at,last_attempt_at,consecutive_failures FROM pulse.source_health WHERE source='mailchimp'")).rows[0]!;
  let calls = 0;
  const restart = (at: Date) => new MailchimpWorker(db, env, {clock: () => at, fetch: async () => {calls++; throw new Error('Unexpected early source read');}});
  await syncSourceHealth(db, env); assert.equal((await health()).status, 'not_implemented');
  const healthy = restart(new Date(now.getTime() + 60_000));
  await healthy.tick(); await healthy.stop();
  assert.deepEqual(await health(), {status: 'healthy', last_success_at: now, last_attempt_at: now, consecutive_failures: 0});
  assert.equal(calls, 0);

  const failedAt = new Date(now.getTime() + 2 * 60_000);
  await recordMailchimpFailure(db, failedAt, nextRun, 'rate_limit');
  await syncSourceHealth(db, env); assert.equal((await health()).status, 'not_implemented');
  const failed = restart(new Date(now.getTime() + 3 * 60_000));
  await failed.tick(); await failed.stop();
  assert.deepEqual(await health(), {status: 'error', last_success_at: now, last_attempt_at: failedAt, consecutive_failures: 1});
  assert.equal(calls, 0);
});

test('sample worker does no IO, and database or source failures never escape a live tick', async t => {
  let calls = 0;
  const token = key(), messages: string[] = [], original = console.error;
  console.error = (...args: unknown[]) => {messages.push(args.join(' '));}; t.after(() => {console.error = original;});
  const broken = {query: async () => {calls++; throw new Error(token);}, transaction: async () => {throw new Error(token);}, close: async () => {}} as Database;
  const sample = new MailchimpWorker(broken, {}, {fetch: async () => {assert.fail('sample network read');}});
  sample.start(); await sample.tick(); await sample.stop(); assert.equal(calls, 0);
  const live = new MailchimpWorker(broken, {MAILCHIMP_API_KEY: token});
  await assert.doesNotReject(live.tick()); await live.stop(); assert.equal(calls, 1);
  assert.ok(messages.some(message => message.includes('code: storage'))); assert.equal(messages.join(' ').includes(token), false);
});
