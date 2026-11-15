import assert from 'node:assert/strict';
import test from 'node:test';
import type { GorgiasFacts, GorgiasTicket } from '../src/gorgias/model.js';
import { gorgiasSectionHtml } from '../src/handover/gorgias-view.js';

// Every name, ID and time is invented; these are the allowed stored fields only.
const asOf = '2032-04-07T12:00:00.000Z';
function ticket(id: string, overrides: Partial<GorgiasTicket> = {}): GorgiasTicket {
  return {id, status: 'open', channel: 'email', tags: ['ai_handover'], inHandover: true, viewId: null,
    createdAt: '2032-04-06T10:00:00.000Z', updatedAt: '2032-04-07T09:00:00.000Z',
    lastCustomerMessageAt: '2032-04-07T00:00:00.000Z', customer: 'Mira P.', subject: 'An invented missing item', ...overrides};
}
function facts(tickets: GorgiasTicket[], overrides: Partial<GorgiasFacts> = {}): GorgiasFacts {
  return {mode: 'live', status: 'live', domain: 'invented-support', checkedAt: asOf, asOf,
    weekStart: '2032-04-04T23:00:00.000Z', openedThisWeek: 7, closedThisWeek: 3, tickets, ...overrides};
}

test('Customer service sorts by customer waiting time, omits closed/out-of-handover tickets and keeps all evidence local', () => {
  const html = gorgiasSectionHtml(facts([
    ticket('52001'), ticket('52002', {lastCustomerMessageAt: null, createdAt: '2032-04-05T10:00:00.000Z'}),
    ticket('52003', {lastCustomerMessageAt: '2032-04-06T09:00:00.000Z'}), ticket('52004', {status: 'closed'}),
    ticket('52005', {inHandover: false}),
  ]));
  assert.deepEqual(Array.from(html.matchAll(/data-gorgias-ticket="(\d+)"/g), match => match[1]), ['52002', '52003', '52001']);
  assert.match(html, /Oldest wait<\/dt><dd>2d 2h<\/dd>/);
  assert.match(html, /Opened this week<\/dt><dd>7<\/dd>/);
  assert.match(html, /Closed this week<\/dt><dd>At least 3<\/dd>/);
  assert.match(html, /ticket opened; customer message time not supplied/);
  assert.match(html, /This app only reads; reply in Gorgias/);
  assert.match(html, /Counts cover tickets observed in handover/);
  assert.match(html, /Closed is a minimum; reopened or deleted tickets can make the exact weekly total unavailable/);
});

test('Customer service uses the configured strict wait threshold and only validated live ticket links', () => {
  const html = gorgiasSectionHtml(facts([ticket('52001'), ticket('52002', {lastCustomerMessageAt: '2032-04-06T23:59:00.000Z'})]));
  assert.equal((html.match(/data-state="decide"/g) ?? []).length, 1);
  assert.equal((html.match(/data-state="info"/g) ?? []).length, 1);
  assert.match(html, /href="https:\/\/invented-support.gorgias.com\/app\/ticket\/52001" target="_blank" rel="noopener noreferrer"/);
  assert.doesNotMatch(gorgiasSectionHtml(facts([ticket('52001')]), 24), /data-state="decide"/);
  for (const bad of [facts([ticket('javascript:alert(1)')]), facts([ticket('52001')], {domain: 'evil.example/path'})]) {
    const rendered = gorgiasSectionHtml(bad);
    assert.doesNotMatch(rendered, /href="https:/);
    assert.match(rendered, /Ticket link unavailable/);
  }
});

test('four sample tickets are explicitly invented and never offer an outbound sample link', () => {
  const html = gorgiasSectionHtml(facts(['52001', '52002', '52003', '52004'].map(id => ticket(id)), {mode: 'sample', status: 'sample'}));
  assert.match(html, /Sample data · four invented tickets, names and times/);
  assert.equal((html.match(/data-gorgias-ticket=/g) ?? []).length, 4);
  assert.equal((html.match(/disabled>Sample ticket/g) ?? []).length, 4);
  assert.doesNotMatch(html, /href="https:/);
});

test('missing reads never claim an empty handover or invent weekly counts; failures retain visible facts', () => {
  for (const status of ['pending', 'unavailable'] as const) {
    const html = gorgiasSectionHtml(facts([], {status, checkedAt: null, openedThisWeek: null, closedThisWeek: null}));
    assert.match(html, /Awaiting read/);
    assert.doesNotMatch(html, /No customers waiting|<dd>0<\/dd>/);
  }
  const retained = gorgiasSectionHtml(facts([ticket('52001')], {status: 'unavailable', closedThisWeek: null}));
  assert.match(retained, /Showing the last successful read/);
  assert.match(retained, /data-gorgias-ticket="52001"/);
  assert.match(retained, /Closed this week<\/dt><dd>Awaiting read/);
});

test('rendering uses only minimized fields, escapes source text and folds the ticket tail without dropping it', () => {
  const safe = ticket('52001', {subject: '<img src=x onerror="alert(1)">'}) as GorgiasTicket & {body: string; email: string; fullName: string};
  safe.body = 'Invented confidential body'; safe.email = 'invented-person@example.invalid'; safe.fullName = 'Invented Full Name';
  const html = gorgiasSectionHtml(facts([safe, ...Array.from({length: 7}, (_, index) => ticket(String(52002 + index)))]));
  assert.equal((html.match(/data-gorgias-ticket=/g) ?? []).length, 8);
  assert.match(html, /⊕ 2 more tickets/);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.doesNotMatch(html, /<img src=x|Invented confidential body|invented-person@example.invalid|Invented Full Name/);
});
