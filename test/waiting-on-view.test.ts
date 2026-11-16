import assert from 'node:assert/strict';
import test from 'node:test';
import type { WaitingItem, WaitingView } from '../src/waiting-on/model.js';
import { waitingRowsHtml, waitingSectionHtml } from '../src/waiting-on/view.js';

const item = (id: string, overrides: Partial<WaitingItem> = {}): WaitingItem => ({id, source: 'hq', contact: 'A supplier',
  subject: 'An invented sample update', since: '2032-04-01', days: 8, ...overrides});
const view = (overrides: Partial<WaitingView> = {}): WaitingView => ({mode: 'live', status: 'ready',
  updatedLabel: '2032-04-09 09:30 UK', readAt: '2032-04-09T08:31:00.000Z', asOf: '2032-04-09T09:00:00.000Z',
  malformedRows: 0, cappedRows: 0, thresholdDays: 7, rows: [item('hq:invented-item')], done: [], ...overrides});

test('missing and unconfigured waiting files keep local manual items usable without labelling them samples', () => {
  for (const status of ['missing', 'waiting_for_keys'] as const) {
    const html = waitingSectionHtml(view({mode: 'sample', status, updatedLabel: null, readAt: null,
      rows: [item('manual:invented-item', {source: 'manual'})]}));
    assert.match(html, /Not set up yet/);
    assert.match(html, /Added here/);
    assert.match(html, /id="waiting-add-form"/);
    assert.match(html, /data-waiting-action="done"/);
    assert.doesNotMatch(html, /Sample data|sample data|disabled/);
    if (status === 'waiting_for_keys') assert.match(html, /GitHub HQ is waiting for keys/);
  }
});

test('waiting rows retain the source update label, diagnostic counts and configured calendar-day threshold', () => {
  const html = waitingRowsHtml(view({malformedRows: 2, cappedRows: 3, rows: [item('first', {days: 7}), item('second', {days: 6})]}));
  assert.match(html, /Updated: 2032-04-09 09:30 UK/);
  assert.match(html, /2 malformed rows skipped · 3 rows beyond the file limit/);
  assert.equal((html.match(/data-state="watch"/g) ?? []).length, 1);
  assert.equal((html.match(/data-state="info"/g) ?? []).length, 1);
  assert.match(html, /Since <time datetime="2032-04-01">2032-04-01<\/time>/);
  assert.doesNotMatch(waitingRowsHtml(view({thresholdDays: 9})), /data-state="watch"/);
});

test('Done rows offer local Put back and describe their expiry, with the tail behind a tap', () => {
  const html = waitingSectionHtml(view({rows: Array.from({length: 8}, (_, index) => item(`invented-${index}`)),
    done: [{...item('invented-done'), doneAt: '2032-04-09T08:00:00.000Z', returnsOn: '2032-05-09'}]}));
  assert.equal((html.match(/data-waiting-item=/g) ?? []).length, 8);
  assert.match(html, /⊕ 2 more waiting/);
  assert.match(html, /✓ Done here · 1/);
  assert.match(html, /data-waiting-action="restore" data-waiting-id="invented-done"/);
  assert.match(html, /Hidden here until 2032-05-09, or until it leaves the file/);
  assert.match(html, /Nothing changes in the source file/);
});

test('waiting form gives privacy guidance and UK-day bounds, and source values cannot inject markup', () => {
  const attack = '<img src=x onerror="alert(1)">';
  const html = waitingSectionHtml(view({asOf: '2032-04-09T23:30:00.000Z',
    rows: [item('invented-"id', {contact: attack, subject: attack})]}));
  assert.match(html, /business contact or role/);
  assert.match(html, /Do not enter customer names, email addresses, phone numbers or addresses/);
  assert.match(html, /name="since" type="date" value="2032-04-10" max="2032-04-10" required/);
  assert.match(html, /data-waiting-item="invented-&quot;id"/);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.doesNotMatch(html, /<img src=x/);
});

test('an unavailable or pending file does not claim that nothing is waiting', () => {
  for (const status of ['pending', 'unavailable'] as const) {
    const html = waitingRowsHtml(view({status, rows: []}));
    assert.match(html, /No saved items to show/);
    assert.doesNotMatch(html, /Nothing waiting/);
  }
  assert.match(waitingRowsHtml(view({rows: []})), /✓ Nothing waiting/);
});
