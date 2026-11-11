import assert from 'node:assert/strict';
import test from 'node:test';
import type { Database } from '../src/db.js';
import { ukToday } from '../src/hero-range.js';
import { readMetaActions } from '../src/meta-adsets/actions.js';
import type { StoredAdSet } from '../src/meta-adsets/catalogue.js';
import { pauseUncertaintyCode } from '../src/meta-adsets/pause-uncertainty.js';
import { buildAdSetsView } from '../src/meta-adsets/presentation.js';
import { morningDeck, type MorningInput } from '../src/morning/model.js';
import { defaultSettings } from '../src/settings.js';
import { tickerState } from '../src/ticker/model.js';
import { createTestDatabase } from './helpers/database.js';

// All names, identifiers, dates and figures are invented.
const account = '120000000000008001', now = new Date('2032-07-08T12:00:00Z');
const setId = (index: number) => `120000000000008${String(index).padStart(3, '0')}`;
async function insert(db: Database, id: string, time: string, index: number,
  result = 'success', error: string | null = null, accountId = account) {
  await db.query(`INSERT INTO pulse.meta_actions(id,time,account_id,ad_set_id,action,old_value,new_value,who,result,error_code)
    VALUES($1,$2,$3,$4,'pause','ACTIVE','PAUSED','invented-device',$5,$6)`, [id, time, accountId, setId(index), result, error]);
}
async function seedToday(db: Database) {
  for (let index = 0; index < 55; index++) {
    await insert(db, `invented-today-${index}`, new Date(Date.parse('2032-07-08T08:00:00Z') + index * 60_000).toISOString(), index);
  }
}
function input(): MorningInput {
  const settings = defaultSettings(); settings.metaAdAccountId = account;
  const sets: StoredAdSet[] = Array.from({ length: 55 }, (_, index) => ({
    id: setId(index), campaignId: '120000000000009001', name: `Invented Garden — Invented Fern ${index} — £20`,
    owner: 'ours', market: 'uk', status: 'PAUSED', effectiveStatus: 'PAUSED', currency: 'GBP',
    flatBudget: null, dailyBudget: null, lifetimeBudget: null, createdTime: '2032-07-01T08:00:00Z',
    updatedTime: now.toISOString(), learningStage: null, lastSignificantEdit: null, campaignName: 'Invented Garden',
    firstSeen: '2032-07-01T08:00:00Z', lastSeen: now.toISOString(), lastRead: now.toISOString(),
  }));
  const adSets = buildAdSetsView(sets, new Map(), settings, ukToday(now), { mode: 'live', lastRead: now.toISOString(),
    accountYesterday: null, recentActionIds: sets.map(set => set.id) });
  adSets.actionsEnabled = true;
  return { mode: 'live', settings, adSets, needs: [], checks: [], creativeCards: [], activity: [], metaActions: [],
    ticker: tickerState([], [], now, 'live'), sourceReadOk: { adsets: true } };
}

test('Morning reads all 55 successful answers today with every individual Undo while Audit retains 50', async t => {
  const db = await createTestDatabase(); t.after(() => db.close()); await seedToday(db);
  assert.equal((await readMetaActions(db, account)).length, 50);
  const data = input(); data.metaActions = await readMetaActions(db, account, now);
  assert.equal(data.metaActions.length, 55);
  const snapshot = morningDeck(data, [], now).snapshot;
  assert.equal(snapshot.cards.length, 0);
  assert.equal(snapshot.completed, 55); assert.equal(snapshot.total, 55);
  assert.equal(snapshot.metaActions.length, 55);
  assert.equal(snapshot.metaActions.filter(action => action.undo !== null).length, 55);
  assert.deepEqual(new Set(snapshot.metaActions.map(action => action.undo?.value)), new Set(data.metaActions.map(action => action.id)));
});

test('the extra success window starts at UK summer midnight and stays scoped to the requested account', async t => {
  const db = await createTestDatabase(); t.after(() => db.close()); await seedToday(db);
  await insert(db, 'invented-before-uk-day', '2032-07-07T22:59:59.999Z', 70);
  await insert(db, 'invented-at-uk-midnight', '2032-07-07T23:00:00.000Z', 71);
  await insert(db, 'invented-other-account', '2032-07-08T09:00:00Z', 72, 'success', null, '120000000000008999');
  const scoped = await readMetaActions(db, account, now);
  assert.equal(scoped.length, 56);
  assert.ok(scoped.some(action => action.id === 'invented-at-uk-midnight'));
  assert.equal(scoped.some(action => action.id === 'invented-before-uk-day'), false);
  assert.equal(scoped.some(action => action.id === 'invented-other-account'), false);
  assert.equal((await readMetaActions(db, undefined, now)).length, 57, 'The optional day also works without an account filter');
  const tomorrow = await readMetaActions(db, account, new Date('2032-07-08T23:00:00Z'));
  assert.equal(tomorrow.length, 50, 'The preceding UK day does not extend tomorrow’s recent audit window');
});

test('the optional day keeps old pending and unresolved failures outside the recent audit window', async t => {
  const db = await createTestDatabase(); t.after(() => db.close()); await seedToday(db);
  const older = '2032-07-06T08:00:00Z';
  await insert(db, 'invented-old-pending', older, 80, 'pending');
  await insert(db, 'invented-old-uncertain', older, 81, 'failed', pauseUncertaintyCode('active', new Date(older), 'timeout'));
  assert.equal((await readMetaActions(db, account)).length, 52);
  const actions = await readMetaActions(db, account, now);
  assert.equal(actions.length, 57);
  assert.ok(actions.some(action => action.id === 'invented-old-pending'));
  assert.ok(actions.some(action => action.id === 'invented-old-uncertain'));
});
