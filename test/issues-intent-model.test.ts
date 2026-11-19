import assert from 'node:assert/strict';
import test from 'node:test';
import {buildIssuesView, issuesNeeds, type IssueInputs, type IssueReview, type IssueTicket, type IssuesView} from '../src/issues/model.js';

// Every identity, text, date and count is invented.
const now = new Date('2032-04-18T12:00:00Z');
const current = '2032-04-07T12:00:00Z', previous = '2032-03-07T12:00:00Z';
const review = (id: string, body: string, createdAt = current): IssueReview => ({id, body, rating: 2, createdAt});
const ticket = (id: string, subject: string, aiIntent: string | null = null, createdAt = current, tags: string[] = []): IssueTicket =>
  ({id, subject, aiIntent, createdAt, tags});
const input = (reviews: IssueReview[] = [], tickets: IssueTicket[] = []): IssueInputs => ({dashboardMode: 'live',
  reviews: {mode: 'live', status: 'ready', checkedAt: now.toISOString(), rows: reviews},
  tickets: {mode: 'live', status: 'ready', checkedAt: now.toISOString(), rows: tickets, domain: 'invented-helpdesk'}});
const cases = (view: IssuesView) => view.rows.flatMap(row => row.cases);
const exclusionNotes = (view: IssuesView) => view.notes.filter(note => note.startsWith('Questions and requests left out, not problems: '));

test('joined cases choose tag mapping before intent before keywords while retaining the earliest month and review quote', () => {
  const facts = input([review('92001', 'Scratched slab #42001', previous), review('92002', 'Scratched slab #42002', previous)], [
    ticket('82001', 'Wrong item #42001', 'Shipping::Delivered Not Received'),
    ticket('82002', 'Wrong item #42002', 'Shipping::Delivered Not Received'),
    ticket('82003', 'New invented question #42002', 'Product::Availability', current, ['invented_fix']),
  ]);
  const view = buildIssuesView(facts, [{tag: 'invented_fix', reason: 'missing slab'}], now), observed = cases(view);
  assert.equal(observed.length, 2);
  const intent = observed.find(row => row.orderNumber === '42001')!;
  assert.equal(intent.reason, 'lost parcel'); assert.equal(intent.month, '2032-03');
  assert.equal(intent.createdAt, new Date(previous).toISOString()); assert.equal(intent.quote, 'Scratched slab #42001');
  assert.deepEqual(intent.sources, ['judgeme', 'gorgias']);
  assert.equal(observed.find(row => row.orderNumber === '42002')!.reason, 'missing slab', 'A mapped tag overrides even an excluded intent');
  assert.deepEqual(exclusionNotes(view), []);
});

test('equal-ranked evidence uses the earliest observation, independent of ticket input order', () => {
  const early = '2032-04-05T12:00:00Z', late = '2032-04-09T12:00:00Z';
  const facts = input([review('92001', 'Scratched slab #42001', early)], [
    ticket('82002', 'New invented question #42001', 'Order::Damaged', late),
    ticket('82001', 'New invented question #42001', 'Order::Missing Item', current),
    ticket('82004', 'New invented question #42002', 'Order::Damaged', late, ['invented_late']),
    ticket('82003', 'New invented question #42002', 'Order::Missing Item', current, ['invented_early']),
    ticket('82005', 'Missing slab #42003', null, late),
    ticket('82006', 'Wrong item #42003', 'Invented::Unknown', early),
  ]);
  const rules = [{tag: 'invented_late', reason: 'lost parcel' as const}, {tag: 'invented_early', reason: 'damaged box' as const}];
  const first = buildIssuesView(facts, rules, now);
  assert.deepEqual(cases(first).map(row => [row.orderNumber, row.reason]).sort(), [
    ['42001', 'missing item'], ['42002', 'damaged box'], ['42003', 'wrong item'],
  ]);
  facts.tickets.rows.reverse();
  assert.deepEqual(buildIssuesView(facts, rules, now).rows, first.rows);
});

test('quality intent refines its reason from subject and tags and still outranks a review keyword', () => {
  const facts = input([review('92001', 'Wrong item #42001', previous)], [
    ticket('82001', 'New invented question #42001', 'Product::Quality Issues', current, ['markers dried']),
    ticket('82002', 'Invented question', 'Product::Quality Issues'),
    ticket('82003', 'Wrong item', 'Invented::Unknown', current, ['markers dried']),
  ]);
  const observed = cases(buildIssuesView(facts, [], now));
  assert.equal(observed.find(row => row.orderNumber === '42001')!.reason, 'markers dried or faulty');
  assert.equal(observed.find(row => row.id === 'gorgias:82002')!.reason, 'other');
  assert.equal(observed.find(row => row.id === 'gorgias:82003')!.reason, 'wrong item', 'Unknown intent preserves the existing subject-only fallback');
});

test('an excluded earlier ticket cannot anchor a review month or contribute a ticket link or source', () => {
  const facts = input([review('92001', 'Scratched slab #42001')], [
    ticket('82001', 'Wrong item #42001', 'Order::Cancel', previous),
    ticket('82002', 'Wrong item #42002', 'Product::Availability'),
  ]);
  const view = buildIssuesView(facts, [], now), observed = cases(view);
  assert.equal(observed.length, 1);
  assert.equal(observed[0]!.month, '2032-04'); assert.equal(observed[0]!.reason, 'scratched slab');
  assert.deepEqual(observed[0]!.sources, ['judgeme']); assert.equal(observed[0]!.ticketHref, null);
  assert.deepEqual(exclusionNotes(view), ['Questions and requests left out, not problems: 1 this month, 1 last month.']);
  assert.doesNotMatch(JSON.stringify(view.rows), /82001|82002/);
});

test('excluded tickets do not turn reviews-only Watch evidence into ticket evidence requiring history', () => {
  const facts = input([review('92001', 'Scratched slab #42001'), review('92002', 'Scratched slab #42002'),
    review('92003', 'Scratched slab #42003')], [ticket('82001', 'Scratched slab #42001', 'Product::Details')]);
  const view = buildIssuesView(facts, [], now);
  assert.equal(view.ticketHistoryCoversLastMonth, false); assert.equal(issuesNeeds(view).length, 1);
  assert.equal(issuesNeeds(view)[0]!.id, 'issues-0');
  assert.equal(view.notes.some(note => note.includes('Watch needs involving')), false);
  assert.ok(cases(view).every(row => row.sources.length === 1 && row.sources[0] === 'judgeme'));
});

test('excluded counts are unique tickets in their own UK month, not orders, and omit invalid, future and older dates', () => {
  const facts = input([], [
    ticket('82001', 'Invented question #42001', 'Product::Availability', '2032-03-31T23:00:00Z'),
    ticket('82001', 'Repeated invented question', 'Product::Availability'),
    ticket('82002', 'Invented question #42001', 'Shipping::Information'),
    ticket('82003', 'Invented question', 'Product::Usage', '2032-03-31T22:59:59.999Z'),
    ticket('82004', 'Invented question', 'Product::Usage', '2032-02-07T12:00:00Z'),
    ticket('82005', 'Invented question', 'Product::Usage', '2032-05-07T12:00:00Z'),
    ticket('82006', 'Invented question', 'Product::Usage', 'invalid date'),
  ]);
  const view = buildIssuesView(facts, [], now);
  assert.equal(cases(view).length, 0);
  assert.deepEqual(exclusionNotes(view), ['Questions and requests left out, not problems: 2 this month, 1 last month.']);
  facts.tickets.rows = [ticket('82004', 'Invented question', 'Product::Usage', '2032-02-07T12:00:00Z')];
  assert.deepEqual(exclusionNotes(buildIssuesView(facts, [], now)), []);
});

test('excluded notes obey source mode and completed-read boundaries, and sample intent cases raise no needs', () => {
  const facts = input([], [ticket('82001', 'Invented question', 'Wholesale::Information')]);
  facts.tickets.mode = 'sample';
  assert.deepEqual(exclusionNotes(buildIssuesView(facts, [], now)), [], 'No sample exclusion count beside live reviews');
  facts.tickets.mode = 'live'; facts.tickets.status = 'pending';
  assert.deepEqual(exclusionNotes(buildIssuesView(facts, [], now)), [], 'Pending rows are not completed observations');
  facts.tickets.status = 'unavailable';
  const retained = buildIssuesView(facts, [], now);
  assert.equal(exclusionNotes(retained).length, 1); assert.deepEqual(issuesNeeds(retained), []);
  facts.dashboardMode = 'sample'; facts.reviews.mode = 'sample'; facts.tickets.mode = 'sample'; facts.tickets.status = 'ready';
  facts.tickets.rows.push(...['82002', '82003', '82004'].map(id => ticket(id, 'Invented question', 'Order::Damaged')));
  const sample = buildIssuesView(facts, [], now);
  assert.equal(sample.mode, 'sample'); assert.equal(exclusionNotes(sample).length, 1);
  assert.equal(sample.rows.find(row => row.reason === 'damaged box')!.current, 3); assert.deepEqual(issuesNeeds(sample), []);
});
