import assert from 'node:assert/strict';
import test from 'node:test';
import {kitsPageView} from '../src/kits/page-model.js';
import {kitTimelineHtml, kitsPage} from '../src/kits/page-view.js';
import {sampleKitFacts} from '../src/kits/sample.js';
import {kitCardHtml, kitOrderHtml} from '../src/kits/view.js';

const now = new Date('2032-11-14T12:00:00Z');

test('Kits page uses the same card and order markup, without folding any kit or order', () => {
  const view = kitsPageView(sampleKitFacts(now), 'sample', now), html = kitsPage(view);
  assert.equal(view.cards.length, 6);
  assert.equal((html.match(/class="kit-card"/g) ?? []).length, 6);
  for (const card of view.cards) assert.ok(html.includes(kitCardHtml(card)), `Shared card for ${card.id}`);
  for (const group of view.orderGroups) for (const order of group.orders) assert.ok(html.includes(kitOrderHtml(order)));
  assert.equal((html.match(/data-kit-order>/g) ?? []).length, 8);
  assert.doesNotMatch(html, /data-kits-fold|data-kit-orders-toggle/);
  assert.match(html, /a supplier/);
  assert.match(html, /Sample data · invented kits and orders/);
  assert.match(html, /data-kits-page data-mode="sample" data-ready="true"/);
  assert.match(html, /<nav class="settings-nav" aria-label="Main">/);
  assert.match(html, /<dialog id="sheet" aria-labelledby="sh-title">/);
});

test('launch line exposes its exact range, ticks, year marks, launch and brief dates plus a text list', () => {
  const facts = sampleKitFacts(now);
  facts.kits.rows = facts.kits.rows.slice(0, 2);
  facts.kits.rows[0]!.launchTarget = '2033-03-08';
  facts.kits.rows[0]!.briefDue = '2032-12-05';
  facts.kits.rows[1]!.launchTarget = null;
  facts.kits.rows[1]!.briefDue = null;
  const timeline = kitsPageView(facts, 'sample', now).timeline!, html = kitTimelineHtml(timeline);
  assert.match(html, /data-start="2032-11-01" data-end="2033-03-31"/);
  assert.match(html, /data-kit-timeline-tick="2032-11-01"/);
  assert.match(html, /data-kit-timeline-tick="2033-01-01"/);
  assert.match(html, /data-kit-timeline-year="2032"/); assert.match(html, /data-kit-timeline-year="2033"/);
  assert.match(html, /data-kit-timeline-launch="box-a" data-date="2033-03-08"/);
  assert.match(html, /data-kit-timeline-brief="box-a" data-date="2032-12-05"/);
  assert.doesNotMatch(html, /data-kit-timeline-(?:launch|brief)="box-b"/);
  assert.match(html, /<strong>Box B<\/strong><span>Launch date not set/);
  assert.match(html, /data-kit-timeline-scroll tabindex="0" role="region" aria-label=/);
  assert.equal((html.match(/role="img"/g) ?? []).length, 1);
  assert.match(html, /data-kit-timeline-dates/);
  assert.match(html, /Launch 8 Mar 2033 · Brief due 5 Dec 2032/);
  assert.match(html, /data-kit-timeline-today="2032-11-14"/);
  assert.doesNotMatch(html, /style=|<style|<script/);
});

test('out-of-range dates get edge arrows and words, and coincident launches use separate lanes', () => {
  const facts = sampleKitFacts(now);
  facts.kits.rows = facts.kits.rows.slice(0, 3);
  facts.kits.rows[0]!.launchTarget = '2032-10-02';
  facts.kits.rows[1]!.launchTarget = '2032-12-10';
  facts.kits.rows[2]!.launchTarget = '2032-12-10';
  facts.kits.rows[2]!.briefDue = '2033-01-05';
  const html = kitTimelineHtml(kitsPageView(facts, 'sample', now).timeline!);
  assert.match(html, /data-kit-timeline-launch="box-a" data-date="2032-10-02" data-outside="before"[^]*?←[^]*?Box A · before the line/);
  assert.match(html, /data-kit-timeline-brief="box-c" data-date="2033-01-05" data-outside="after"[^]*?→[^]*?Brief due · after the line/);
  assert.match(html, /Launch 2 Oct 2032/); assert.match(html, /Brief due 5 Jan 2033/);
  const b = /data-kit-timeline-launch="box-b"[^]*?<circle cx="([^"]+)" cy="([^"]+)"/.exec(html)!;
  const c = /data-kit-timeline-launch="box-c"[^]*?<circle cx="([^"]+)" cy="([^"]+)"/.exec(html)!;
  assert.equal(b[1], c[1]); assert.notEqual(b[2], c[2]);
});

test('Kits page keeps sample kits and orders out of the live boundary and handles missing files quietly', () => {
  const facts = sampleKitFacts(now), suppressed = kitsPage(kitsPageView(facts, 'live', now));
  assert.match(suppressed, /Not set up yet/); assert.match(suppressed, /Orders not set up yet/);
  assert.doesNotMatch(suppressed, /Box [A-F]|a supplier|Sample data|data-kit-open|data-kit-timeline-launch/);
  facts.mode = 'live'; facts.kits.status = 'missing'; facts.kits.rows = [];
  const ordersOnly = kitsPage(kitsPageView(facts, 'live', now));
  assert.match(ordersOnly, /Not set up yet/); assert.match(ordersOnly, /data-kit-order-group="other"/);
  assert.equal((ordersOnly.match(/data-kit-order>/g) ?? []).length, 8);
  assert.doesNotMatch(ordersOnly, /data-kit-open/);
});

test('Kits page source strings stay escaped in cards, timeline names, date list and grouped orders', () => {
  const facts = sampleKitFacts(now), attack = '<script>alert("invented")</script>';
  facts.kits.rows[0]!.name = attack; facts.kits.rows[0]!.nextAction = attack;
  facts.orders.rows[0]!.kit = attack; facts.orders.rows[0]!.item = attack; facts.orders.rows[0]!.supplier = attack;
  const html = kitsPage(kitsPageView(facts, 'sample', now));
  assert.match(html, /&lt;script&gt;alert\(&quot;invented&quot;\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert|style=|onclick=|<style/);
  assert.equal((html.match(/<script /g) ?? []).length, 3, 'Only the fixed external browser, page and ticker assets');
});
