import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import test from 'node:test';
import type {Database} from '../src/db.js';
import {defaultSettings} from '../src/settings.js';
import {syncSourceHealth} from '../src/sources.js';
import {readIssues} from '../src/issues/store.js';
import {issuesNeeds} from '../src/issues/model.js';
import {saveReviews, dismissReviews} from '../src/judgeme/store.js';
import type {Review} from '../src/judgeme/model.js';
import {REVIEW_POLL_MS} from '../src/judgeme/worker.js';
import {gorgiasScope} from '../src/gorgias/scope.js';
import {gorgiasWeekStart, type GorgiasTicket} from '../src/gorgias/model.js';
import {saveGorgiasPoll} from '../src/gorgias/store.js';
import {createTestDatabase} from './helpers/database.js';

const now = new Date('2032-04-18T12:00:00Z');
const env = (gorgias = false): NodeJS.ProcessEnv => {
  const domain = `invented-${randomBytes(6).toString('hex')}`, email = `reader-${randomBytes(6).toString('hex')}@example.invalid`;
  return {JUDGEME_API_TOKEN: randomBytes(32).toString('hex'),
    ...(gorgias ? {GORGIAS_DOMAIN: domain, GORGIAS_EMAIL: email, GORGIAS_API_KEY: randomBytes(32).toString('hex')} : {})};
};
const review = (id: string, overrides: Partial<Review> = {}): Review => ({id, rating: 2, productTitle: 'Invented kit', productHandle: 'invented-kit',
  market: null, verifiedBuyer: false, photoCount: 0, body: 'The invented slab is scratched', createdAt: '2032-04-07T12:00:00Z',
  published: false, hidden: false, flagged: false, source: null, curated: 'ok', ...overrides});
const ticket = (id: string, overrides: Partial<GorgiasTicket> = {}): GorgiasTicket => ({id, status: 'open', channel: 'email',
  tags: [], inHandover: true, viewId: null, createdAt: '2032-04-08T12:00:00Z', updatedAt: now.toISOString(),
  lastCustomerMessageAt: now.toISOString(), customer: 'Invented C.', subject: 'An invented missing item', ...overrides});

test('Issues reads every retained low-star review regardless of Home dismissal or moderation, with no writes or outbound reads', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const source = env(), settings = defaultSettings(); await syncSourceHealth(db, source);
  await saveReviews(db, [review('91001', {published: true}), review('91002', {hidden: true}), review('91003'), review('91004', {rating: 4})], now);
  await dismissReviews(db, ['91003']);
  const readOnly: Database = {query: (text, values) => {
    assert.match(text.trim(), /^SELECT\b/); assert.doesNotMatch(text, /reviewer|customer|product_title|product_handle/);
    return db.query(text, values);
  }, transaction: async () => {throw new Error('Issues never writes');}, close: async () => {}};
  const view = await readIssues(readOnly, source, settings, now, 'live');
  assert.equal(view.mode, 'live'); assert.equal(view.status, 'ready'); assert.equal(view.checkedAt, now.toISOString());
  assert.equal(view.rows[0]!.current, 3); assert.equal(issuesNeeds(view).length, 1);
  assert.equal(view.rows.flatMap(row => row.cases).length, 3); assert.doesNotMatch(JSON.stringify(view), /Invented kit|productTitle/);
  assert.ok(view.notes.some(note => note.includes('Gorgias') && note.includes('sample cases are excluded')));
});

test('Issues uses the full retained Gorgias history, tag classification and earliest stored order evidence before month filtering', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const source = env(true), settings = {...defaultSettings(), gorgiasIssueTags: [{tag: 'invented_rule', reason: 'damaged box' as const}]};
  await syncSourceHealth(db, source);
  await saveReviews(db, [review('91001', {body: 'Scratched slab #41001', createdAt: '2032-02-07T12:00:00Z'}),
    review('91002', {body: 'Scratched slab #41002', createdAt: '2032-03-07T12:00:00Z'})], now);
  const scope = gorgiasScope(source.GORGIAS_DOMAIN!, settings);
  await saveGorgiasPoll(db, scope, {tickets: [ticket('81001', {subject: 'Missing slab #41001'}),
    ticket('81002', {subject: 'Missing slab #41002', tags: ['invented_rule']}), ticket('81003')], closedThisWeek: 0},
  {finishedAt: now, weekStart: gorgiasWeekStart(now), nextRun: new Date(+now + 600_000)});
  await saveGorgiasPoll(db, scope, {tickets: [], closedThisWeek: 0},
    {finishedAt: now, weekStart: gorgiasWeekStart(now), nextRun: new Date(+now + 600_000)});
  const view = await readIssues(db, source, settings, now, 'live'), cases = view.rows.flatMap(row => row.cases);
  assert.equal(view.status, 'ready'); assert.equal(cases.length, 2);
  assert.equal(cases.some(row => row.orderNumber === '41001'), false);
  assert.equal(cases.find(row => row.orderNumber === '41002')!.reason, 'damaged box');
  assert.equal(cases.find(row => row.orderNumber === '41002')!.month, '2032-03');
  assert.ok(cases.some(row => row.id === 'gorgias:81003'), 'Departed handover tickets remain observed issue history');
  assert.doesNotMatch(JSON.stringify(view), /Invented C\.|customer|lastCustomerMessageAt/);
});

test('stale, failed, future and partial review reads retain cases but cannot certify trend needs or clearing', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const source = env(), settings = defaultSettings(), rows = [review('91001'), review('91002'), review('91003')];
  await syncSourceHealth(db, source);
  let view = await readIssues(db, source, settings, now, 'live');
  assert.equal(view.status, 'pending'); assert.equal(view.checkedAt, null);
  await saveReviews(db, rows, now);
  view = await readIssues(db, source, settings, new Date(+now + 3 * REVIEW_POLL_MS), 'live');
  assert.equal(view.status, 'ready'); assert.equal(issuesNeeds(view).length, 1);
  view = await readIssues(db, source, settings, new Date(+now + 3 * REVIEW_POLL_MS + 1), 'live');
  assert.equal(view.status, 'unavailable'); assert.equal(view.rows[0]!.current, 3); assert.deepEqual(issuesNeeds(view), []);
  await db.query("UPDATE pulse.source_health SET status='error' WHERE source='judgeme'");
  view = await readIssues(db, source, settings, now, 'live'); assert.equal(view.status, 'unavailable');
  await saveReviews(db, rows, now, 1);
  view = await readIssues(db, source, settings, now, 'live');
  assert.equal(view.status, 'unavailable'); assert.equal(view.rows[0]!.current, 3);
  assert.ok(view.notes.some(note => note.includes('incomplete'))); assert.deepEqual(issuesNeeds(view), []);
  await saveReviews(db, rows, new Date(+now + 1));
  view = await readIssues(db, source, settings, now, 'live');
  assert.equal(view.status, 'unavailable'); assert.equal(view.checkedAt, null); assert.deepEqual(issuesNeeds(view), []);
});

test('sample Issues never reads the database, while a live dashboard never inherits sample cases', async () => {
  const db: Database = {query: async () => {throw new Error('No source or database read without keys');},
    transaction: async () => {throw new Error('No write');}, close: async () => {}};
  const sample = await readIssues(db, {}, defaultSettings(), now, 'sample');
  assert.equal(sample.mode, 'sample'); assert.equal(sample.rows[0]!.current, 3); assert.deepEqual(issuesNeeds(sample), []);
  const live = await readIssues(db, {}, defaultSettings(), now, 'live');
  assert.equal(live.mode, 'live'); assert.equal(live.status, 'pending'); assert.equal(live.rows.flatMap(row => row.cases).length, 0);
});

test('live Gorgias with sample Shopify excludes sample reviews, and a newly configured unread source prevents a ready certificate', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const source = env(true), settings = defaultSettings(); delete source.JUDGEME_API_TOKEN;
  await syncSourceHealth(db, source);
  await saveGorgiasPoll(db, gorgiasScope(source.GORGIAS_DOMAIN!, settings), {tickets: [ticket('81001')], closedThisWeek: 0},
    {finishedAt: now, weekStart: gorgiasWeekStart(now), nextRun: new Date(+now + 600_000)});
  const live = await readIssues(db, source, settings, now, 'sample');
  assert.equal(live.mode, 'live'); assert.equal(live.status, 'ready'); assert.equal(live.rows.flatMap(row => row.cases).length, 1);
  const pending = await readIssues(db, {...source, JUDGEME_API_TOKEN: randomBytes(32).toString('hex')}, settings, now, 'sample');
  assert.equal(pending.status, 'unavailable'); assert.equal(pending.rows.flatMap(row => row.cases).length, 1); assert.deepEqual(issuesNeeds(pending), []);
});

test('ticket-fed Watch needs wait for the current handover scope to have observed the whole earlier month', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const source = env(true), settings = defaultSettings(); delete source.JUDGEME_API_TOKEN;
  await syncSourceHealth(db, source);
  const scope = gorgiasScope(source.GORGIAS_DOMAIN!, settings), rows = [ticket('83001'), ticket('83002'), ticket('83003')];
  const poll = async (selected: string, at: Date, tickets: GorgiasTicket[] = []) => saveGorgiasPoll(db, selected,
    {tickets, closedThisWeek: 0}, {finishedAt: at, weekStart: gorgiasWeekStart(at), nextRun: new Date(+at + 600_000)});
  const readOnly: Database = {query: (text, values) => {
    assert.match(text.trim(), /^SELECT\b/, 'The history guard reads existing rows only'); return db.query(text, values);
  }, transaction: async () => {throw new Error('Issues never writes');}, close: async () => {}};
  await poll(scope, now, rows);
  let view = await readIssues(readOnly, source, settings, now, 'live');
  assert.deepEqual(issuesNeeds(view), []);
  assert.equal(view.ticketHistoryCoversLastMonth, false);
  await poll(scope, new Date('2032-03-10T12:00:00Z'));
  for (const unrelated of [gorgiasScope(`another-${source.GORGIAS_DOMAIN}`, settings),
    gorgiasScope(source.GORGIAS_DOMAIN!, {...settings, gorgiasHandoverTag: 'invented-other'}),
    gorgiasScope(source.GORGIAS_DOMAIN!, {...settings, gorgiasHandoverViewId: '84001'})])
    await poll(unrelated, new Date('2032-02-28T12:00:00Z'));
  await poll(scope, now, rows);
  view = await readIssues(readOnly, source, settings, now, 'live');
  const observed = view.rows;
  assert.equal(view.status, 'ready'); assert.equal(view.rows.find(row => row.reason === 'missing item')!.current, 3);
  assert.equal(view.ticketHistoryCoversLastMonth, false, 'Other accounts, tags and views cannot certify this scope');
  assert.deepEqual(issuesNeeds(view), []);
  assert.equal(view.notes.filter(note => note.includes('Watch needs involving')).length, 1);
  await poll(scope, new Date('2032-02-28T12:00:00Z'));
  await poll(scope, now, rows);
  view = await readIssues(readOnly, source, settings, now, 'live');
  assert.equal(view.ticketHistoryCoversLastMonth, true);
  assert.deepEqual(view.rows, observed);
  assert.deepEqual(issuesNeeds(view).map(need => need.id), ['issues-2']);
  assert.equal(view.notes.some(note => note.includes('Watch needs involving')), false);
});

test('ticket history uses the saved observation at UK month start, not the earlier Monday label', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const source = env(true), settings = defaultSettings(); delete source.JUDGEME_API_TOKEN;
  await syncSourceHealth(db, source);
  const at = new Date('2032-05-18T12:00:00Z'), boundary = new Date('2032-03-31T23:00:00Z');
  const scope = gorgiasScope(source.GORGIAS_DOMAIN!, settings), rows = ['83001', '83002', '83003'].map(id =>
    ticket(id, {createdAt: '2032-05-07T12:00:00Z', updatedAt: at.toISOString(), lastCustomerMessageAt: at.toISOString()}));
  const poll = async (when: Date, tickets: GorgiasTicket[] = []) => saveGorgiasPoll(db, scope,
    {tickets, closedThisWeek: 0}, {finishedAt: when, weekStart: gorgiasWeekStart(when), nextRun: new Date(+when + 600_000)});
  await poll(new Date(+boundary + 1));
  await poll(at, rows);
  const first = (await db.query<{week_start: string}>(
    'SELECT week_start::text FROM pulse.gorgias_weekly WHERE scope=$1 ORDER BY week_start LIMIT 1', [scope])).rows[0]!;
  assert.ok(first.week_start < '2032-04-01', 'The week label precedes the first actual observation');
  let view = await readIssues(db, source, settings, at, 'live');
  assert.equal(view.lastMonth, '2032-04'); assert.equal(view.ticketHistoryCoversLastMonth, false);
  assert.deepEqual(issuesNeeds(view), []);
  await poll(boundary);
  await poll(at, rows);
  view = await readIssues(db, source, settings, at, 'live');
  assert.equal(view.ticketHistoryCoversLastMonth, true, 'UK midnight is the prior UTC evening during BST');
  assert.equal(issuesNeeds(view).length, 1);
  await poll(new Date(+boundary + 86_400_000));
  await poll(at, rows);
  view = await readIssues(db, source, settings, at, 'live');
  assert.equal(view.ticketHistoryCoversLastMonth, false,
    'An overwritten first-week read cannot prove an earlier first observation that the store no longer retains');
  assert.deepEqual(issuesNeeds(view), []);
});
