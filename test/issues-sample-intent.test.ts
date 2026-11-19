import assert from 'node:assert/strict';
import test from 'node:test';
import type {Database} from '../src/db.js';
import {classifyIssue} from '../src/issues/keywords.js';
import {issuesNeeds, sampleIssuesView} from '../src/issues/model.js';
import {readIssues} from '../src/issues/store.js';
import {defaultSettings} from '../src/settings.js';

const now = new Date('2032-04-07T12:03:00Z');
const excluded = '1 handover tickets this month and 0 last month were questions or requests, not problems, and are left out.';

test('sample Issues demonstrates an intent-only reason and excluded question while preserving its observed total and hourly clock', () => {
  const view = sampleIssuesView(now), cases = view.rows.flatMap(row => row.cases);
  assert.equal(classifyIssue('New invented message'), 'other', 'The generic sample subject supplies no keyword reason');
  assert.equal(view.mode, 'sample'); assert.equal(view.status, 'ready'); assert.equal(cases.length, 6);
  assert.deepEqual([view.rows[0]!.current, view.rows[0]!.previous], [3, 1], 'The existing sample trend remains unchanged');
  const intent = cases.find(row => row.id === 'gorgias:81002')!;
  assert.equal(intent.reason, 'missing item'); assert.deepEqual(intent.sources, ['gorgias']);
  assert.equal(intent.quote, null); assert.equal(intent.ticketHref, null);
  assert.equal(cases.some(row => row.id === 'gorgias:81003'), false);
  assert.equal(view.notes.filter(note => note === excluded).length, 1);
  assert.deepEqual(issuesNeeds(view), []);
  assert.deepEqual(sampleIssuesView(new Date('2032-04-07T12:49:00Z')), view, 'Intent samples do not destabilize unchanged SSE snapshots');
});

test('the sample intent case and exclusion count stay out of a live dashboard when both Issues sources await keys', async () => {
  const db: Database = {query: async () => {throw new Error('Samples need no stored read');},
    transaction: async () => {throw new Error('Samples never write');}, close: async () => {}};
  const sample = await readIssues(db, {}, defaultSettings(), now, 'sample');
  assert.equal(sample.rows.find(row => row.reason === 'missing item')!.current, 1);
  assert.ok(sample.notes.includes(excluded)); assert.deepEqual(issuesNeeds(sample), []);
  const live = await readIssues(db, {}, defaultSettings(), now, 'live');
  assert.equal(live.mode, 'live'); assert.equal(live.status, 'pending');
  assert.equal(live.rows.flatMap(row => row.cases).length, 0);
  assert.equal(live.notes.some(note => note.includes('are left out.')), false);
  assert.deepEqual(issuesNeeds(live), []);
});
