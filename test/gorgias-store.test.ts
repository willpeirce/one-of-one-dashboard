import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import test from 'node:test';
import type {Database} from '../src/db.js';
import {defaultSettings} from '../src/settings.js';
import {syncSourceHealth} from '../src/sources.js';
import {GORGIAS_SAMPLE_NOW, gorgiasTicketHref, gorgiasWaitHours, gorgiasWaitLabel, gorgiasWeekStart, type GorgiasTicket} from '../src/gorgias/model.js';
import {parseGorgiasTicket} from '../src/gorgias/privacy.js';
import {gorgiasScope, gorgiasSource} from '../src/gorgias/scope.js';
import {readGorgiasFacts, readGorgiasHistory, readGorgiasSync, readKnownGorgiasTickets, recordGorgiasFailure, restoreGorgiasHealth, saveGorgiasPoll} from '../src/gorgias/store.js';
import {createTestDatabase} from './helpers/database.js';

const now = new Date('2032-04-07T12:00:00Z');
const domain = `invented-${randomBytes(6).toString('hex')}`, email = `reader-${randomBytes(6).toString('hex')}@example.invalid`;
const blankCredential = ' '.repeat(2);
const env = () => ({GORGIAS_DOMAIN: domain, GORGIAS_EMAIL: email, GORGIAS_API_KEY: randomBytes(32).toString('hex')});
const settings = () => ({...defaultSettings(), gorgiasHandoverViewId: '71001'});
function row(id = '81001', overrides: Partial<GorgiasTicket> = {}): GorgiasTicket {
  return {id, status: 'open', channel: 'email', tags: ['invented_tag'], inHandover: true, viewId: '71001',
    createdAt: '2032-04-05T08:00:00.000Z', updatedAt: now.toISOString(), lastCustomerMessageAt: '2032-04-06T10:00:00.000Z',
    customer: 'Invented F.', subject: 'Invented missing slab', ...overrides};
}
const poll = (db: Database, scope: string, tickets: GorgiasTicket[], closedThisWeek = 0, at = now) => saveGorgiasPoll(db, scope,
  {tickets, closedThisWeek}, {weekStart: gorgiasWeekStart(at), finishedAt: at, nextRun: new Date(at.getTime() + 120_000)});

test('Gorgias mode uses all trimmed keys, links are bounded and week/wait math follows UK clocks', () => {
  assert.equal(gorgiasSource({}).mode, 'sample');
  assert.equal(gorgiasSource({...env(), GORGIAS_EMAIL: blankCredential}).mode, 'sample');
  assert.deepEqual(gorgiasSource({...env(), GORGIAS_DOMAIN: `  ${domain.toUpperCase()}  `}), {mode: 'live', domain});
  assert.deepEqual(gorgiasSource({...env(), GORGIAS_DOMAIN: `https://${domain}.gorgias.com`}), {mode: 'live', domain: ''});
  assert.equal(gorgiasTicketHref('invented-helpdesk', '81001'), 'https://invented-helpdesk.gorgias.com/app/ticket/81001');
  assert.equal(gorgiasTicketHref('invented-helpdesk/elsewhere', '81001'), null);
  assert.equal(gorgiasTicketHref('invented-helpdesk', '../81001'), null);
  assert.equal(gorgiasWeekStart(now), '2032-04-04T23:00:00.000Z');
  assert.equal(gorgiasWeekStart(new Date('2037-10-25T12:00:00Z')), '2037-10-18T23:00:00.000Z');
  assert.equal(gorgiasWeekStart(new Date('2037-10-26T00:01:00Z')), '2037-10-26T00:00:00.000Z');
  assert.equal(gorgiasWaitHours(row(), now), 26);
  assert.equal(gorgiasWaitHours(row('81001', {lastCustomerMessageAt: null}), now), 52);
  assert.equal(gorgiasWaitHours(row('81001', {lastCustomerMessageAt: '2032-04-08T12:00:00.000Z'}), now), 0);
  assert.deepEqual([0, 0.9, 3.8, 24, 49].map(gorgiasWaitLabel), ['<1h', '<1h', '3h', '1d', '2d 1h']);
});

test('sample Gorgias has four invented minimized tickets and makes no database read', async () => {
  const db: Database = {query: async () => {throw new Error('No sample database read');}, transaction: async () => {throw new Error('No sample write');}, close: async () => {}};
  const facts = await readGorgiasFacts(db, {}, settings(), now);
  assert.equal(facts.mode, 'sample'); assert.equal(facts.status, 'sample'); assert.equal(facts.asOf, GORGIAS_SAMPLE_NOW);
  assert.equal(facts.tickets.length, 4); assert.equal(facts.closedThisWeek, 0);
  assert.ok(facts.tickets.every(ticket => ticket.status === 'open' && ticket.inHandover && ticket.customer.split(' ').length <= 2));
  facts.tickets.length = 0;
  assert.equal((await readGorgiasHistory(db, {}, settings(), now)).tickets.length, 4, 'Callers cannot mutate the cached sample');
});

test('complete Gorgias polls retain departed history, minimize stored fields, aggregate closures and isolate selection/account', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const source = env(), selection = settings(), scope = gorgiasScope(source.GORGIAS_DOMAIN, selection);
  await syncSourceHealth(db, source);
  assert.equal((await readGorgiasFacts(db, source, selection, now)).openedThisWeek, null);
  const raw = {id: 81001, status: 'open', channel: 'email', tags: [{name: 'invented_tag'}],
    created_datetime: '2032-04-04T23:30:00Z', updated_datetime: now.toISOString(), last_received_message_datetime: '2032-04-06T10:00:00Z',
    customer: {firstname: 'Fenn', lastname: 'Invented', email: 'hidden@example.test'}, subject: 'Write hidden@example.test about 123456789',
    messages: [{body_text: 'Invented private message body'}], closed_datetime: '2032-04-07T10:00:00Z'};
  const minimized = parseGorgiasTicket(raw, {inHandover: true, viewId: '71001'});
  await poll(db, scope, [{...minimized, ...{body: 'Never persist this', email: 'hidden@example.test', closed_datetime: raw.closed_datetime}}, row('81002')]);
  let facts = await readGorgiasFacts(db, source, selection, now);
  assert.equal(facts.status, 'live'); assert.equal(facts.tickets.length, 2); assert.equal(facts.openedThisWeek, 2);
  const serialized = JSON.stringify((await db.query('SELECT * FROM pulse.gorgias_tickets')).rows);
  assert.doesNotMatch(serialized, /Never persist|hidden@example|123456789|closed_datetime|messages|body_text|Fenn Invented/);
  assert.match(serialized, /Fenn I\./);
  await poll(db, scope, [row('81001', {status: 'closed', inHandover: false})], 1);
  facts = await readGorgiasFacts(db, source, selection, now);
  assert.equal(facts.tickets.length, 0); assert.equal(facts.closedThisWeek, 1); assert.equal(facts.openedThisWeek, 2);
  const history = await readGorgiasHistory(db, source, selection, now);
  assert.equal(history.tickets.length, 2); assert.equal(history.tickets.find(row => row.id === '81002')?.status, 'open', 'View departure never invents closure');
  assert.ok(history.tickets.every(row => !row.inHandover));
  assert.equal((await readKnownGorgiasTickets(db, scope)).length, 2);
  await poll(db, scope, [row('81001')], 0);
  assert.equal((await readGorgiasFacts(db, source, selection, now)).closedThisWeek, 1, 'Reopening never removes the observed weekly lower bound');
  await poll(db, scope, [row('81001'), row('81003', {status: 'closed', inHandover: false})], 1);
  assert.equal((await readGorgiasFacts(db, source, selection, now)).closedThisWeek, 1,
    'A different closure after a deletion cannot prove a union without forbidden per-ticket closure history; retain the honest lower bound');
  const changed = {...selection, gorgiasHandoverViewId: '71002'};
  assert.equal((await readGorgiasFacts(db, source, changed, now)).tickets.length, 0);
  assert.equal((await readGorgiasHistory(db, {...source, GORGIAS_DOMAIN: `another-${domain}`}, selection, now)).tickets.length, 0);
  assert.equal((await readGorgiasHistory(db, source, selection, now)).tickets.length, 3);
  const nextWeek = await readGorgiasFacts(db, source, selection, new Date('2032-04-12T00:01:00Z'));
  assert.equal(nextWeek.closedThisWeek, null, 'Previous week is never projected as this week');
  assert.equal(nextWeek.status, 'unavailable'); assert.equal(nextWeek.tickets.length, 1, 'Stale source evidence remains visible');
});

test('a failed Gorgias save rolls back membership and counts; stored errors and deferrals survive health restoration', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const source = env(), selection = settings(), scope = gorgiasScope(source.GORGIAS_DOMAIN, selection);
  await syncSourceHealth(db, source); await poll(db, scope, [row()]);
  const previous = await readGorgiasHistory(db, source, selection, now);
  const discarded = await saveGorgiasPoll(db, scope, {tickets: [], closedThisWeek: 9}, {weekStart: gorgiasWeekStart(now),
    finishedAt: now, nextRun: now, isCurrent: async tx => {
      await tx.query('SELECT singleton FROM pulse.settings WHERE singleton=true FOR SHARE'); return false;
    }});
  assert.equal(discarded, false); assert.deepEqual(await readGorgiasHistory(db, source, selection, now), previous);
  await assert.rejects(poll(db, scope, [row('81002', {subject: 'x'.repeat(81)})], 1));
  assert.deepEqual(await readGorgiasHistory(db, source, selection, now), previous);
  await assert.rejects(poll(db, scope, [row(), row()]));
  await assert.rejects(poll(db, scope, [row()], -1));
  const failureAt = new Date(now.getTime() + 120_000), retryAt = new Date(now.getTime() + 3_600_000);
  await recordGorgiasFailure(db, scope, failureAt, retryAt, 'rate_limit');
  const failed = await readGorgiasFacts(db, source, selection, failureAt);
  assert.equal(failed.status, 'unavailable'); assert.equal(failed.checkedAt, now.toISOString()); assert.equal(failed.tickets.length, 1);
  assert.equal((await readGorgiasSync(db, scope))?.nextRunAt, retryAt.toISOString());
  await syncSourceHealth(db, source); await restoreGorgiasHealth(db, scope, failureAt);
  const health = (await db.query<{status: string; consecutive_failures: number}>("SELECT status,consecutive_failures FROM pulse.source_health WHERE source='gorgias'")).rows[0]!;
  assert.equal(health.status, 'error'); assert.equal(health.consecutive_failures, 1);
  await recordGorgiasFailure(db, scope, failureAt, retryAt, 'http');
  assert.equal((await readGorgiasSync(db, scope))?.failures, 2);
  await poll(db, scope, [row()], 0, retryAt);
  assert.equal((await readGorgiasSync(db, scope))?.failures, 0);
  await syncSourceHealth(db, source); await restoreGorgiasHealth(db, scope, retryAt);
  assert.equal((await readGorgiasFacts(db, source, selection, retryAt)).status, 'live');
});
