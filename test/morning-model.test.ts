import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultSettings } from '../src/settings.js';
import { addDays, ukToday } from '../src/hero-range.js';
import { sampleAdSetsView } from '../src/meta-adsets/presentation.js';
import type { MetaActivity } from '../src/meta-adsets/activity.js';
import { readActivity, syncActivity } from '../src/meta-adsets/activity.js';
import type { MetaAction } from '../src/meta-adsets/actions.js';
import { sampleKeyDates, tickerState } from '../src/ticker/model.js';
import { morningDeck, morningFacts, morningKey, MORNING_LIMIT, type MorningCard, type MorningInput, type MorningState } from '../src/morning/model.js';
import { curateMorningSample } from '../src/morning/sample.js';
import { createTestDatabase } from './helpers/database.js';

const now = new Date('2032-04-07T08:00:00Z');
function input(): MorningInput {
  return { mode: 'live', needs: [], checks: [], creativeCards: [], ticker: tickerState([], [], now, 'live'),
    settings: defaultSettings(), activity: [], metaActions: [], sourceReadOk: { adsets: true, creatives: true, ticker: true, tests: true, activity: true, google: true, 'needs:shopify': true } };
}
function need(id: string, state: 'warn' | 'alarm' = 'warn') {
  return { id, state, title: `Invented ${id}`, why: 'An invented rule has fired.', link: '/sources', source: 'shopify' as const,
    figure: { value: '12', label: 'Invented measure' } };
}
function state(card: MorningCard, options: Partial<MorningState> = {}): MorningState {
  return { mode: 'live', cardKey: card.key, state: 'parked', untilDay: addDays(ukToday(now), 1), factsHash: card.factsHash,
    answer: null, credentialId: 'invented-device', pressedAt: now.toISOString(), clearedAt: null,
    title: card.title, kind: card.kind, subjectId: card.subjectId, sourceScope: card.sourceScope, ...options };
}
function sampleInput(): MorningInput {
  const data = input(); data.mode = 'sample'; data.adSets = sampleAdSetsView(data.settings);
  data.ticker = tickerState(sampleKeyDates(now), [], now, 'sample');
  data.creativeCards = [
    { id: 'invented-fading', kind: 'watch', groupId: 'invented-media-1', picture: '/assets/icon-192.png', title: 'Invented fading creative', reason: 'An invented fading reason.', mode: 'sample' },
    { id: 'invented-brief', kind: 'decide', groupId: 'invented-media-2', picture: '/assets/icon-192.png', title: 'Invented make-next brief', reason: 'An invented brief.', brief: 'An invented brief.', strength: 'Strong', mode: 'sample' },
  ];
  return data;
}

test('Morning sorts all six tiers, preserves Home order and leaves stock and attach needs out', () => {
  const data = sampleInput(); data.needs = [need('first-alarm', 'alarm'), need('second-alarm', 'alarm'), need('ordinary'), need('watchdog'), need('stock:invented'), need('attach:invented')];
  data.checks = [{ id: 'watchdog', status: 'tripped', name: 'Invented watchdog', why: 'Invented reason', link: '/sources' }];
  data.extensions = curateMorningSample(inputWithMode('sample'), now).extensions;
  const result = morningDeck(data, [], now), cards = result.candidates;
  assert.deepEqual(cards.filter(card => card.tier === 0).map(card => card.subjectId), ['first-alarm', 'second-alarm']);
  assert.deepEqual(cards.filter(card => card.tier === 1).map(card => card.kind), ['meta-kill', 'meta-slipping', 'test-call', 'meta-step']);
  assert.deepEqual(cards.filter(card => card.tier === 2).map(card => card.kind), ['need', 'date', 'google', 'fading']);
  assert.ok(cards.findIndex(card => card.kind === 'make-next') < cards.findIndex(card => card.kind === 'new-verdict'));
  assert.ok(cards.findIndex(card => card.kind === 'done-for-you') < cards.findIndex(card => card.subjectId === 'ordinary'));
  assert.equal(cards.some(card => /^(stock|attach):/.test(card.subjectId)), false);
  assert.equal(result.snapshot.cards.length, MORNING_LIMIT);
  assert.equal(result.snapshot.more, cards.length - MORNING_LIMIT);
});
function inputWithMode(mode: 'sample' | 'live'): MorningInput { const result = input(); result.mode = mode; return result; }

test('the Morning sample shows all tall figures in its first seven without modifying Home or ticker fixtures', () => {
  const source = sampleInput(), original = structuredClone(source);
  source.needs = [need('sample-alarm', 'alarm')]; original.needs = structuredClone(source.needs);
  const curated = curateMorningSample(source, now), result = morningDeck(curated, [], now);
  assert.deepEqual(source, original);
  assert.deepEqual(result.snapshot.cards.map(card => card.kind), ['meta-kill', 'test-call', 'date', 'google', 'fading', 'date', 'make-next']);
  for (const kind of ['dial', 'arms', 'thumb', 'brief']) assert.ok(result.snapshot.cards.some(card => card.figure.kind === kind));
  assert.equal(result.snapshot.more, 2);
  assert.equal(source.ticker.ahead.length, 6);
  assert.equal(curated.ticker.ahead.length, 2);
  assert.equal(curateMorningSample(input(), now).mode, 'live');
  assert.equal(morningDeck(input(), [], now).candidates.some(card => card.title.includes('Sample')), false);
});

test('daily cap counts states, successful un-undone app actions and passed dates; undo gives a slot back', () => {
  const data = input(); data.needs = Array.from({ length: 10 }, (_, i) => need(`need-${i}`));
  const first = morningDeck(data, [], now).candidates[0]!;
  const stored = state(first);
  const after = morningDeck(data, [stored], now);
  assert.equal(after.snapshot.completed, 1); assert.equal(after.snapshot.cards.length, 6); assert.equal(after.snapshot.more, 3);
  assert.equal(morningDeck(data, [], now).snapshot.cards.length, 7);
  const action: MetaAction = { id: 'invented-action', time: now.toISOString(), adSetId: 'invented-set', action: 'pause', oldValue: 'ACTIVE', newValue: 'PAUSED', result: 'success', undoneAt: null, undoOf: null, errorCode: null };
  data.metaActions = [action, { ...action, id: 'invented-failed', result: 'failed' }, { ...action, id: 'invented-undo', undoOf: 'invented-prior' }];
  const date = { name: 'Invented passed date', date: ukToday(now), kind: 'flag' as const, note: '' };
  data.ticker = tickerState([date], [{ event_key: `${date.name.toLowerCase()}|${date.date}`, passed_at: now }], now, 'live');
  assert.equal(morningDeck(data, [stored], now).snapshot.completed, 3);
  data.metaActions[0] = { ...action, undoneAt: now.toISOString() };
  assert.equal(morningDeck(data, [stored], now).snapshot.completed, 2);
  const seven = morningDeck({ ...data, metaActions: [], ticker: input().ticker }, Array.from({ length: 7 }, (_, i) => state(morningDeck(data, [], now).candidates[i]!)), now);
  assert.equal(seven.snapshot.cards.length, 0); assert.equal(seven.snapshot.more, 3); assert.equal(seven.openCards.length, 3);
});

test('park expires on next UK day and a worse state returns immediately without losing today’s slot', () => {
  const data = input(); data.needs = [need('same-rule')];
  const original = morningDeck(data, [], now).candidates[0]!, saved = state(original);
  assert.equal(morningDeck(data, [saved], now).snapshot.cards.length, 0);
  data.needs = [];
  assert.equal(morningDeck(data, [saved], now).snapshot.parked.length, 1, 'a brief absence does not undo a timed park');
  data.needs = [need('same-rule')];
  assert.equal(morningDeck(data, [saved], now).snapshot.cards.length, 0);
  assert.equal(morningDeck(data, [saved], new Date('2032-04-08T08:00:00Z')).snapshot.cards.length, 1);
  data.needs[0]!.state = 'alarm';
  const result = morningDeck(data, [saved], now);
  assert.equal(result.snapshot.cards[0]?.state, 'alarm'); assert.equal(result.snapshot.completed, 1);
  assert.deepEqual(result.clearKeys, [original.key]);
});

test('hidden survives moving figures, ends on a changed rule and never clears on a failed or waiting read', () => {
  const data = input(); data.needs = [need('hidden')];
  const card = morningDeck(data, [], now).candidates[0]!, hidden = state(card, { state: 'hidden', untilDay: null });
  data.needs[0]!.figure!.value = '999'; data.needs[0]!.why = 'A moving daily measure';
  assert.equal(morningDeck(data, [hidden], now).snapshot.cards.length, 0);
  const changed = { ...card, ruleId: 'another-rule', factsHash: morningFacts(card.kind, card.subjectId, card.state, 'another-rule') };
  const changedInput = { ...data, needs: [], extensions: [changed] };
  assert.equal(morningDeck(changedInput, [hidden], now).snapshot.cards.length, 1);
  changedInput.sourceReadOk['needs:shopify'] = false;
  assert.equal(morningDeck(changedInput, [hidden], now).snapshot.hidden.length, 1, 'failed reads do not clear hidden state even when cached figures differ');
  changedInput.extensions[0] = { ...changed, state: 'alarm' };
  assert.equal(morningDeck(changedInput, [hidden], now).snapshot.cards[0]?.state, 'alarm', 'a retained hidden Watch never conceals an Alarm');
  data.needs = []; data.sourceReadOk['needs:shopify'] = false;
  assert.equal(morningDeck(data, [hidden], now).snapshot.hidden.length, 1);
  data.sourceReadOk['needs:shopify'] = true;
  const cleared = morningDeck(data, [hidden], now);
  assert.equal(cleared.snapshot.hidden.length, 0); assert.equal(cleared.snapshot.presses.length, 1);
  assert.equal(cleared.snapshot.completed, 1); assert.deepEqual(cleared.clearKeys, [card.key]);
  const recorded = { ...hidden, clearedAt: now.toISOString() };
  data.needs = [need('hidden')];
  assert.equal(morningDeck(data, [recorded], now).snapshot.cards.length, 1, 'a cleared rule cannot silently become hidden again');
  assert.deepEqual(morningDeck(data, [recorded], new Date('2032-04-08T08:00:00Z')).deleteKeys, [card.key]);
});

test('hold survives proposal absence and changed figures until its day, while Kill stays independent', () => {
  const data = sampleInput(), view = data.adSets!;
  const step = morningDeck(data, [], now).candidates.find(card => card.kind === 'meta-step')!;
  const hold = state(step, { mode: 'sample', state: 'answered', answer: 'hold', untilDay: '2032-04-14' });
  const held = morningDeck(data, [hold], now);
  assert.equal(held.snapshot.cards.some(card => card.key === step.key), false);
  assert.equal(held.snapshot.answers.length, 1);
  data.adSets = { ...view, rows: view.rows.filter(row => row.set.id !== step.subjectId) };
  assert.equal(morningDeck(data, [hold], now).snapshot.answers.length, 1);
  data.adSets = view;
  const row = view.rows.find(row => row.set.id === step.subjectId)!;
  row.verdict!.proposedBase = 99;
  assert.equal(morningDeck(data, [hold], now).snapshot.answers.length, 1);
  row.verdict!.verdict = 'Kill'; row.verdict!.reasons = [{ rule: 'purchase-cost', verdict: 'Kill', text: 'Invented Kill', figures: ['£99', '£20'] }];
  assert.ok(morningDeck(data, [hold], now).candidates.some(card => card.subjectId === row.set.id && card.kind === 'meta-kill'));
  assert.equal(morningDeck(data, [hold], new Date('2032-04-14T08:00:00Z')).snapshot.answers.length, 0);
});

test('Alarm and Done Seen last one UK day, while verdict Seen uses its own window and test calls remain while Live', () => {
  const data = curateMorningSample(sampleInput(), now), candidates = morningDeck(data, [], now).candidates;
  const verdict = candidates.find(card => card.kind === 'new-verdict')!;
  const seen = state(verdict, { mode: 'sample', state: 'seen', untilDay: verdict.seenUntilDay! });
  assert.equal(morningDeck(data, [seen], new Date('2032-04-09T08:00:00Z')).openCards.some(card => card.key === verdict.key), false);
  assert.equal(morningDeck(data, [seen], new Date('2032-04-10T08:00:00Z')).openCards.some(card => card.key === verdict.key), true);
  const call = candidates.find(card => card.kind === 'test-call')!;
  const called = state(call, { mode: 'sample', state: 'answered', answer: 'b', untilDay: null });
  data.extensions = data.extensions!.filter(card => card.kind !== 'test-call');
  assert.equal(morningDeck(data, [called], now).snapshot.answers.length, 1);
  data.liveTestIds = []; data.sourceReadOk.tests = false;
  assert.equal(morningDeck(data, [called], now).snapshot.answers.length, 1);
  data.sourceReadOk.tests = true;
  assert.equal(morningDeck(data, [called], now).snapshot.answers.length, 0);
  const alarmData = input(); alarmData.needs = [need('alarm', 'alarm')];
  const alarm = morningDeck(alarmData, [], now).candidates[0]!, alarmSeen = state(alarm, { state: 'seen' });
  assert.equal(morningDeck(alarmData, [alarmSeen], now).snapshot.cards.length, 0);
  alarmData.needs = [];
  assert.deepEqual(morningDeck(alarmData, [alarmSeen], now).clearKeys, [], 'Seen lasts its own window even when the current trigger clears');
  alarmData.needs = [need('alarm', 'alarm')];
  assert.equal(morningDeck(alarmData, [alarmSeen], now).snapshot.cards.length, 0);
  assert.equal(morningDeck(alarmData, [alarmSeen], new Date('2032-04-08T08:00:00Z')).snapshot.cards.length, 1);
});

test('buttons enforce alarm restrictions, sample action safety, exact Step amount and date route reuse', () => {
  const data = sampleInput(), view = data.adSets!;
  data.needs = [need('alarm', 'alarm')];
  const sample = morningDeck(data, [], now).candidates;
  const alarm = sample.find(card => card.state === 'alarm')!;
  assert.deepEqual(alarm.allowedPresses, ['ack']); assert.deepEqual(alarm.menu, []);
  assert.equal(sample.some(card => [card.primary, card.secondary, ...card.menu].some(button => button?.kind === 'live')), false);
  data.mode = 'live'; view.mode = 'live'; view.actionsEnabled = true;
  const live = morningDeck(data, [], now).candidates;
  assert.equal(live.find(card => card.kind === 'meta-kill')!.primary.kind, 'live');
  const slipping = live.find(card => card.kind === 'meta-slipping')!;
  assert.equal(slipping.primary.kind, 'link'); assert.equal(slipping.menu[0]?.kind, 'live');
  const step = live.find(card => card.kind === 'meta-step')!;
  assert.equal(step.primary.kind, 'live');
  if (step.primary.kind === 'live') assert.equal(step.primary.value, view.rows.find(row => row.set.id === step.subjectId)!.verdict!.proposedBase);
  assert.deepEqual(step.allowedPresses, ['hold', 'park']);
  const dateCards = sample.filter(card => card.kind === 'date');
  assert.equal(dateCards.find(card => card.state === 'warn')!.primary.kind, 'copy');
  const today = dateCards.find(card => card.eventDate === ukToday(now))!;
  assert.equal(today.primary.kind, 'save');
  if (today.primary.kind === 'save') assert.equal(today.primary.target, 'ticker');
  assert.equal(dateCards.some(card => card.allowedPresses.includes('remind')), true);
  assert.equal(dateCards.some(card => card.eventDate === addDays(ukToday(now), 30)), false);
});

test('Done for you requires owned ad-set budget activity by a configured actor and excludes matching app actions', () => {
  const data = sampleInput(); data.mode = 'live'; data.adSets!.mode = 'live'; data.adSets!.actionsEnabled = true;
  const row = data.adSets!.rows[0]!; row.set.dailyBudget = 2400;
  data.settings.ourActors = [{ actorId: 'invented-actor' }];
  const event: MetaActivity = { id: 'invented-event', type: 'update_ad_set_budget', time: now.toISOString(), actorId: 'invented-actor', actor: 'Invented actor', app: 'Invented tool',
    objectId: row.set.id, object: row.set.name, objectType: 'Ad set', old: 'GBP 20.00', value: 'GBP 24.00', oldPence: 2000, newPence: 2400, currency: 'GBP', budgetLabel: 'daily' };
  data.activity = [event];
  let done = morningDeck(data, [], now).candidates.filter(card => card.kind === 'done-for-you');
  assert.equal(done.length, 1); assert.equal(done[0]!.secondary?.kind, 'live');
  assert.doesNotMatch(done[0]!.title, /Invented actor/);
  row.set.dailyBudget = 2500;
  assert.equal(morningDeck(data, [], now).candidates.find(card => card.kind === 'done-for-you')!.secondary, undefined);
  row.set.dailyBudget = 2400;
  const action: MetaAction = { id: 'invented-action', time: new Date(now.getTime() + 4 * 60_000).toISOString(), adSetId: row.set.id,
    action: 'budget', oldValue: '2000', newValue: '2400', result: 'success', undoneAt: null, undoOf: null, errorCode: null };
  data.metaActions = [action];
  assert.equal(morningDeck(data, [], now).candidates.filter(card => card.kind === 'done-for-you').length, 0);
  data.metaActions[0]!.time = new Date(now.getTime() + 6 * 60_000).toISOString();
  assert.equal(morningDeck(data, [], now).candidates.filter(card => card.kind === 'done-for-you').length, 1);
  for (const change of [{ actorId: 'other-actor' }, { objectType: 'campaign' }, { type: 'update_ad_set_run_status' }, { oldPence: null }, { time: '2032-04-06T08:00:00Z' }]) {
    data.activity = [{ ...event, ...change }];
    assert.equal(morningDeck(data, [], now).candidates.filter(card => card.kind === 'done-for-you').length, 0);
  }
});

test('stored activity reaches Done for you after the existing legacy object-type normalization', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const data = sampleInput(); data.mode = 'live'; data.adSets!.mode = 'live';
  const row = data.adSets!.rows[0]!; data.settings.ourActors = [{ actorId: 'invented-actor' }];
  const events: MetaActivity[] = ['AD_SET', 'CAMPAIGN', 'CAMPAIGN_GROUP'].map((objectType, index) => ({
    id: `invented-stored-event-${index}`, type: 'update_ad_set_budget', time: now.toISOString(), actorId: 'invented-actor', actor: 'Invented actor', app: 'Invented tool',
    objectId: row.set.id, object: row.set.name, objectType, old: 'GBP 20.00', value: 'GBP 24.00', oldPence: 2000, newPence: 2400, currency: 'GBP', budgetLabel: 'daily',
  }));
  await syncActivity(db, 'invented-morning-account', async () => ({ events, skipped: 0 }), now);
  data.activity = (await readActivity(db, 'invented-morning-account', data.settings, now)).events;
  assert.deepEqual(morningDeck(data, [], now).candidates.filter(card => card.kind === 'done-for-you').map(card => card.subjectId), ['invented-stored-event-0', 'invented-stored-event-1']);
});

test('a successful app reversal removes Done for you while its budget remains restored', () => {
  const data = sampleInput(); data.mode = 'live'; data.adSets!.mode = 'live';
  const row = data.adSets!.rows[0]!; row.set.dailyBudget = 2400;
  data.settings.ourActors = [{ actorId: 'invented-actor' }];
  data.activity = [{ id: 'invented-external-step', type: 'update_ad_set_budget', time: '2032-04-07T07:00:00Z', actorId: 'invented-actor', actor: 'Invented actor', app: 'Invented tool',
    objectId: row.set.id, object: row.set.name, objectType: 'Ad set', old: 'GBP 20.00', value: 'GBP 24.00', oldPence: 2000, newPence: 2400, currency: 'GBP', budgetLabel: 'daily' }];
  const reverse: MetaAction = { id: 'invented-reversal', time: '2032-04-07T07:30:00Z', adSetId: row.set.id,
    action: 'budget', oldValue: '2400', newValue: '2000', result: 'success', undoneAt: null, undoOf: null, errorCode: null };
  assert.equal(morningDeck(data, [], now).candidates.filter(card => card.kind === 'done-for-you').length, 1);
  data.metaActions = [reverse]; row.set.dailyBudget = 2000;
  assert.equal(morningDeck(data, [], now).candidates.filter(card => card.kind === 'done-for-you').length, 0);
  assert.equal(morningDeck(data, [], now).snapshot.completed, 1);
  for (const patch of [{ result: 'failed' }, { undoneAt: now.toISOString() }, { time: '2032-04-07T06:30:00Z' }, { newValue: '2100' }]) {
    data.metaActions = [{ ...reverse, ...patch }];
    assert.equal(morningDeck(data, [], now).candidates.filter(card => card.kind === 'done-for-you').length, 1);
  }
  data.metaActions = [reverse]; row.set.dailyBudget = 2400;
  assert.equal(morningDeck(data, [], now).candidates.filter(card => card.kind === 'done-for-you').length, 1, 'a later change back to the event budget is no longer the restored state');
});

test('a saved Pause advances Morning before a refused catalogue refresh updates effective status', () => {
  const data = sampleInput(); data.mode = 'live'; data.adSets!.mode = 'live'; data.adSets!.actionsEnabled = true;
  const row = data.adSets!.rows.find(row => row.verdict?.verdict === 'Kill')!;
  assert.ok(morningDeck(data, [], now).candidates.some(card => card.kind === 'meta-kill' && card.subjectId === row.set.id));
  // actOnAdSet persists status and a successful action before its optional catalogue read.
  row.set.status = 'PAUSED'; row.set.effectiveStatus = 'ACTIVE';
  data.metaActions = [{ id: 'invented-saved-pause', time: now.toISOString(), adSetId: row.set.id, action: 'pause',
    oldValue: 'ACTIVE', newValue: 'PAUSED', result: 'success', undoneAt: null, undoOf: null, errorCode: null }];
  const result = morningDeck(data, [], now);
  assert.equal(result.candidates.some(card => card.kind === 'meta-kill' && card.subjectId === row.set.id), false);
  assert.equal(result.snapshot.completed, 1);
  assert.equal(result.snapshot.metaActions[0]!.undo?.action, 'undo');
  assert.equal(row.verdict!.verdict, 'Kill', 'the Morning projection does not change the shared Home verdict');
});

test('need and creative source lines show stored successful-read times or waiting', () => {
  const data = sampleInput(); data.needs = [need('source-stamp')];
  let cards = morningDeck(data, [], now).candidates;
  assert.match(cards.find(card => card.kind === 'need')!.sourceLine, /waiting for a successful read/);
  assert.match(cards.find(card => card.kind === 'fading')!.sourceLine, /waiting for a successful read/);
  data.sourceReadAt = { 'needs:shopify': '2032-04-07T07:45:00Z', creatives: '2032-04-07T07:30:00Z' };
  cards = morningDeck(data, [], now).candidates;
  assert.match(cards.find(card => card.kind === 'need')!.sourceLine, /last read 2032-04-07T07:45:00Z/);
  assert.match(cards.find(card => card.kind === 'fading')!.sourceLine, /last read 2032-04-07T07:30:00Z/);
  assert.match(cards.find(card => card.kind === 'make-next')!.sourceLine, /last read 2032-04-07T07:30:00Z/);
});

test('facts omit changing measures and keys remain compact for Unicode subjects', () => {
  const key = morningKey('date', '😀'.repeat(100) + '|2032-04-07');
  assert.match(key, /^date:[a-f0-9]{64}$/); assert.ok(Buffer.byteLength(JSON.stringify({ cardKey: key, action: 'park' })) < 512);
  assert.equal(morningFacts('google', 'account', 'warn', ['flag-b', 'flag-a']), morningFacts('google', 'account', 'warn', ['flag-a', 'flag-b']));
  const data = sampleInput(), first = morningDeck(data, [], now).candidates.find(card => card.kind === 'meta-step')!;
  data.adSets!.rows.find(row => row.set.id === first.subjectId)!.verdict!.proposedBase = 123;
  assert.equal(morningDeck(data, [], now).candidates.find(card => card.key === first.key)!.factsHash, first.factsHash);
});

test('fading facts retain hidden state across moving measures and return for a different active trigger', () => {
  const data = sampleInput(), creative = data.creativeCards.find(card => card.kind === 'watch')!;
  creative.ruleIds = ['frequency'];
  const card = morningDeck(data, [], now).candidates.find(card => card.kind === 'fading')!;
  const hidden = state(card, { mode: 'sample', state: 'hidden', untilDay: null });
  creative.reason = 'Invented frequency moved from 3.2 to 3.4.';
  data.creativeFigures = { [creative.id]: { kind: 'thumb', src: creative.picture, alt: creative.title, value: '£18', label: 'Invented cost' } };
  assert.equal(morningDeck(data, [hidden], now).openCards.some(candidate => candidate.key === card.key), false);
  creative.ruleIds = ['ctr-drop'];
  assert.equal(morningDeck(data, [hidden], now).openCards.some(candidate => candidate.key === card.key), true);
  creative.ruleIds = ['frequency', 'ctr-drop'];
  const both = morningDeck(data, [], now).candidates.find(candidate => candidate.key === card.key)!.factsHash;
  creative.ruleIds.reverse();
  assert.equal(morningDeck(data, [], now).candidates.find(candidate => candidate.key === card.key)!.factsHash, both);
});

test('mode boundaries and UK-day slot accounting hold around summer and winter midnight', () => {
  const data = input(); data.needs = [need('clock')]; const card = morningDeck(data, [], now).candidates[0]!;
  const otherMode = state(card, { mode: 'sample', state: 'hidden', untilDay: null });
  assert.equal(morningDeck(data, [otherMode], now).snapshot.cards.length, 1);
  for (const [before, after, day] of [['2032-06-07T22:59:00Z', '2032-06-07T23:01:00Z', '2032-06-08'], ['2032-01-07T23:59:00Z', '2032-01-08T00:01:00Z', '2032-01-08']]) {
    const saved = state(card, { pressedAt: before!, untilDay: day! });
    assert.equal(morningDeck(data, [saved], new Date(before!)).snapshot.completed, 1);
    const next = morningDeck(data, [saved], new Date(after!));
    assert.equal(next.snapshot.day, day); assert.equal(next.snapshot.completed, 0); assert.equal(next.snapshot.cards.length, 1);
  }
});
