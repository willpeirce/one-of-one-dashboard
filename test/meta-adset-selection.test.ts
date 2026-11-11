import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import type { Auth } from '../src/auth.js';
import { defaultSettings, readSettings, saveSettings } from '../src/settings.js';
import { saveAdSets, type StoredAdSet } from '../src/meta-adsets/catalogue.js';
import { buildAdSetsView, readAdSetsView, type AdSetsView } from '../src/meta-adsets/presentation.js';
import { registerAdSets } from '../src/meta-adsets/routes.js';
import { AdSetSelectionError, selectedAdSetId, selectedAdSetsApiPath } from '../src/meta-adsets/selected-set.js';
import { adSetCards, adSetSummary, adSetTable } from '../src/meta-adsets/view.js';
import { createTestDatabase } from './helpers/database.js';

// All identifiers, names, dates and figures in this fixture are invented.
const now = new Date('2034-06-09T08:00:00Z');
const account = '120000000000071001', ours = '120000000000071002', freelancer = '120000000000071003';
const activeId = '120000000000071004', pausedId = '120000000000071005', freelancerId = '120000000000071006';
const otherPausedId = '120000000000071007', longId = '120000000000071008'.padEnd(25, '0');
function stored(id: string, status = 'ACTIVE', owner: StoredAdSet['owner'] = 'ours'): StoredAdSet {
  return { id, name: `Invented Fern ${id.slice(-3)}`, campaignId: owner === 'freelancer' ? freelancer : ours,
    campaignName: 'Invented Fern UK', owner, status, effectiveStatus: status, currency: 'GBP', market: 'uk',
    dailyBudget: 2200, lifetimeBudget: null, flatBudget: null, learningStage: null, lastSignificantEdit: null,
    createdTime: '2034-06-01T08:00:00Z', updatedTime: '2034-06-01T08:00:00Z',
    firstSeen: now.toISOString(), lastSeen: now.toISOString(), lastRead: now.toISOString() };
}

test('the minimal stored catalogue includes inactive sets without changing default rows or Home markup', () => {
  const sets = [stored(activeId), stored(pausedId, 'PAUSED'), stored(freelancerId, 'PAUSED', 'freelancer')];
  const options = { mode: 'live' as const, lastRead: now.toISOString(), accountYesterday: null };
  const defaultView = buildAdSetsView(sets, new Map(), defaultSettings(), '2034-06-09', options);
  assert.deepEqual(defaultView.rows.map(row => row.set.id), [activeId]);
  assert.deepEqual(defaultView.catalogue, sets.map(({id,name,owner,status,effectiveStatus,currency}) =>
    ({id,name,owner,status,effectiveStatus,currency})));
  assert.deepEqual(Object.keys(defaultView.catalogue![0]!).sort(), ['currency', 'effectiveStatus', 'id', 'name', 'owner', 'status']);
  const withoutCatalogue = {...defaultView}; delete withoutCatalogue.catalogue;
  assert.equal(adSetCards(defaultView), adSetCards(withoutCatalogue));
  assert.equal(adSetSummary(defaultView, 'all', true), adSetSummary(withoutCatalogue, 'all', true));
  assert.equal(adSetTable(defaultView), adSetTable(withoutCatalogue));
  const selected = buildAdSetsView(sets, new Map(), defaultSettings(), '2034-06-09', {...options, selectedId: pausedId});
  assert.deepEqual(selected.rows.map(row => row.set.id).sort(), [activeId, pausedId]);
  assert.equal(selected.rows.find(row => row.set.id === pausedId)!.verdict, null);
  assert.equal(adSetCards(selected), adSetCards(defaultView), 'The selected inactive row is not a new decision');
  assert.equal(adSetSummary(selected, 'all', true), adSetSummary(defaultView, 'all', true));
  assert.equal(selected.count, defaultView.count);
});

test('selected stored-set reads accept one 5–25 digit ID and refresh preserves only that read selection', () => {
  for (const id of ['12345', pausedId, longId]) {
    assert.equal(selectedAdSetId({set: id}), id);
    assert.equal(selectedAdSetsApiPath(`?set=${id}`), `/api/meta/adsets?set=${id}`);
    assert.equal(selectedAdSetsApiPath(`?other=ignored&set=${id}`), `/api/meta/adsets?set=${id}`);
  }
  assert.equal(longId.length, 25);
  for (const set of ['', '1234', '1'.repeat(26), 'invented-set', '../12345', 12345, null, [pausedId], [pausedId, activeId]])
    assert.throws(() => selectedAdSetId({set}), AdSetSelectionError);
  assert.equal(selectedAdSetId({unrelated: 'preserved'}), undefined);
  assert.equal(selectedAdSetsApiPath(''), '/api/meta/adsets');
  assert.equal(selectedAdSetsApiPath('?set=bad'), '/api/meta/adsets');
  assert.equal(selectedAdSetsApiPath(`?set=${pausedId}&set=${activeId}`), '/api/meta/adsets');
});

test('authenticated Ads reads include only the selected stored inactive set and retain action-route guards', async t => {
  const db = await createTestDatabase();
  const app = Fastify({logger: false});
  t.after(async () => { await app.close(); await db.close(); });
  const initial = await readSettings(db), settings = {...initial.values, metaAdAccountId: account,
    metaOwners: [{campaignId: ours, owner: 'ours' as const}, {campaignId: freelancer, owner: 'freelancer' as const}]};
  await saveSettings(db, {...initial, values: settings}, 'invented-device');
  const rows = [stored(activeId), stored(pausedId, 'PAUSED'), stored(freelancerId, 'PAUSED', 'freelancer'),
    stored(otherPausedId, 'PAUSED'), stored(longId, 'PAUSED')];
  await saveAdSets(db, account, rows, settings, now);
  const foreignId = '120000000000071009';
  await saveAdSets(db, '120000000000071010', [stored(foreignId, 'PAUSED')], settings, now);
  const env = {META_ACCESS_TOKEN: randomBytes(24).toString('hex'), META_ACTIONS_ENABLED: 'true'};
  let signedIn = true, sourceCalls = 0;
  registerAdSets(app, db, {session: async () => signedIn ? 'invented-device' : null} as unknown as Auth, env, () => now,
    {fetch: async () => { sourceCalls++; throw new Error('This fixture permits stored reads only.'); }});
  const api = async (id?: string) => {
    const response = await app.inject(`/api/meta/adsets${id ? `?set=${id}` : ''}`);
    assert.equal(response.statusCode, 200, response.body);
    return response.json<AdSetsView>();
  };
  const normal = await api();
  assert.deepEqual(normal.rows.map(row => row.set.id), [activeId]);
  assert.deepEqual(normal.catalogue?.map(row => row.id).sort(), rows.map(row => row.id).sort());
  assert.equal(normal.catalogue?.some(row => row.id === foreignId), false);
  for (const id of [pausedId, freelancerId, longId]) {
    const selected = await api(id);
    assert.deepEqual(selected.rows.map(row => row.set.id).sort(), [activeId, id].sort());
    assert.equal(selected.rows.find(row => row.set.id === id)!.set.status, 'PAUSED');
    assert.deepEqual((await api()).rows, normal.rows, 'An explicit selection does not persist into default reads');
  }
  assert.deepEqual((await api(foreignId)).rows, normal.rows, 'Selection cannot read a different account');
  assert.deepEqual((await api('120000000000071099')).rows, normal.rows, 'Missing stored IDs add no row');
  const page = await app.inject(`/ads?set=${pausedId}`);
  assert.equal(page.statusCode, 200);
  assert.match(page.body, new RegExp(`data-adset-row="${pausedId}"`));
  assert.doesNotMatch(page.body, new RegExp(`data-adset-row="${otherPausedId}"`));
  for (const query of ['set=1234', 'set=bad', `set=${pausedId}&set=${activeId}`, `set=${'1'.repeat(26)}`]) {
    assert.equal((await app.inject(`/api/meta/adsets?${query}`)).statusCode, 400);
    assert.equal((await app.inject(`/ads?${query}`)).statusCode, 400);
  }
  assert.equal((await app.inject({method: 'POST', url: `/api/meta/adset/${longId}`,
    payload: {action: 'pause', value: 'PAUSED'}})).statusCode, 400, 'The existing 24-digit write guard is unchanged');
  signedIn = false;
  assert.equal((await app.inject(`/api/meta/adsets?set=${pausedId}`)).statusCode, 401);
  assert.equal((await app.inject('/api/meta/adsets?set=bad')).statusCode, 401);
  assert.equal((await app.inject(`/ads?set=${pausedId}`)).headers.location, '/login');
  assert.equal(sourceCalls, 0);
  assert.equal((await db.query('SELECT id FROM pulse.meta_actions')).rowCount, 0);
  assert.deepEqual((await readAdSetsView(db, settings, env, now)).rows, normal.rows);
});
