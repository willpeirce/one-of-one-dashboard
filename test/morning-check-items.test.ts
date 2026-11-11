import assert from 'node:assert/strict';
import test from 'node:test';
import type { HQBriefItem } from '../src/github-hq/model.js';
import { addDays, ukToday } from '../src/hero-range.js';
import type { AdSetCatalogueEntry } from '../src/meta-adsets/presentation.js';
import { defaultSettings } from '../src/settings.js';
import { tickerState } from '../src/ticker/model.js';
import { addMorningGoogle } from '../src/morning/google.js';
import { morningDeck, morningFacts, morningKey, type MorningCard, type MorningInput, type MorningKind, type MorningState } from '../src/morning/model.js';
import { morningBriefHtml, morningFineHtml, morningLinesHtml } from '../src/morning/view.js';

// Every identity, title, date and measure in this scenario is invented.
const now = new Date('2032-04-07T08:00:00Z'), today = ukToday(now), reportDay = addDays(today, -1);
const id = '120000000000006001';
const item = (index = 0, extra: Partial<HQBriefItem> = {}): HQBriefItem => ({ text: `Invented check ${index}`,
  lines: [`Invented first detail ${index}.`, `Invented second detail ${index}.`], ...extra });
function input(items: HQBriefItem[] = [item()]): MorningInput {
  return { mode: 'live', needs: [], checks: [], creativeCards: [], settings: defaultSettings(),
    ticker: tickerState([], [], now, 'live'), activity: [], metaActions: [], sourceReadOk: { adsets: true, google: true },
    brief: { mode: 'live', status: 'needs', text: `Morning check · 07:41 · ${items.length} items`, day: reportDay,
      runLabel: 'Invented run · 07:41', count: items.length, items, href: 'https://example.invalid/invented-stored-check' } };
}
function catalogue(data: MorningInput, extra: Partial<AdSetCatalogueEntry> = {}): MorningInput {
  data.adSets = { mode: 'live', today, lastRead: now.toISOString(), stale: false, count: 1, rows: [],
    accountYesterday: 0, actionsEnabled: true, catalogue: [{ id, name: 'Invented campaign — Invented Fern — £20',
      owner: 'ours', status: 'ACTIVE', effectiveStatus: 'ACTIVE', currency: 'GBP', ...extra }] };
  return data;
}
function ordinary(kind: MorningKind, index = 0, subjectId = `${kind}:${index}`): MorningCard {
  const state = kind === 'need' ? 'alarm' : kind === 'done-for-you' ? 'done' : 'decide';
  return { key: morningKey(kind, subjectId), kind, subjectId, state, ruleId: 'invented-rule',
    factsHash: morningFacts(kind, subjectId, state, 'invented-rule'), sourceScope: 'adsets', tier: 1, order: index,
    title: `Invented ${kind} ${index}`, lane: 'Invented decisions', source: 'meta',
    figure: { kind: 'plain', value: 'Invented', label: 'Stored read' }, why: `Invented original explanation ${index}.`,
    rule: 'An invented existing rule.', sourceLine: 'Invented stored read',
    primary: { kind: 'save', target: 'morning', label: 'Seen', action: 'ack' }, menu: [], allowedPresses: ['ack'] };
}
function saved(card: MorningCard, extra: Partial<MorningState> = {}): MorningState {
  return { mode: 'live', cardKey: card.key, kind: card.kind, subjectId: card.subjectId, sourceScope: card.sourceScope,
    factsHash: card.factsHash, state: 'seen', untilDay: addDays(today, 1), answer: null, title: card.title,
    credentialId: 'invented-device', pressedAt: now.toISOString(), clearedAt: null, ...extra };
}
const check = (data: MorningInput) => morningDeck(data, [], now).snapshot.cards.find(card => card.kind === 'check-item')!;
const liveButtons = (card: MorningCard) => [card.primary, card.secondary, ...card.menu].filter(button => button?.kind === 'live');

test('a check item keeps its title, all evidence, rule, run time and stored-entry source with safe default presses', () => {
  const data = input([item(0, { label: 'Invented label', text: 'Invented '.repeat(25) })]), before = structuredClone(data);
  const card = check(data);
  assert.equal(card.state, 'warn'); assert.equal(Array.from(card.title).length, 120); assert.ok(card.title.endsWith('…'));
  assert.deepEqual(card.figure, { kind: 'plain', value: 'Invented label', label: '07:41' });
  assert.equal(card.whyLine, data.brief!.items![0]!.lines![0]);
  assert.equal(card.why, [data.brief!.items![0]!.text, ...data.brief!.items![0]!.lines!].join('\n'));
  assert.equal(card.rule, 'Listed by the daily check. This app did not judge it.');
  assert.match(card.sourceLine, /Invented run · 07:41/); assert.equal(card.sourceHref, data.brief!.href);
  assert.deepEqual(card.primary, { kind: 'save', target: 'morning', label: 'Seen', action: 'ack' });
  assert.deepEqual(card.secondary, { kind: 'save', target: 'morning', label: 'Not today', action: 'park' });
  assert.deepEqual(card.allowedPresses, ['ack', 'park']); assert.deepEqual(data, before);
  const legacy = check(input([{ text: 'Invented legacy item without lines' }]));
  assert.deepEqual(legacy.figure, { kind: 'plain', value: 'Morning check', label: '07:41' });
  assert.equal(legacy.why, 'Invented legacy item without lines'); assert.equal(legacy.whyLine, undefined);
});

test('only the shown successfully read entry for yesterday can supply check cards', () => {
  for (const status of ['unreadable', 'missing', 'key'] as const) {
    const data = input(); data.brief!.status = status;
    assert.equal(morningDeck(data, [], now).snapshot.cards.length, 0, status);
  }
  for (const day of [addDays(reportDay, -1), today]) {
    const data = input(); data.brief!.day = day;
    assert.equal(morningDeck(data, [], now).snapshot.cards.length, 0, day);
  }
  const missing = input(); missing.brief = null;
  assert.equal(morningDeck(missing, [], now).snapshot.cards.length, 0);
  const mismatched = input(); mismatched.brief!.mode = 'sample';
  assert.equal(morningDeck(mismatched, [], now).snapshot.cards.length, 0);
  const ok = input(); ok.brief!.status = 'ok';
  assert.equal(morningDeck(ok, [], now).snapshot.cards.length, 1);
});

test('item identity changes with report day, position or content but survives a new run label and link', () => {
  const original = input(), card = check(original), rerun = structuredClone(original);
  rerun.brief!.runLabel = 'Invented later run · 09:42'; rerun.brief!.href = 'https://example.invalid/invented-rerun';
  assert.equal(check(rerun).key, card.key); assert.equal(check(rerun).factsHash, card.factsHash);
  assert.equal(morningDeck(rerun, [saved(card)], now).snapshot.cards.length, 0);
  for (const change of [
    (entry: HQBriefItem) => { entry.text += ' changed'; },
    (entry: HQBriefItem) => { entry.label = 'Changed'; },
    (entry: HQBriefItem) => { entry.lines = ['Changed evidence']; },
    (entry: HQBriefItem) => { entry.tag = { type: 'info' }; },
  ]) {
    const changed = structuredClone(original); change(changed.brief!.items![0]!);
    assert.notEqual(check(changed).key, card.key);
    assert.equal(morningDeck(changed, [saved(card)], now).snapshot.cards.length, 1);
  }
  const shifted = input([item(9), item(0)]);
  assert.notEqual(morningDeck(shifted, [], now).snapshot.cards[1]!.key, card.key);
  const nextDay = structuredClone(original); nextDay.brief!.day = today;
  assert.notEqual(morningDeck(nextDay, [], new Date('2032-04-08T08:00:00Z')).snapshot.cards[0]!.key, card.key);
});

test('dated and freelancer labels follow explicit tag precedence, with dated evidence above parked cards', () => {
  const data = input([
    item(0, { tag: { type: 'dated' } }), item(1, { label: 'Dated' }),
    item(2, { label: 'Google', tag: { type: 'info' } }), item(3, { label: 'Dated', tag: { type: 'pause', adSetId: id } }),
  ]), result = morningDeck(data, [], now).snapshot;
  assert.deepEqual(result.datedFromCheck, data.brief!.items!.slice(0, 2).map(item => ({ text: item.text, lines: item.lines })));
  assert.deepEqual(result.cards.map(card => card.title), ['Invented check 3', 'Invented check 2']);
  assert.equal(result.cards.some(card => card.kind === 'google'), false, 'Explicit info overrides the Google label');
  const html = morningFineHtml(result);
  assert.ok(html.indexOf('Dated, from the check') < html.indexOf('Parked and hidden'));
  for (const dated of result.datedFromCheck!) for (const line of [dated.text, ...dated.lines!]) assert.ok(html.includes(line));
  assert.equal(result.brief!.allInDeck, false, 'Dated items live in Fine, so the literal all-in-deck claim would be false');
});

test('freelancer items fold into the existing card or create one weekly message decision when no loss card exists', () => {
  const items = [item(0, { tag: { type: 'freelancer' } }), item(1, { label: 'Google' }), item(2, { label: 'TikTok' })];
  const data = input(items), fallback = morningDeck(data, [], now).snapshot;
  assert.deepEqual(fallback.cards.map(card => card.kind), ['google']); assert.equal(fallback.brief!.allInDeck, true);
  const card = fallback.cards[0]!;
  assert.equal(card.state, 'decide'); assert.equal(card.figure.kind, 'plain'); assert.equal(card.primary.kind, 'copy');
  assert.deepEqual(card.secondary, { kind: 'save', target: 'morning', label: 'Leave it, ask in a week', action: 'hold', days: 7 });
  assert.deepEqual(card.allowedPresses, ['hold', 'hide']); assert.equal(liveButtons(card).length, 0);
  for (const entry of items) for (const line of [entry.text, ...entry.lines!]) {
    assert.ok(card.why.includes(line)); if (card.primary.kind === 'copy') assert.ok(card.primary.text.includes(line));
  }
  data.needs = [{ id: 'google-network:invented', source: 'google-ads', state: 'warn', title: 'Invented existing flag',
    why: 'Invented existing evidence.', link: '/settings', googleFlag: { kind: 'network', rule: 'Invented bar.', sourceLine: 'Invented read' } }];
  const decorated = addMorningGoogle(data), ordinaryCard = decorated.extensions![0]!;
  const combined = morningDeck(decorated, [], now).snapshot.cards[0]!;
  assert.equal(combined.key, ordinaryCard.key); assert.equal(combined.factsHash, ordinaryCard.factsHash);
  assert.ok(combined.why.startsWith(ordinaryCard.why)); assert.match(combined.why, /From the morning check/);
  assert.equal(morningDeck(decorated, [], now).snapshot.cards.length, 1);
  const baseline = structuredClone(decorated), watch = baseline.extensions![0]!;
  watch.state = 'warn'; watch.tier = 2; watch.allowedPresses = ['park', 'hide'];
  watch.secondary = { kind: 'save', target: 'morning', label: 'Not today', action: 'park' };
  const promoted = morningDeck(baseline, [], now).snapshot.cards;
  assert.equal(promoted.length, 1); assert.equal(promoted[0]!.state, 'decide', 'E remains useful if D is reverted to its old Watch card');
  assert.equal(promoted[0]!.key, watch.key); assert.equal(promoted[0]!.factsHash, watch.factsHash);
  assert.deepEqual(promoted[0]!.allowedPresses, ['hold', 'hide']);
  assert.deepEqual(promoted[0]!.secondary, card.secondary);
});

test('check evidence folds only into an open matching Kill, Slipping or Step and never changes its identity or actions', () => {
  for (const kind of ['meta-kill', 'meta-slipping', 'meta-step'] as const) {
    const data = input([item(0, { text: `Invented linked set \`${id}\`` }), item(1, { tag: { type: 'pause', adSetId: id } })]);
    const original = ordinary(kind, 0, id); data.extensions = [original];
    const result = morningDeck(data, [], now).snapshot, card = result.cards[0]!;
    assert.deepEqual(result.cards.map(card => card.kind), [kind]); assert.equal(result.brief!.allInDeck, true);
    assert.equal(card.key, original.key); assert.equal(card.factsHash, original.factsHash); assert.deepEqual(card.primary, original.primary);
    assert.ok(card.why.startsWith(original.why)); assert.match(card.why, /From the morning check/);
    for (const entry of data.brief!.items!) for (const line of [entry.text, ...entry.lines!]) assert.ok(card.why.includes(line));
    const held = saved(original, { state: 'answered', answer: 'hold', untilDay: '2032-04-14' });
    assert.deepEqual(morningDeck(data, [held], now).snapshot.cards.map(card => card.kind), ['check-item', 'check-item']);
  }
  const precedence = input([item(0, { text: `Invented linked \`${id}\``, tag: { type: 'freelancer' } })]);
  precedence.extensions = [ordinary('meta-kill', 0, id)];
  assert.deepEqual(morningDeck(precedence, [], now).snapshot.cards.map(card => card.kind), ['meta-kill', 'google']);
});

test('pause, hold and ordinary items offer only the existing guarded Pause for our active stored set', () => {
  const pauseItem = item(0, { tag: { type: 'pause', adSetId: id } });
  const pause = check(catalogue(input([pauseItem])));
  assert.equal(pause.state, 'decide'); assert.equal(pause.primary.kind, 'live'); assert.equal(pause.primary.label, 'Pause');
  if (pause.primary.kind === 'live') { assert.equal(pause.primary.adSetId, id); assert.equal(pause.primary.action, 'pause'); assert.ok(pause.primary.confirm); }
  assert.deepEqual(pause.secondary, { kind: 'save', target: 'morning', label: 'One more day', action: 'park' });
  assert.deepEqual(pause.menu.map(button => button.kind === 'save' ? [button.label, button.action, 'days' in button ? button.days : null] : []),
    [['Hold 3 days', 'hold', 3], ['Hold 7 days', 'hold', 7]]);
  const hold = check(catalogue(input([item(0, { tag: { type: 'hold', adSetId: id } })])));
  assert.equal(hold.state, 'decide'); assert.deepEqual(hold.primary, { kind: 'save', target: 'morning', label: 'Hold, look tomorrow', action: 'park' });
  assert.equal(hold.secondary!.kind, 'live'); assert.equal(hold.secondary!.label, 'Pause it now'); assert.deepEqual(hold.allowedPresses, ['park']);
  const watch = check(catalogue(input([item(0, { text: `Invented set \`${id}\`` })])));
  assert.equal(watch.state, 'warn'); assert.equal(watch.primary.kind, 'save'); assert.equal(watch.menu[0]!.kind, 'live'); assert.equal(watch.menu[0]!.label, 'Pause it now');
});

test('paused, foreign, unavailable, wrong-mode, pending and 25-digit sets never receive any live check-item Pause', () => {
  for (const extra of [{ status: 'PAUSED' }, { effectiveStatus: 'PAUSED' }, { owner: 'freelancer' as const },
    { owner: 'unassigned' as const }, { currency: 'USD' }]) {
    const data = catalogue(input([item(0, { tag: { type: 'pause', adSetId: id } })]), extra), card = check(data);
    assert.equal(liveButtons(card).length, 0); assert.equal(card.primary.kind, 'link'); assert.equal(card.primary.label, 'Open set');
  }
  for (const alter of [
    (data: MorningInput) => { data.adSets!.actionsEnabled = false; },
    (data: MorningInput) => { data.mode = 'sample'; data.brief!.mode = 'sample'; data.adSets!.mode = 'sample'; },
    (data: MorningInput) => { data.adSets!.mode = 'sample'; },
    (data: MorningInput) => { data.metaActions = [{ id: 'invented-pending', adSetId: id, action: 'pause', result: 'pending',
      time: now.toISOString(), oldValue: 'ACTIVE', newValue: 'PAUSED', errorCode: null, undoneAt: null, undoOf: null }]; },
  ]) {
    const data = catalogue(input([item(0, { tag: { type: 'pause', adSetId: id } })])); alter(data);
    assert.equal(liveButtons(check(data)).length, 0);
  }
  const missing = check(input([item(0, { tag: { type: 'pause', adSetId: id } })]));
  assert.equal(missing.primary.kind, 'save'); assert.equal(missing.primary.label, 'Seen'); assert.ok(missing.allowedPresses.includes('ack'));
  const longId = '1200000000000000000000001';
  const long = check(catalogue(input([item(0, { tag: { type: 'pause', adSetId: longId } })]), { id: longId }));
  assert.equal(liveButtons(long).length, 0); assert.equal(long.primary.kind, 'link');
  if (long.primary.kind === 'link') assert.equal(long.primary.href, `/ads?set=${longId}#${longId}`);
  const ambiguous = check(catalogue(input([item(0, { text: `Invented sets \`${id}\` and \`120000000000006002\`` })])));
  assert.equal(liveButtons(ambiguous).length, 0, 'Two code-span IDs never guess a live target');
});

test('explicit tag IDs take precedence over a title ID and old stored reads without catalogue still work', () => {
  const otherId = '120000000000006002', data = catalogue(input([item(0, {
    text: `Invented mismatched title \`${otherId}\``, tag: { type: 'pause', adSetId: id },
  })]));
  const card = check(data); assert.equal(card.primary.kind, 'live');
  if (card.primary.kind === 'live') assert.equal(card.primary.adSetId, id);
  // The old row shape is sufficient for the lookup; no source write or new read is necessary.
  const set = data.adSets!.catalogue![0]!;
  data.adSets!.rows = [{ set, verdict: null } as unknown as NonNullable<MorningInput['adSets']>['rows'][number]];
  delete data.adSets!.catalogue;
  assert.equal(check(data).primary.kind, 'live');
});

test('only complete unescaped digit-only code spans can supply an untagged live Pause target', () => {
  for (const text of [
    `Invented prose \`\`other \`${id}\` text\`\``,
    `Invented escaped \\\`${id}\``,
    `Invented duplicate \`${id}\` and \`${id}\``,
    `Invented suffix \`${id}other\``,
  ]) assert.equal(liveButtons(check(catalogue(input([item(0, { text })])))).length, 0, text);
  const double = check(catalogue(input([item(0, { text: `Invented numeric \`\`${id}\`\`` })])));
  assert.equal(liveButtons(double).length, 1);
});

test('mandatory cards are uncapped; Watch check items use min(available, max(3, 7 minus mandatory)) in source order', () => {
  for (const [mandatory, available] of [[0, 10], [2, 10], [4, 10], [9, 10], [9, 2], [12, 0]] as const) {
    const data = input(Array.from({ length: available }, (_, index) => item(index)));
    data.extensions = Array.from({ length: mandatory }, (_, index) => ordinary('meta-kill', index));
    const result = morningDeck(data, [], now).snapshot, shown = Math.min(available, Math.max(3, 7 - mandatory));
    assert.equal(result.cards.length, mandatory + shown);
    assert.deepEqual(result.cards.filter(card => card.kind === 'check-item').map(card => card.title),
      Array.from({ length: shown }, (_, index) => `Invented check ${index}`));
    assert.equal(result.more, available - shown); assert.equal(result.brief!.moreHere, available - shown);
    assert.equal(result.watchOnHome, 0, 'Capped check items live in the sheet, not the Home Watch count');
    assert.equal(result.total, mandatory + shown);
    assert.equal(result.brief!.allInDeck, available > 0 && shown === available);
    if (available > shown) {
      assert.match(morningLinesHtml(result), new RegExp(`· ${available - shown} more here`));
      assert.ok(morningBriefHtml(result.brief!).includes(`Invented first detail ${available - 1}.`));
    }
  }
});

test('pause and hold check decisions sit after Slipping, before Step, while Watch items stay after the freelancer', () => {
  const data = input([item(0), item(1, { tag: { type: 'hold', adSetId: id } }), item(2, { tag: { type: 'pause', adSetId: id } }), item(3)]);
  data.extensions = ['google', 'done-for-you', 'meta-step', 'meta-slipping', 'meta-kill', 'need'].map(kind => ordinary(kind as MorningKind));
  const result = morningDeck(data, [], now).snapshot;
  assert.deepEqual(result.cards.map(card => card.kind === 'check-item' ? card.title : card.kind),
    ['need', 'meta-kill', 'meta-slipping', 'Invented check 1', 'Invented check 2', 'meta-step', 'done-for-you', 'google', 'Invented check 0', 'Invented check 3']);
  assert.equal(result.brief!.allInDeck, true); assert.match(morningLinesHtml(result), /· all in the deck/);
});

test('answered standalone items remain represented, but dated and truncated source items prevent an all-in-deck claim', () => {
  const data = input([item(0), item(1)]), first = morningDeck(data, [], now).snapshot.cards[0]!;
  const answered = morningDeck(data, [saved(first)], now).snapshot;
  assert.equal(answered.completed, 1); assert.equal(answered.total, 2); assert.equal(answered.brief!.allInDeck, true);
  data.brief!.count = 3;
  assert.equal(morningDeck(data, [saved(first)], now).snapshot.brief!.allInDeck, false);
  const dated = input([item(0, { tag: { type: 'dated' } })]);
  assert.equal(morningDeck(dated, [], now).snapshot.brief!.allInDeck, false);
});
