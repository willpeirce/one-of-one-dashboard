import assert from 'node:assert/strict';
import test from 'node:test';
import { addDays, ukToday } from '../src/hero-range.js';
import type { MetaAction } from '../src/meta-adsets/actions.js';
import type { MetaActivity } from '../src/meta-adsets/activity.js';
import type { StoredAdSet } from '../src/meta-adsets/catalogue.js';
import { pauseUncertaintyCode } from '../src/meta-adsets/pause-uncertainty.js';
import { buildAdSetsView } from '../src/meta-adsets/presentation.js';
import { morningDeck, type MorningInput } from '../src/morning/model.js';
import { morningPauseAll } from '../src/morning/pause-all.js';
import { defaultSettings } from '../src/settings.js';
import { tickerState } from '../src/ticker/model.js';

// All names, identifiers, dates and figures are invented.
const now = new Date('2032-04-07T08:00:00Z'), pausedAt = '2032-04-06T08:00:00Z';
const resumedAt = '2032-04-07T07:00:00Z', observedAt = '2032-04-07T07:30:00Z';
function fixture(): MorningInput {
  const settings = defaultSettings(); settings.metaAdAccountId = '120000000000007001';
  const sets: StoredAdSet[] = Array.from({ length: 3 }, (_, index) => ({
    id: `12000000000000710${index}`, campaignId: '120000000000007002', name: `Invented Garden — Invented Fern ${index} — £20`,
    owner: 'ours', market: 'uk', status: 'ACTIVE', effectiveStatus: 'ACTIVE', currency: 'GBP',
    flatBudget: null, dailyBudget: null, lifetimeBudget: null, createdTime: '2032-04-01T08:00:00Z',
    updatedTime: '2032-04-01T08:00:00Z', learningStage: null, lastSignificantEdit: null, campaignName: 'Invented Garden',
    firstSeen: '2032-04-01T08:00:00Z', lastSeen: now.toISOString(), lastRead: now.toISOString(),
  }));
  const days = new Map(sets.map(set => [set.id, Array.from({ length: 6 }, (_, index) => ({
    day: addDays('2032-04-01', index), spend: 40, purchases: 1, addsToCart: 3,
  }))]));
  const adSets = buildAdSetsView(sets, days, settings, ukToday(now), { mode: 'live', lastRead: now.toISOString(), accountYesterday: 120 });
  adSets.actionsEnabled = true;
  return { mode: 'live', settings, adSets, needs: [], checks: [], creativeCards: [], activity: [], metaActions: [],
    ticker: tickerState([], [], now, 'live'), sourceReadOk: { adsets: true, activity: true } };
}
function receipt(data: MorningInput, extra: Partial<MetaAction> = {}): MetaAction {
  return { id: 'invented-pause-receipt', time: pausedAt, adSetId: data.adSets!.rows[0]!.set.id, action: 'pause',
    oldValue: 'ACTIVE', newValue: 'PAUSED', result: 'success', undoneAt: null, undoOf: null, errorCode: null, ...extra };
}
function activity(data: MorningInput, extra: Partial<MetaActivity> = {}): MetaActivity {
  return { id: 'invented-resume-event', type: 'update_ad_set_run_status', time: resumedAt, actorId: 'invented-actor',
    actor: 'Invented operator', app: 'Invented console', objectId: data.adSets!.rows[0]!.set.id, object: 'Invented Fern',
    objectType: 'Ad set', old: 'PAUSED', value: 'ACTIVE', oldPence: null, newPence: null, currency: null, budgetLabel: null, ...extra };
}
function project(data: MorningInput) {
  const ordinary = morningDeck({ ...data, metaActions: [] }, [], now).candidates.filter(card => card.kind === 'meta-kill');
  assert.equal(ordinary.length, 3);
  // Test the constructor independently of the reversible production activation.
  return morningPauseAll(data, ordinary, new Map());
}
function observedResume(data: MorningInput) {
  const row = data.adSets!.rows[0]!;
  row.set.updatedTime = resumedAt;
  row.changes = [{ time: observedAt, field: 'status', old: 'PAUSED', value: 'ACTIVE' }];
}

test('a later source-confirmed external resume restores the third live Kill to Pause all', () => {
  const data = fixture(); data.metaActions = [receipt(data)];
  assert.equal(project(data).card, undefined);
  observedResume(data);
  assert.equal(project(data).coverage?.members.length, 3);
  assert.equal(project(data).card?.title, '3 of ours are over the bar');
});

test('bare or overlapping ACTIVE reads and old or unrelated changes cannot restore a paused member', () => {
  for (const adjust of [
    (data: MorningInput) => { data.adSets!.rows[0]!.changes = []; },
    (data: MorningInput) => { data.adSets!.rows[0]!.set.updatedTime = '2032-04-06T07:59:59Z'; },
    (data: MorningInput) => { data.adSets!.rows[0]!.set.updatedTime = pausedAt; },
    (data: MorningInput) => { data.adSets!.rows[0]!.changes[0]!.time = pausedAt; },
    (data: MorningInput) => { data.adSets!.rows[0]!.changes[0]!.old = 'ACTIVE'; },
    (data: MorningInput) => { data.adSets!.rows[0]!.changes[0]!.value = 'PAUSED'; },
    (data: MorningInput) => { data.adSets!.rows[0]!.changes[0]!.field = 'daily_budget'; },
  ]) {
    const data = fixture(); data.metaActions = [receipt(data)]; observedResume(data); adjust(data);
    assert.equal(project(data).card, undefined);
    assert.equal(project(data).coverage?.members.length, 2);
  }
});

test('a later matching Meta ad-set resume event also restores membership without a catalogue change', () => {
  for (const extra of [
    { objectType: 'Ad set' }, { objectType: 'AD_SET' }, { objectType: 'CAMPAIGN' },
    { objectType: 'AD_SET', type: 'update_campaign_run_status' },
  ]) {
    const data = fixture(); data.metaActions = [receipt(data)]; data.activity = [activity(data, extra)];
    assert.equal(project(data).coverage?.members.length, 3);
    assert.ok(project(data).card);
  }
  for (const extra of [
    { time: pausedAt }, { time: '2032-04-06T07:59:59Z' }, { objectId: '120000000000007999' },
    { objectType: 'Campaign' }, { type: 'update_ad_set_budget' }, { old: 'ACTIVE' }, { value: 'PAUSED' },
  ]) {
    const data = fixture(); data.metaActions = [receipt(data)]; data.activity = [activity(data, extra)];
    assert.equal(project(data).card, undefined);
  }
});

test('external resume evidence never releases pending or uncertain pauses and cannot predate a newer pause', () => {
  for (const extra of [
    { result: 'pending' },
    { result: 'failed', errorCode: pauseUncertaintyCode('active', new Date(pausedAt), 'timeout') },
    { id: 'invented-later-pause', time: '2032-04-07T07:45:00Z' },
  ]) {
    const data = fixture(); data.metaActions = [receipt(data, extra)]; observedResume(data); data.activity = [activity(data)];
    assert.equal(project(data).card, undefined);
    assert.equal(project(data).coverage?.members.length, 2);
  }
});
