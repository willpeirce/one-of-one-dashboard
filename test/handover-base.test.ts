import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { HandoverSections } from '../src/handover/sections.js';
import { registerHandover } from '../src/handover/routes.js';
import { handoverPage } from '../src/handover/view.js';

test('Handover authenticates before loading any section', async () => {
  const app = Fastify(), sections = new HandoverSections();
  let signedIn = false, reads = 0;
  sections.register({id: 'invented-section', title: 'Invented section', load: async () => {reads++; return '<p>Invented private observation</p>';}});
  registerHandover(app, {session: async () => signedIn ? 'invented-device' : null}, sections);
  try {
    const unsigned = await app.inject({method: 'GET', url: '/handover'});
    assert.equal(unsigned.statusCode, 302);
    assert.equal(unsigned.headers.location, '/login');
    assert.equal(reads, 0);
    assert.doesNotMatch(unsigned.body, /Invented private observation/);
    signedIn = true;
    const signed = await app.inject({method: 'GET', url: '/handover'});
    assert.equal(signed.statusCode, 200);
    assert.match(signed.headers['content-type'] ?? '', /text\/html/);
    assert.equal(reads, 1);
    assert.match(signed.body, /Invented private observation/);
  } finally {await app.close();}
});

test('Handover loads independent sections together, preserves order and isolates failure without logging values', async () => {
  const logs: string[] = [], sections = new HandoverSections(line => logs.push(line));
  let release!: () => void, started = 0;
  const blocked = new Promise<void>(resolve => {release = resolve;});
  sections.register({id: 'invented-first', title: 'First', load: async () => {started++; await blocked; return '<p>First retained observation</p>';}});
  sections.register({id: 'invented-second', title: 'Second', load: async () => {started++; throw new Error('Private source value must not be logged');}});
  sections.register({id: 'invented-third', title: 'Third', load: async () => {started++; return '<p>Third observation</p>';}});
  const reading = sections.read();
  assert.equal(started, 3, 'Later reads start while the first is blocked');
  release();
  const rows = await reading;
  assert.deepEqual(rows.map(row => row.id), ['invented-first', 'invented-second', 'invented-third']);
  assert.deepEqual(rows.map(row => row.available), [true, false, true]);
  assert.match(rows[0]!.html, /First retained observation/);
  assert.match(rows[1]!.html, /temporarily unavailable/);
  assert.match(rows[2]!.html, /Third observation/);
  assert.deepEqual(logs, ['Handover section read failed; other sections are retained.']);
});

test('the generic Handover shell needs no source section and escapes section labels', () => {
  const empty = handoverPage([]);
  assert.match(empty, /No handover sections are enabled/);
  assert.match(empty, /data-theme="dark"/);
  assert.match(empty, /<div class="hin settings-header">/);
  assert.match(empty, /\/assets\/handover.js/);
  assert.match(empty, /\/assets\/handover.css/);
  assert.match(empty, /header>\s*<aside class="tk-root/);
  assert.doesNotMatch(empty, /Gorgias|Customer service|Waiting on others|Issues/);
  const html = handoverPage([{id: 'invented-"id', title: '<img src=x>', html: '<p>Safe rendered content</p>', available: true}]);
  assert.match(html, /invented-&quot;id/);
  assert.match(html, /&lt;img src=x&gt;/);
  assert.match(html, /<p>Safe rendered content<\/p>/);
  assert.doesNotMatch(html, /<img src=x>/);
});

test('a failed Handover diagnostic cannot discard another section or the unavailable fallback', async () => {
  const sections = new HandoverSections(() => {throw new Error('Invented logging failure');});
  sections.register({id: 'invented-failed', title: 'Unavailable source', load: async () => {throw new Error('Invented source failure');}});
  sections.register({id: 'invented-retained', title: 'Available source', load: async () => '<p>Retained observation</p>'});
  const rows = await sections.read();
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.available, false);
  assert.match(rows[0]!.html, /temporarily unavailable/);
  assert.equal(rows[1]!.available, true);
  assert.equal(rows[1]!.html, '<p>Retained observation</p>');
});
