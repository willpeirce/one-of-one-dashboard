import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type {Auth} from '../src/auth.js';
import {defaultSettings} from '../src/settings.js';
import {sampleIssueCosts} from '../src/issues/costs-sample.js';
import {buildIssuesView, sampleIssuesView, type IssuesView} from '../src/issues/model.js';
import {buildIssueCasesPage, registerIssuesRoutes} from '../src/issues/routes.js';
import {issueCostsHtml, issuesCasesHtml, issuesSectionHtml, safeIssueTicketHref} from '../src/issues/view.js';

const now = new Date('2032-04-07T12:00:00Z');
const costs = () => sampleIssueCosts(defaultSettings(), now);

test('Issues shows both monthly counts, a Watch with words, and costs while keeping case quotes out of the first page', () => {
  const view = sampleIssuesView(now), html = issuesSectionHtml(view, costs());
  assert.match(html, /Sample data · invented cases and counts/);
  assert.equal((html.match(/data-issue-reason=/g) ?? []).length, 10);
  assert.match(html, /April 2032/); assert.match(html, /March 2032/);
  assert.match(html, /Scratched slab[\s\S]*?△ Watch[\s\S]*?data-issue-current>3<\/td><td data-issue-previous>1<\/td>/);
  assert.match(html, /Cost of fixes/); assert.match(html, /This month so far/); assert.match(html, /Read 7 Apr 13:00 UK/);
  assert.match(html, /actual fulfilment/); assert.match(html, /estimated fulfilment/);
  assert.doesNotMatch(html, /data-issue-quote|Order #41001|The invented slab has a scratch/);
  assert.match(html, /<dialog id="issues-sheet" aria-labelledby="issues-sheet-title"/);
});

test('Issues pending reads show unknown counts and suppress sample costs beside live cases', () => {
  const view = {...sampleIssuesView(now), mode: 'live' as const, status: 'pending' as const, notes: ['Waiting for the first successful read.'],
    rows: sampleIssuesView(now).rows.map(row => ({...row, current: 0, previous: 0, cases: []}))};
  const html = issuesSectionHtml(view, {...costs(), status: 'suppressed'});
  assert.equal((html.match(/data-issue-current>—/g) ?? []).length, 10);
  assert.doesNotMatch(html, /data-issue-current>0|data-issues-cost=|Sample data · invented cases|£/);
  assert.match(html, /Missing readings are not zero cases/); assert.match(html, /No sample replacement costs are mixed with live cases/);
  assert.match(issuesCasesHtml(buildIssueCasesPage(view, 'scratched slab')!), /Missing readings are not zero cases/);
});

test('row Watch badges use the same ticket-history and Other exclusions while case sheets stay unchanged', () => {
  const facts = {dashboardMode: 'live' as const,
    reviews: {mode: 'live' as const, status: 'ready' as const, rows: [], checkedAt: now.toISOString()},
    tickets: {mode: 'live' as const, status: 'ready' as const, domain: 'invented-helpdesk', historyCoversLastMonth: false,
      checkedAt: now.toISOString(), rows: Array.from({length: 6}, (_, index) => ({id: String(83001 + index),
        subject: index < 3 ? 'An invented slab is scratched' : 'An invented question', tags: [], createdAt: now.toISOString()}))}};
  const held = buildIssuesView(facts, [], now), heldHtml = issuesSectionHtml(held, costs());
  const button = (html: string, reason: string) => html.split(`data-issue-reason="${reason}"`)[1]!.split('</button>')[0]!;
  assert.doesNotMatch(button(heldHtml, 'scratched slab'), /△ Watch/);
  assert.doesNotMatch(button(heldHtml, 'other'), /△ Watch/);
  assert.match(heldHtml, /Watch needs involving handover tickets wait until stored ticket history covers the whole of last month\./);
  facts.tickets.historyCoversLastMonth = true;
  const complete = buildIssuesView(facts, [], now), completeHtml = issuesSectionHtml(complete, costs());
  assert.match(button(completeHtml, 'scratched slab'), /△ Watch/);
  assert.doesNotMatch(button(completeHtml, 'other'), /△ Watch/);
  assert.deepEqual(complete.rows, held.rows);
  for (const reason of ['scratched slab', 'other'] as const)
    assert.equal(issuesCasesHtml(buildIssueCasesPage(complete, reason)!), issuesCasesHtml(buildIssueCasesPage(held, reason)!));
});

test('unknown replacement cost components are not presented as complete totals or zero replacement orders', () => {
  const view = costs();
  view.mode = 'live'; view.status = 'unavailable';
  view.current = {...view.current, totalPence: null, knownPence: 620, complete: false, historyComplete: false,
    unknownLineCostOrders: 1, unknownFulfilmentOrders: 2};
  let html = issueCostsHtml(view);
  assert.match(html, /£6\.20 known/); assert.match(html, /△ Incomplete/);
  assert.match(html, /1 missing item costs/); assert.match(html, /2 missing fulfilment/); assert.match(html, /Order history incomplete/);
  view.current = {...view.current, orders: null, totalPence: null, knownPence: null, unknownClassificationOrders: 3};
  html = issueCostsHtml(view);
  assert.match(html, /3 orders awaiting replacement tags/); assert.match(html, /△ Replacement tags incomplete/);
  assert.doesNotMatch(html.split('data-issues-cost="2032-04"')[1]!.split('</article>')[0]!, /0 replacement orders|£0/);
});

test('case sheets escape short quotes and references, omit reviewer fields and allow only safe Gorgias ticket links', () => {
  const view = sampleIssuesView(now), page = buildIssueCasesPage(view, 'scratched slab')!;
  page.mode = 'live';
  const row = page.cases[0]!;
  row.reference = '<script>invented</script>';
  row.quote = '<script>invented</script>' + '📦'.repeat(150);
  row.ticketHref = 'https://invented-helpdesk.gorgias.com/app/ticket/81001';
  row.sources = ['judgeme', 'gorgias'];
  Object.assign(row, {reviewerName: 'Invented reviewer sentinel', customerName: 'Invented customer sentinel'});
  const html = issuesCasesHtml(page);
  assert.doesNotMatch(html, /<script>|Invented reviewer sentinel|Invented customer sentinel/);
  assert.match(html, /&lt;script&gt;invented&lt;\/script&gt;/);
  assert.match(html, /data-issue-ticket>Open ticket/);
  const quote = html.match(/data-issue-quote>(.*?)<\/blockquote>/)![1]!;
  assert.equal((quote.match(/📦/gu) ?? []).length, 120 - '<script>invented</script>'.length);
  assert.doesNotMatch(issuesCasesHtml({...page, mode: 'sample'}), /data-issue-ticket|href="https:/);
  for (const href of ['javascript:alert(1)', 'http://invented.gorgias.com/app/ticket/81001', 'https://elsewhere.example.test/app/ticket/81001',
    'https://name:pass@invented.gorgias.com/app/ticket/81001', 'https://invented.gorgias.com:444/app/ticket/81001',
    'https://invented.gorgias.com/app/ticket/81001?access_token=invented', 'https://invented.gorgias.com/app/ticket/81001#extra',
    'https://invented.gorgias.com/app/ticket/not-an-id']) assert.equal(safeIssueTicketHref(href), null);
  assert.equal(safeIssueTicketHref(row.ticketHref), row.ticketHref);
});

function manyCases(): IssuesView {
  return buildIssuesView({dashboardMode: 'live', reviews: {mode: 'live', status: 'ready', checkedAt: now.toISOString(),
    rows: Array.from({length: 121}, (_, index) => ({id: String(91000 + index), rating: 2,
      body: `An invented scratched slab. Order #${41000 + index}.`, createdAt: index < 71 ? '2032-04-03T12:00:00Z' : '2032-03-03T12:00:00Z'}))},
    tickets: {mode: 'sample', status: 'ready', rows: [], domain: 'invented-helpdesk'}}, [], now);
}

test('case pages retain full counts, preserve order and cap every response at fifty cases', () => {
  const view = manyCases(), row = view.rows.find(row => row.reason === 'scratched slab')!;
  const pages = [0, 50, 100].map(offset => buildIssueCasesPage(view, 'scratched slab', offset)!);
  assert.deepEqual(pages.map(page => page.cases.length), [50, 50, 21]);
  assert.deepEqual(pages.map(page => page.nextOffset), [50, 100, null]);
  assert.ok(pages.every(page => page.current === 71 && page.previous === 50 && page.total === 121));
  assert.equal(new Set(pages.map(page => page.version)).size, 1);
  assert.deepEqual(pages.flatMap(page => page.cases), row.cases);
  assert.equal(buildIssueCasesPage(view, 'scratched slab', 1), null);
  assert.equal(buildIssueCasesPage(view, 'scratched slab', 150), null);
  assert.match(issuesCasesHtml(pages[0]!), /50 of 121 cases shown/);
  assert.match(issuesCasesHtml(pages[0]!), /Load more to see this month’s cases/);
});

test('case routes authenticate before reading, validate bounded pages and reject changed content before a now-invalid offset', async t => {
  const app = Fastify({logger: false}); t.after(() => app.close());
  let signedIn = false, reads = 0, view = manyCases(), fail = false;
  registerIssuesRoutes(app, {session: async () => signedIn ? 'invented-credential' : null} as unknown as Auth,
    async () => {reads++; if (fail) throw new Error('Invented private source detail'); return view;});
  const path = '/api/issues/scratched%20slab';
  assert.equal((await app.inject(path)).statusCode, 401); assert.equal(reads, 0);
  signedIn = true;
  assert.equal((await app.inject('/api/issues/not-a-reason')).statusCode, 404); assert.equal(reads, 0);
  for (const query of ['?offset=-1', '?offset=1', '?offset=1.5', '?offset=50', '?limit=500', '?offset=0&extra=1', '?offset=0&version=short'])
    assert.equal((await app.inject(path + query)).statusCode, 400);
  assert.equal(reads, 0);
  const first = (await app.inject(path)).json<NonNullable<ReturnType<typeof buildIssueCasesPage>>>();
  assert.equal(first.cases.length, 50);
  const second = (await app.inject(`${path}?offset=50&version=${first.version}`)).json<typeof first>();
  assert.equal(second.cases.length, 50); assert.equal(second.nextOffset, 100);
  view = {...view, rows: view.rows.map(row => ({...row, current: 0, previous: 0, cases: []}))};
  assert.equal((await app.inject(`${path}?offset=50&version=${first.version}`)).statusCode, 409);
  fail = true;
  const unavailable = await app.inject(path);
  assert.equal(unavailable.statusCode, 503); assert.doesNotMatch(unavailable.body, /private source detail/);
});
