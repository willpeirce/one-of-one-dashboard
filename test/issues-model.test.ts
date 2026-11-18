import assert from 'node:assert/strict';
import test from 'node:test';
import {classifyIssue, issueClassification} from '../src/issues/keywords.js';
import {buildIssuesView, ISSUE_REASONS, issueDoubled, issueMonths, issueOrderNumber, issuesNeeds, sampleIssuesView,
  type IssueInputs, type IssueReview, type IssuesView} from '../src/issues/model.js';
import {parseGorgiasTicket, scrubGorgiasText} from '../src/gorgias/privacy.js';

const now = new Date('2032-04-18T12:00:00Z');
const current = '2032-04-07T12:00:00Z', previous = '2032-03-07T12:00:00Z';
const review = (id: string, body = 'An invented slab is scratched', createdAt = current): IssueReview => ({id, body, createdAt, rating: 2});
const input = (rows: IssueReview[] = []): IssueInputs => ({dashboardMode: 'live',
  reviews: {mode: 'live', status: 'ready', rows, checkedAt: now.toISOString()},
  tickets: {mode: 'live', status: 'ready', rows: [], checkedAt: now.toISOString(), domain: 'invented-helpdesk'}});
const cases = (view: IssuesView) => view.rows.flatMap(row => row.cases);
const total = (view: IssuesView) => view.rows.reduce((sum, row) => sum + row.current + row.previous, 0);

test('one keyword file classifies every issue reason and tag rules take explicit, deterministic precedence', () => {
  const texts = ['The slab has scratches', 'There is no slab in this kit', 'An invented item was left out', 'The wrong item arrived',
    'The box arrived crushed', 'The parcel was delayed', 'The parcel never arrived', "The QR won't register", 'The markers have dried out',
    'An invented question about this kit'];
  assert.deepEqual(texts.map(text => classifyIssue(text)), [...ISSUE_REASONS]);
  assert.equal(classifyIssue('Missing slab and missing item'), 'missing slab');
  assert.equal(classifyIssue('The missing parcel is overdue'), 'lost parcel');
  const rules = [{tag: ' Invented Slab ', reason: 'scratched slab' as const}, {tag: 'invented_box', reason: 'damaged box' as const}];
  assert.deepEqual(issueClassification('Wrong item', [' INVENTED_BOX ', 'invented slab'], rules), {reason: 'scratched slab', mapped: true});
  assert.deepEqual(issueClassification('Wrong item', ['unmapped'], rules), {reason: 'wrong item', mapped: false});
});

test('only one explicit four- or five-digit order marker permits a join', () => {
  for (const text of ['#4101', '#41001', 'Order #41001. Again #41001']) assert.equal(issueOrderNumber(text), text.includes('41001') ? '41001' : '4101');
  for (const text of ['41001', '#410', '#410001', '#41001x', '#41001_2', '#41001-6789', '#41001/2', '#41001.2', '##41001', '#41001 and #41002'])
    assert.equal(issueOrderNumber(text), null, text);
});

test('explicit order markers survive Gorgias privacy scrubbing while ZIP, phone, address and contact details do not', () => {
  const text = 'Order #41001 and #4101; ZIP 41001; postal #41001-6789; phone #41001 67890; longer #410001; hidden@example.invalid; 27 Invented Road; AB1 2CD';
  const clean = scrubGorgiasText(text, [], 1000);
  assert.match(clean, /Order #41001 and #4101/);
  assert.doesNotMatch(clean, /ZIP 41001|41001-6789|41001 67890|410001|hidden@|Invented Road|AB1/);
  const ticket = parseGorgiasTicket({id: 81001, status: 'open', tags: [], created_datetime: current,
    subject: 'Invented Surname: scratched slab for #41001', customer: {name: 'Invented Surname'},
    messages: [{body_text: 'Do not retain this body'}]}, {inHandover: true, viewId: null});
  assert.match(ticket.subject, /#41001/); assert.doesNotMatch(ticket.subject, /Invented Surname/);
  assert.equal('messages' in ticket, false);
});

test('reviews and tickets each count once; one order joins across sources and mapped ticket reason wins', () => {
  const facts = input([review('91001', 'Scratched slab #41001'), review('91001', 'Wrong item #41002'),
    review('91002', 'Damaged box #41001'), review('91003', 'Wrong item #41002')]);
  facts.tickets.rows = [{id: '81001', subject: 'Missing slab #41001', tags: ['invented_tag'], createdAt: current},
    {id: '81001', subject: 'Lost parcel #41003', tags: [], createdAt: current}];
  const view = buildIssuesView(facts, [{tag: 'invented_tag', reason: 'missing slab'}], now);
  assert.equal(total(view), 2);
  const joined = cases(view).find(row => row.orderNumber === '41001')!;
  assert.equal(joined.reason, 'missing slab'); assert.deepEqual(joined.sources, ['judgeme', 'gorgias']);
  assert.equal(joined.quote, 'Scratched slab #41001');
  assert.equal(joined.ticketHref, 'https://invented-helpdesk.gorgias.com/app/ticket/81001');
  assert.equal(cases(view).find(row => row.orderNumber === '41002')!.reason, 'wrong item');
});

test('dedup happens over all retained history before month filtering and never guesses between two order numbers', () => {
  const facts = input([review('91001', 'Scratched slab #41001', '2032-02-07T12:00:00Z'), review('91002', 'Scratched slab #41002', previous),
    review('91003', 'Wrong items #41003 and #41004')]);
  facts.tickets.rows = [{id: '81001', subject: 'Scratched slab #41001', tags: [], createdAt: current},
    {id: '81002', subject: 'Missing slab #41002', tags: [], createdAt: current},
    {id: '81003', subject: 'Wrong items #41003 and #41004', tags: [], createdAt: current}];
  const view = buildIssuesView(facts, [], now);
  assert.equal(cases(view).some(row => row.orderNumber === '41001'), false, 'An older case cannot become new through a later ticket');
  assert.equal(cases(view).find(row => row.orderNumber === '41002')!.month, '2032-03');
  assert.equal(cases(view).filter(row => row.orderNumber === null).length, 2, 'Ambiguous text keeps each observation separate');
});

test('quotes are bounded by Unicode points, project no reviewer identity and never include ticket bodies', () => {
  const facts = input([{...review('91001', 'Scratched slab. ' + '🟣'.repeat(150)), reviewer_name: 'Invented Identity Sentinel'} as IssueReview,
    review('91002', 'Wrong item <script>hidden()</script> hidden@example.invalid 555-123-4567')]);
  facts.tickets.rows = [{id: '81001', subject: 'Missing slab', tags: [], createdAt: current,
    customer: 'Invented Customer Sentinel', body: 'Invented body sentinel'} as IssueInputs['tickets']['rows'][number]];
  const view = buildIssuesView(facts, [], now), serialized = JSON.stringify(view);
  assert.equal(Array.from(cases(view).find(row => row.id === 'judgeme:91001')!.quote!).length, 120);
  assert.doesNotMatch(serialized, /Identity Sentinel|Customer Sentinel|body sentinel|reviewer_name|hidden@example|555-123-4567|<script>/);
  assert.equal(cases(view).find(row => row.id === 'gorgias:81001')!.quote, null);
  facts.tickets.domain = 'invented-helpdesk/elsewhere';
  assert.equal(cases(buildIssuesView(facts, [], now)).find(row => row.id === 'gorgias:81001')!.ticketHref, null);
});

test('only low-star reviews with valid past dates count, and month boundaries follow UK time across clocks and year end', () => {
  assert.deepEqual(issueMonths(new Date('2032-12-31T23:59:59Z')), {thisMonth: '2032-12', lastMonth: '2032-11'});
  assert.deepEqual(issueMonths(new Date('2033-01-01T00:00:00Z')), {thisMonth: '2033-01', lastMonth: '2032-12'});
  assert.deepEqual(issueMonths(new Date('2032-03-31T23:30:00Z')), {thisMonth: '2032-04', lastMonth: '2032-03'});
  assert.deepEqual(issueMonths(new Date('2032-10-31T23:30:00Z')), {thisMonth: '2032-10', lastMonth: '2032-09'});
  const rows = [review('91001', undefined, '2032-03-31T23:30:00Z'), review('91002', undefined, '2032-03-31T22:30:00Z'),
    review('91003', undefined, 'not a date'), review('91004', undefined, '2032-05-01T00:00:00Z'),
    {...review('91005'), rating: 4}, {...review('91006'), rating: 5}, {...review('91007'), rating: 0}];
  const row = buildIssuesView(input(rows), [], now).rows[0]!;
  assert.equal(row.current, 1); assert.equal(row.previous, 1);
});

test('trend needs start at three cases and doubling, include only five references and certify their read scope', () => {
  assert.deepEqual([[2, 0], [3, 0], [3, 1], [3, 2], [4, 2]].map(([a, b]) => issueDoubled(a!, b!)), [false, true, true, false, true]);
  const view = buildIssuesView(input(Array.from({length: 6}, (_, index) => review(String(91001 + index)))), [], now);
  const needs = issuesNeeds(view); assert.equal(needs.length, 1);
  assert.equal(needs[0]!.id, 'issues-0'); assert.equal(needs[0]!.state, 'warn'); assert.equal(needs[0]!.link, '/handover');
  assert.equal(needs[0]!.readScope, 'needs:issues'); assert.equal((needs[0]!.why.match(/Review #/g) ?? []).length, 5);
  assert.deepEqual(issuesNeeds({...view, mode: 'sample'}), []);
  assert.deepEqual(issuesNeeds({...view, status: 'unavailable'}), []);
  assert.deepEqual(issuesNeeds({...view, status: 'pending'}), []);
});

test('sample fixtures are labelled and never join live evidence; live Gorgias remains live beside sample Shopify', () => {
  const sample = sampleIssuesView(new Date('2032-04-01T00:01:00Z'));
  assert.equal(sample.mode, 'sample'); assert.equal(sample.status, 'ready'); assert.equal(total(sample), 6);
  assert.equal(sample.rows[0]!.current, 3); assert.equal(sample.rows[0]!.previous, 1); assert.deepEqual(issuesNeeds(sample), []);
  assert.match(sample.notes[0]!, /Sample/); assert.ok(cases(sample).every(row => row.ticketHref === null));
  const facts = input([review('91001')]); facts.reviews.mode = 'sample'; facts.tickets.mode = 'sample';
  let view = buildIssuesView(facts, [], now); assert.equal(view.mode, 'live'); assert.equal(view.status, 'pending'); assert.equal(total(view), 0);
  facts.dashboardMode = 'sample'; facts.tickets.mode = 'live';
  facts.tickets.rows = [{id: '81001', subject: 'Missing slab', tags: [], createdAt: current}];
  view = buildIssuesView(facts, [], now); assert.equal(view.mode, 'live'); assert.equal(total(view), 1);
  assert.equal(view.rows[0]!.current, 0); assert.equal(view.rows[1]!.current, 1);
  facts.reviews.mode = 'live'; facts.reviews.status = 'pending';
  view = buildIssuesView(facts, [], now); assert.equal(view.status, 'unavailable'); assert.equal(total(view), 1);
  facts.reviews.status = 'unavailable'; facts.reviews.checkedAt = previous;
  view = buildIssuesView(facts, [], now); assert.equal(view.status, 'unavailable'); assert.equal(total(view), 2);
  assert.equal(view.checkedAt, previous); assert.deepEqual(issuesNeeds(view), []);
});
