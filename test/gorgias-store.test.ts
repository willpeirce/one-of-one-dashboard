import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import type {Database} from '../src/db.js';
import {defaultSettings} from '../src/settings.js';
import {readSourceHealth, syncSourceHealth} from '../src/sources.js';
import {GORGIAS_SAMPLE_NOW, gorgiasTicketHref, gorgiasWaitHours, gorgiasWaitLabel, gorgiasWeekStart, type GorgiasTicket} from '../src/gorgias/model.js';
import {parseGorgiasTicket} from '../src/gorgias/privacy.js';
import {gorgiasScope, gorgiasSource} from '../src/gorgias/scope.js';
import {readGorgiasIntentBackfillIds, readGorgiasFacts, readGorgiasHistory, readGorgiasSync, readKnownGorgiasTickets, recordGorgiasFailure, restoreGorgiasHealth, saveGorgiasPoll} from '../src/gorgias/store.js';
import {createTestDatabase} from './helpers/database.js';
import {handoverCount} from '../src/gorgias/home-count.js';
import {gorgiasNeeds} from '../src/gorgias/needs.js';
import {gorgiasSectionHtml} from '../src/handover/gorgias-view.js';

const now = new Date('2032-04-07T12:00:00Z');
const domain = `invented-${randomBytes(6).toString('hex')}`, email = `reader-${randomBytes(6).toString('hex')}@example.invalid`;
const blankCredential = ' '.repeat(2);
const env = () => ({GORGIAS_DOMAIN: domain, GORGIAS_EMAIL: email, GORGIAS_API_KEY: randomBytes(32).toString('hex')});
const settings = () => ({...defaultSettings(), gorgiasHandoverViewId: '71001'});
function row(id = '81001', overrides: Partial<GorgiasTicket> = {}): GorgiasTicket {
  return {id, status: 'open', channel: 'email', tags: ['invented_tag'], inHandover: true, viewId: '71001',
    createdAt: '2032-04-05T08:00:00.000Z', updatedAt: now.toISOString(), lastCustomerMessageAt: '2032-04-06T10:00:00.000Z',
    customer: 'Invented F.', subject: 'Invented missing slab', aiIntent: null, ...overrides};
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
  assert.equal(facts.tickets.length, 4); assert.equal(facts.closedThisWeek, 0); assert.equal(facts.openedThisWeek, 4);
  assert.deepEqual(facts.tickets.map(ticket => ticket.aiIntent), [
    'Product::Quality Issues', 'Order::Missing Item', 'Product::Availability', 'Shipping::Delay',
  ], 'The active managed field supplies only two levels; its label and position do not select it');
  const metadata = JSON.parse(await readFile(new URL('./fixtures/gorgias/custom-fields.json', import.meta.url), 'utf8')) as {data: {id: number}[]};
  const serialized = JSON.stringify(facts);
  assert.doesNotMatch(serialized, /custom_fields|managed_type|Discarded invented leaf/);
  assert.ok(metadata.data.every(field => !serialized.includes(String(field.id))), 'No source field identifier reaches the facts');
  assert.deepEqual(await readGorgiasFacts(db, {}, settings(), new Date(+now + 180_000)), facts, 'Sample timestamps remain fixed');
  const html = gorgiasSectionHtml(facts);
  assert.match(html, /Sample data · four invented tickets, names and times/);
  assert.equal((html.match(/data-gorgias-ticket=/g) ?? []).length, 4);
  assert.equal(gorgiasNeeds(facts, settings(), 'sample')[0]!.title, 'Sample · Reply to 4 customers · oldest 2d 2h');
  assert.equal(handoverCount(facts, 'live'), undefined, 'Sample handover data remains excluded beside live Home');
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
  await syncSourceHealth(db, source); await restoreGorgiasHealth(db, scope, failureAt, selection);
  const health = (await db.query<{status: string; consecutive_failures: number}>("SELECT status,consecutive_failures FROM pulse.source_health WHERE source='gorgias'")).rows[0]!;
  assert.equal(health.status, 'error'); assert.equal(health.consecutive_failures, 1);
  await recordGorgiasFailure(db, scope, failureAt, retryAt, 'http');
  assert.equal((await readGorgiasSync(db, scope))?.failures, 2);
  await poll(db, scope, [row()], 0, retryAt);
  assert.equal((await readGorgiasSync(db, scope))?.failures, 0);
  await syncSourceHealth(db, source); await restoreGorgiasHealth(db, scope, retryAt, selection);
  assert.equal((await readGorgiasFacts(db, source, selection, retryAt)).status, 'live');
});

test('stored facts, Home count and restored health use the same view/tag freshness threshold', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const source = env(); await syncSourceHealth(db, source);
  for (const [viewId, minutes] of [['71001', 6], ['', 30]] as const) {
    const selection = {...settings(), gorgiasHandoverViewId: viewId}, scope = gorgiasScope(source.GORGIAS_DOMAIN, selection);
    await poll(db, scope, [row('81001', {viewId: viewId || null})]);
    const boundary = new Date(+now + minutes * 60_000);
    let facts = await readGorgiasFacts(db, source, selection, boundary);
    assert.equal(facts.status, 'live'); assert.equal(handoverCount(facts, 'live')!.current, true);
    assert.equal((await readSourceHealth(db, undefined, {gorgias: selection, now: boundary})).find(row => row.source === 'gorgias')!.status, 'healthy');
    await restoreGorgiasHealth(db, scope, boundary, selection);
    assert.equal((await db.query<{status: string}>("SELECT status FROM pulse.source_health WHERE source='gorgias'")).rows[0]!.status, 'healthy');
    const stale = new Date(+boundary + 1);
    facts = await readGorgiasFacts(db, source, selection, stale);
    assert.equal(facts.status, 'unavailable'); assert.equal(facts.tickets.length, 1);
    assert.equal(handoverCount(facts, 'live')!.current, false);
    const display = (await readSourceHealth(db, undefined, {gorgias: selection, now: stale})).find(row => row.source === 'gorgias')!;
    assert.equal(display.status, 'error'); assert.match(display.statusText!, /△ Stale/);
    assert.equal((await db.query<{status: string}>("SELECT status FROM pulse.source_health WHERE source='gorgias'")).rows[0]!.status, 'healthy',
      'A display freshness check never writes or invents a source failure');
    await restoreGorgiasHealth(db, scope, stale, selection);
    assert.equal((await db.query<{status: string}>("SELECT status FROM pulse.source_health WHERE source='gorgias'")).rows[0]!.status, 'error');
  }
  const displayContext = {gorgias: settings(), now: new Date(+now + 60 * 60_000)};
  const failed = (await readSourceHealth(db, undefined, displayContext)).find(row => row.source === 'gorgias')!;
  assert.equal(failed.status, 'error'); assert.equal(failed.statusText, undefined, 'An existing failed status keeps precedence over the stale overlay');
  await syncSourceHealth(db, source);
  assert.equal((await readSourceHealth(db, undefined, displayContext)).find(row => row.source === 'gorgias')!.status, 'not_implemented',
    'A pending source is still pending until its selection is restored');
  await syncSourceHealth(db, {});
  const sample = (await readSourceHealth(db, undefined, displayContext)).find(row => row.source === 'gorgias')!;
  assert.equal(sample.mode, 'sample'); assert.equal(sample.status, 'waiting_for_keys'); assert.equal(sample.lastSuccessAt, null);
});

test('intent storage is nullable, keeps the last safe value and records only reads with a discovered field', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const source = env(), selection = settings(), scope = gorgiasScope(source.GORGIAS_DOMAIN, selection);
  await syncSourceHealth(db, source); await poll(db, scope, [row()]);
  const stored = async () => (await db.query<{ai_intent: string | null; checked: string | null}>(
    'SELECT ai_intent,ai_intent_checked_at::text AS checked FROM pulse.gorgias_tickets WHERE scope=$1 AND ticket_id=$2', [scope, row().id])).rows[0]!;
  assert.deepEqual(await stored(), {ai_intent: null, checked: null}, 'A pre-intent row and missing field remain nullable');
  const save = (aiIntent: string | null, intentFieldAvailable: boolean, at: Date) => saveGorgiasPoll(db, scope,
    {tickets: [row(undefined, {aiIntent})], closedThisWeek: 0, intentFieldAvailable},
    {weekStart: gorgiasWeekStart(at), finishedAt: at, nextRun: new Date(+at + 120_000)});
  await save('Order::Damaged::Discarded detail', true, now);
  assert.equal((await stored()).ai_intent, 'Order::Damaged', 'Only the first two validated levels reach storage');
  const checked = (await stored()).checked;
  assert.ok(checked);
  await save(null, false, new Date(+now + 120_000));
  assert.deepEqual(await stored(), {ai_intent: 'Order::Damaged', checked}, 'Missing discovery never clears or recertifies a stored intent');
  const at = new Date(+now + 240_000);
  await save(null, true, at);
  assert.equal((await stored()).ai_intent, 'Order::Damaged');
  assert.equal(new Date((await stored()).checked!).toISOString(), at.toISOString(), 'A present field with an empty value is checked');
  await save('Order::<script>', true, new Date(+at + 120_000));
  assert.equal((await stored()).ai_intent, 'Order::Damaged', 'An invalid value also preserves the last safe intent');
  assert.equal((await readGorgiasHistory(db, source, selection, at)).tickets[0]!.aiIntent, 'Order::Damaged');
  await saveGorgiasPoll(db, scope, {tickets: [row('81002', {aiIntent: 'Order::<script>'})], closedThisWeek: 0, intentFieldAvailable: true},
    {weekStart: gorgiasWeekStart(at), finishedAt: at, nextRun: at});
  assert.equal((await readGorgiasHistory(db, source, selection, at)).tickets.find(ticket => ticket.id === '81002')!.aiIntent, null);
});

test('intent backfill selects at most twenty oldest eligible rows in the current scope with UK month and 24-hour boundaries', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const source = env(), selection = settings(), scope = gorgiasScope(source.GORGIAS_DOMAIN, selection);
  const at = new Date('2032-05-07T12:00:00.000Z');
  const tickets = Array.from({length: 30}, (_, index) => row(String(82000 + index), {
    createdAt: index === 0 ? '2032-03-31T22:59:59.999Z' : index === 1 ? '2032-03-31T23:00:00.000Z'
      : new Date(Date.parse('2032-04-02T12:00:00.000Z') + index * 1000).toISOString(),
    inHandover: false, status: 'closed',
  }));
  await poll(db, scope, tickets, 0, at);
  await poll(db, gorgiasScope(source.GORGIAS_DOMAIN, {...selection, gorgiasHandoverViewId: '71002'}), [row('81999')], 0, at);
  await db.query('UPDATE pulse.gorgias_tickets SET ai_intent_checked_at=$2 WHERE scope=$1 AND ticket_id=$3',
    [scope, new Date(+at - 86_400_000), '82002']);
  await db.query('UPDATE pulse.gorgias_tickets SET ai_intent_checked_at=$2 WHERE scope=$1 AND ticket_id=$3',
    [scope, new Date(+at - 86_400_000 + 1), '82003']);
  await db.query('UPDATE pulse.gorgias_tickets SET ai_intent=$2 WHERE scope=$1 AND ticket_id=$3', [scope, 'Order::Damaged', '82004']);
  assert.deepEqual(await readGorgiasIntentBackfillIds(db, scope, at), ['82001', '82002', ...Array.from({length: 18}, (_, i) => String(82005 + i))]);
  assert.deepEqual((await readGorgiasIntentBackfillIds(db, scope, new Date(+at + 1))).slice(0, 3), ['82001', '82002', '82003'],
    'Exactly twenty-four hours is eligible; a more recent check is not');
  const yearEnd = new Date('2033-01-01T00:01:00.000Z');
  await poll(db, scope, [row('83001', {createdAt: '2032-11-30T23:59:59.999Z'}), row('83002', {createdAt: '2032-12-01T00:00:00.000Z'})], 0, yearEnd);
  assert.deepEqual(await readGorgiasIntentBackfillIds(db, scope, yearEnd), ['83002']);
});

test('intent-only backfill preserves retained ticket facts, weekly counts and other scopes, including a missing ticket check', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const source = env(), selection = settings(), scope = gorgiasScope(source.GORGIAS_DOMAIN, selection);
  const otherScope = gorgiasScope(source.GORGIAS_DOMAIN, {...selection, gorgiasHandoverViewId: '71002'});
  const retained = [row('84001', {status: 'closed', inHandover: false}), row('84002', {status: 'closed', inHandover: false}), row('84003')];
  await poll(db, scope, retained, 5); await poll(db, otherScope, [row('84001')], 2);
  const factRows = async () => (await db.query(`SELECT scope,ticket_id,status,channel,tags,in_handover,view_id,created_at,
    updated_at,last_customer_message_at,customer,subject,fetched_at FROM pulse.gorgias_tickets WHERE ticket_id IN ('84001','84002') ORDER BY scope,ticket_id`)).rows;
  const before = await factRows();
  const at = new Date(+now + 120_000);
  await saveGorgiasPoll(db, scope, {tickets: [row('84003')], closedThisWeek: 0, intentFieldAvailable: true},
    {weekStart: gorgiasWeekStart(at), finishedAt: at, nextRun: at});
  const weeklyWithoutBackfill = (await db.query('SELECT * FROM pulse.gorgias_weekly ORDER BY scope,week_start')).rows;
  await saveGorgiasPoll(db, scope, {tickets: [row('84003')], closedThisWeek: 0, intentFieldAvailable: true,
    intentBackfill: [{id: '84001', aiIntent: 'Shipping::Delivered Not Received', ...{status: 'open', inHandover: true, subject: 'Discard this', closedThisWeek: 99}},
      {id: '84002', aiIntent: null}, {id: '84999', aiIntent: 'Order::Damaged'}]},
  {weekStart: gorgiasWeekStart(at), finishedAt: at, nextRun: at});
  assert.deepEqual(await factRows(), before, 'Detail reads and 404s only enrich the two intent columns');
  assert.deepEqual((await db.query('SELECT * FROM pulse.gorgias_weekly ORDER BY scope,week_start')).rows, weeklyWithoutBackfill,
    'The same normal poll gives identical weekly rows with or without backfill');
  const checks = (await db.query<{ticket_id: string; ai_intent: string | null; checked: Date | string | null}>(
    'SELECT ticket_id,ai_intent,ai_intent_checked_at AS checked FROM pulse.gorgias_tickets WHERE scope=$1 ORDER BY ticket_id', [scope])).rows;
  assert.deepEqual(checks.map(item => [item.ticket_id, item.ai_intent, item.checked ? new Date(item.checked).toISOString() : null]), [
    ['84001', 'Shipping::Delivered Not Received', at.toISOString()], ['84002', null, at.toISOString()], ['84003', null, at.toISOString()],
  ]);
  assert.equal((await db.query('SELECT ai_intent_checked_at FROM pulse.gorgias_tickets WHERE scope=$1', [otherScope])).rows[0]!.ai_intent_checked_at, null);
  assert.equal((await readGorgiasFacts(db, source, selection, at)).closedThisWeek, 5);
  assert.equal((await readGorgiasFacts(db, source, selection, at)).openedThisWeek, 3);
  assert.deepEqual(await readGorgiasIntentBackfillIds(db, scope, new Date(+at + 86_400_000 - 1)), []);
  assert.deepEqual(await readGorgiasIntentBackfillIds(db, scope, new Date(+at + 86_400_000)), ['84002', '84003']);
});
