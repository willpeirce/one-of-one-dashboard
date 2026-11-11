import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultSettings } from '../src/settings.js';
import { getSampleDashboard } from '../src/sample-dashboard.js';
import type { DashboardNeed } from '../src/shopify/dashboard.js';
import type { GoogleFlagDetail } from '../src/google-ads/model.js';
import { addDays, ukToday } from '../src/hero-range.js';
import type { StoredAdSet } from '../src/meta-adsets/catalogue.js';
import { buildAdSetsView } from '../src/meta-adsets/presentation.js';
import type { SetDay } from '../src/meta-adsets/rules.js';
import { tickerState } from '../src/ticker/model.js';
import { addMorningGoogle } from '../src/morning/google.js';
import { morningInputFromDashboard } from '../src/morning/inputs.js';
import { homeMorningOmissions } from '../src/morning/home.js';
import { morningDeck, morningFacts, morningKey, type MorningCard, type MorningInput, type MorningState } from '../src/morning/model.js';
import { curateMorningSample } from '../src/morning/sample.js';

const now = new Date('2032-04-07T08:00:00Z');
function input(needs: DashboardNeed[] = []): MorningInput {
  return { mode: 'live', needs, checks: [], creativeCards: [], settings: { ...defaultSettings(), googleCustomerId: 'invented-google-account' },
    ticker: tickerState([], [], now, 'live'), activity: [], metaActions: [], sourceReadOk: { google: true, 'needs:google-ads': true } };
}
function flag(kind: GoogleFlagDetail['kind'], id = `google-${kind}:invented`): DashboardNeed {
  const measures: Partial<Record<GoogleFlagDetail['kind'], GoogleFlagDetail['measure']>> = {
    under: { value: 1.4, bar: 2, label: 'Google ROAS · 7 complete UK days', formattedValue: '1.40×', formattedBar: '2×' },
    network: { value: 0.8, bar: 1.2, label: 'Google network ROAS · 7 complete UK days', formattedValue: '0.80×', formattedBar: '1.2×' },
    nosale: { value: 30, bar: 25, label: 'Spend with no sales · 7 complete UK days', formattedValue: '£30', formattedBar: '£25' },
    'content-share': { value: 8, bar: 2, label: 'Content share · 7 complete UK days', formattedValue: '8%', formattedBar: '2%' },
  };
  return { id, source: 'google-ads', state: 'warn', title: `Invented ${kind} flag`,
    why: `Invented ${kind} campaign details with 17 complete observations.`, link: '/settings',
    ...(kind === 'content-share' ? { figure: { value: '8%', label: '7 complete UK days' } } : {}),
    googleFlag: { kind, rule: `Invented ${kind} rule`, sourceLine: `Invented ${kind} report · last read ${now.toISOString()}`,
      ...(measures[kind] ? { measure: measures[kind] } : {}) } };
}
const googleCard = (data: MorningInput) => morningDeck(addMorningGoogle(data), [], now).candidates.find(card => card.kind === 'google')!;
interface SetFigures { name: string; spend: number; purchases: number | null; owner?: StoredAdSet['owner']; currency?: string }
function withMeta(data: MorningInput, figures: SetFigures[]): MorningInput {
  const today = ukToday(now), born = addDays(today, -7), days = new Map<string, SetDay[]>();
  const sets = figures.map((figures, index): StoredAdSet => {
    const id = `120000000000004${String(index).padStart(3, '0')}`;
    days.set(id, Array.from({ length: 7 }, (_, offset) => ({ day: addDays(born, offset),
      spend: offset ? 0 : figures.spend, purchases: offset ? 0 : figures.purchases, addsToCart: 3 })));
    return { id, campaignId: '120000000000005001', name: `Invented campaign — ${figures.name} — £20`,
      owner: figures.owner ?? 'freelancer', market: 'uk', status: 'ACTIVE', effectiveStatus: 'ACTIVE',
      currency: figures.currency ?? 'GBP', flatBudget: null, dailyBudget: null, lifetimeBudget: null,
      createdTime: `${born}T08:00:00Z`, updatedTime: `${born}T08:00:00Z`, learningStage: null, lastSignificantEdit: null,
      campaignName: 'Invented garden', firstSeen: `${born}T08:00:00Z`, lastSeen: now.toISOString(), lastRead: now.toISOString() };
  });
  data.adSets = buildAdSetsView(sets, days, data.settings, today, { mode: data.mode, lastRead: now.toISOString(), accountYesterday: 0 });
  data.adSets.actionsEnabled = true;
  return data;
}
function saved(card: MorningCard, state: 'parked' | 'hidden' = 'hidden'): MorningState {
  return { mode: 'live', cardKey: card.key, state, untilDay: state === 'parked' ? '2032-04-08' : null,
    factsHash: card.factsHash, answer: null, credentialId: 'invented-device', pressedAt: now.toISOString(), clearedAt: null,
    title: card.title, kind: card.kind, subjectId: card.subjectId, sourceScope: card.sourceScope };
}

test('Morning gathers typed Google rule flags into one Decide card in the fixed priority, preserving original Home inputs', () => {
  const ordinary: DashboardNeed = { id: 'google-future:invented', source: 'google-ads', state: 'warn', title: 'An invented later Google check', why: 'An invented count of 91.', link: '/settings' };
  const flags = [ordinary, ...(['expected-list', 'unexpected', 'bidding', 'content-share', 'nosale', 'network', 'under'] as const).map(kind => flag(kind))];
  const data = input(flags), before = structuredClone(data), decorated = addMorningGoogle(data);
  const cards = morningDeck(decorated, [], now).candidates;
  assert.equal(cards.length, 2); assert.equal(cards[0]!.kind, 'google');
  assert.equal(cards[0]!.tier, 1); assert.equal(cards[0]!.order, 20_000);
  assert.equal(cards[0]!.state, 'decide');
  assert.deepEqual(morningDeck(decorated, [], now).snapshot.cards.map(card => card.kind), ['google']);
  assert.equal(cards[0]!.title, 'Invented network flag', 'Network and under break-even share the first priority');
  assert.deepEqual(decorated.excludeNeedIds?.slice().sort(), flags.filter(row => row.googleFlag).map(row => row.id).sort());
  assert.equal(decorated.needs, data.needs);
  assert.deepEqual(data, before);
  assert.deepEqual(addMorningGoogle(decorated), decorated, 'The pure decorator is idempotent');
  assert.deepEqual([...cards[0]!.why.matchAll(/^(Invented \S+ flag|An invented later Google check)$/gm)].map(match => match[0]),
    ['Invented network flag', 'Invented under flag', 'Invented nosale flag', 'Invented content-share flag', 'Invented bidding flag', 'Invented unexpected flag', 'Invented expected-list flag']);
  const fallback = flags.map(({ googleFlag: _metadata, ...row }) => row);
  assert.equal(morningDeck(addMorningGoogle(input(fallback)), [], now).candidates.some(card => card.kind === 'google'), false, 'IDs without rule metadata remain ordinary linked cards');
});

test('Google figure uses the first typed measure and Also shows the next line', () => {
  const under = flag('under', 'opaque-invented-id'), content = flag('content-share');
  const card = googleCard(input([content, under]));
  assert.deepEqual(card.figure, { kind: 'dial', ...under.googleFlag!.measure });
  assert.match(card.flag!, /^Also: Invented content-share flag/);
  assert.equal(googleCard(input([content])).flag, undefined);
  for (const kind of ['nosale', 'content-share', 'bidding', 'unexpected', 'expected-list'] as const) {
    const card = googleCard(input([flag(kind)]));
    assert.equal(card.title, `Invented ${kind} flag`);
    assert.equal(card.figure.kind, ['nosale', 'content-share'].includes(kind) ? 'dial' : 'plain');
  }
  const plain = flag('bidding'); plain.figure = { value: 'Review bidding', label: 'Invented campaign settings' };
  assert.deepEqual(googleCard(input([plain])).figure, { kind: 'plain', ...plain.figure });
});

test('Google note and why contain every flag and its numbers, configured contact only labels a copy action', () => {
  const flags = [flag('network'), flag('nosale'), flag('content-share'), flag('bidding'), flag('unexpected'), flag('expected-list')];
  const data = input(flags); data.settings.googleContactName = '  Invented contact  ';
  const card = googleCard(data);
  assert.equal(card.primary.kind, 'copy'); assert.equal(card.primary.label, 'Message for Invented contact');
  if (card.primary.kind !== 'copy') assert.fail('Google must offer only a note to copy');
  for (const row of flags) {
    assert.ok(card.why.includes(row.title)); assert.ok(card.why.includes(row.why));
    assert.ok(card.primary.text.includes(row.title)); assert.ok(card.primary.text.includes(row.why));
    assert.ok(card.rule.includes(row.googleFlag!.rule)); assert.ok(card.sourceLine.includes(row.googleFlag!.sourceLine));
    if (row.googleFlag!.measure) for (const number of [row.googleFlag!.measure.formattedValue, row.googleFlag!.measure.formattedBar]) {
      assert.ok(card.primary.text.includes(number)); assert.ok(card.why.includes(number));
    }
  }
  assert.deepEqual(card.allowedPresses, ['hold', 'hide']);
  assert.deepEqual(card.secondary, { kind: 'save', target: 'morning', label: 'Leave it, ask in a week', action: 'hold', days: 7 });
  assert.deepEqual(card.menu, [{ kind: 'save', target: 'morning', label: 'Stop showing this', action: 'hide' }]);
  data.settings.googleContactName = '';
  assert.equal(googleCard(data).primary.label, 'Copy a message');
});

test('Google saved facts ignore moving figures and flag ordering; a new flag restores both parked and hidden cards', () => {
  const data = input([flag('nosale'), flag('network')]), card = googleCard(data);
  assert.equal(card.key, morningKey('google', data.settings.googleCustomerId));
  assert.equal(card.subjectId, data.settings.googleCustomerId); assert.equal(card.sourceScope, 'google');
  assert.equal(card.factsHash, morningFacts('google', data.settings.googleCustomerId, 'warn', data.needs.map(need => need.id)),
    'A stored Watch state retains its exact key and warn-based facts hash after the card becomes Decide');
  const rows = [saved(card), saved(card, 'parked')];
  const reordered = { ...data, needs: [...data.needs].reverse() };
  reordered.needs[0]!.googleFlag!.measure!.value = 999;
  reordered.needs[0]!.googleFlag!.measure!.formattedValue = '999×';
  reordered.needs[0]!.why = 'Invented moving measurements of 999.';
  assert.equal(googleCard(reordered).factsHash, card.factsHash);
  for (const row of rows) assert.equal(morningDeck(addMorningGoogle(reordered), [row], now).openCards.length, 0);
  const changed = addMorningGoogle({ ...reordered, needs: [...reordered.needs, flag('content-share')] });
  assert.notEqual(googleCard(changed).factsHash, card.factsHash);
  for (const row of rows) assert.equal(morningDeck(changed, [row], now).openCards.length, 1);
  changed.sourceReadOk.google = false;
  assert.equal(morningDeck(changed, [rows[0]!], now).openCards.length, 1, 'A present changed flag set restores the card during a failed read');
  assert.equal(googleCard({ ...data, needs: [...data.needs, data.needs[0]!] }).factsHash, card.factsHash, 'Duplicate flag IDs do not alter the sorted set');
});

test('shared Dashboard projection and Home omissions use the aggregate facts without concealing Alarms', () => {
  const needs = [flag('network'), flag('bidding')], settings = defaultSettings(), dashboard = getSampleDashboard(settings);
  dashboard.shopify = { mode: 'live', needs, checks: [], stock: [], detail: {}, live: { lastOrder: 'Invented', dispatch: 'Invented', carts: 'Invented' } };
  const data = morningInputFromDashboard(dashboard, settings, tickerState([], [], now, 'live'), 'live');
  assert.equal(data.needs, needs); assert.equal(morningDeck(data, [], now).candidates.length, 1);
  data.sourceReadOk.google = true;
  const card = morningDeck(data, [], now).candidates[0]!;
  for (const state of ['parked', 'hidden'] as const) assert.deepEqual(homeMorningOmissions(data, [saved(card, state)], now),
    { needs: needs.map(need => need.id), adSets: [], creatives: [] });
  const changed = addMorningGoogle({ ...data, needs: [...needs, flag('content-share')] });
  assert.equal(homeMorningOmissions(changed, [saved(card)], now), undefined, 'A new flag returns all underlying Home needs');
  const alarm = { ...needs[0]!, state: 'alarm' as const };
  const escalated = addMorningGoogle({ ...data, needs: [alarm, needs[1]!] });
  assert.ok(morningDeck(escalated, [], now).candidates.some(row => row.state === 'alarm' && row.subjectId === alarm.id));
  assert.ok(!escalated.excludeNeedIds!.includes(alarm.id));
  const remaining = morningDeck(escalated, [], now).candidates.find(row => row.kind === 'google')!;
  assert.deepEqual(homeMorningOmissions(escalated, [saved(remaining)], now)?.needs, [needs[1]!.id]);
});

test('sample Google uses the same note builder with explicit labels and never appears in live inputs without flags', () => {
  const live = input(), sample = { ...live, mode: 'sample' as const };
  sample.settings.googleContactName = 'Invented contact';
  const curated = curateMorningSample(sample, now), cards = morningDeck(curated, [], now).candidates;
  const google = cards.filter(card => card.kind === 'google');
  assert.equal(google.length, 1); assert.match(google[0]!.lane, /sample data/); assert.match(google[0]!.sourceLine, /invented/);
  assert.equal(google[0]!.primary.kind, 'copy'); assert.equal(google[0]!.primary.label, 'Message for Invented contact');
  if (google[0]!.primary.kind === 'copy') assert.match(google[0]!.primary.text, /Sample data.*invented.*Google checks[\s\S]*8%[\s\S]*2%[\s\S]*£8[\s\S]*£100/);
  assert.equal(addMorningGoogle(live), live);
  assert.equal(morningDeck(curateMorningSample(live, now), [], now).candidates.length, 0);
  const recycled = addMorningGoogle({ ...live, extensions: google });
  assert.equal(morningDeck(recycled, [], now).candidates.length, 0, 'A prior sample Google extension cannot leak into live output');
});

test('Google health needs keep their own card/link and never enter the rule note', () => {
  const health: DashboardNeed = {id: 'source-health:google', state: 'warn', source: 'google-ads',
    title: 'Invented source read failed', why: 'Invented unavailable source', link: '/sources'};
  const data = addMorningGoogle(input([health, flag('nosale')]));
  const cards = morningDeck(data, [], now).candidates;
  assert.equal(cards.length, 2);
  assert.deepEqual(cards.find(card => card.kind === 'need')!.primary, {kind: 'link', label: 'Open source health', href: '/sources'});
  const note = cards.find(card => card.kind === 'google')!.primary;
  assert.equal(note.kind, 'copy'); if (note.kind === 'copy') { assert.match(note.text, /nosale/); assert.doesNotMatch(note.text, /source read failed|unavailable source/); }
});

test('Google flags and two freelancer Meta losses make one copy-only decision with every line in priority order', () => {
  const data = withMeta(input([flag('nosale'), flag('network')]), [
    { name: 'Invented Fern', spend: 120, purchases: 3 },
    { name: 'Invented Cedar', spend: 150, purchases: 2 },
  ]);
  const before = structuredClone(data), decorated = addMorningGoogle(data), result = morningDeck(decorated, [], now);
  assert.deepEqual(result.snapshot.cards.map(card => card.kind), ['google']);
  assert.equal(result.snapshot.total, 1);
  const card = result.snapshot.cards[0]!;
  assert.equal(card.state, 'decide'); assert.equal(card.title, 'Invented network flag');
  assert.deepEqual(card.figure, { kind: 'dial', ...data.needs[1]!.googleFlag!.measure });
  assert.match(card.flag!, /^Also: Invented nosale flag/);
  const ordered = ['Invented network flag', 'Invented nosale flag', 'Invented Cedar', 'Invented Fern'];
  assert.equal(card.primary.kind, 'copy');
  if (card.primary.kind !== 'copy') assert.fail('The freelancer can only receive a copied message');
  for (const text of [card.why, card.primary.text]) {
    let previous = -1;
    for (const line of ordered) {
      const at = text.indexOf(line); assert.ok(at > previous, `${line} follows the preceding line`); previous = at;
    }
    for (const figure of ['£150', '£75', '£120', '£40', '£30']) assert.ok(text.includes(figure), `${figure} stays in the full evidence`);
  }
  assert.match(card.rule, /never changes the freelancer.s ads/i);
  assert.ok([card.primary, card.secondary, ...card.menu].every(button => button?.kind !== 'live' && button?.kind !== 'pause-all'));
  assert.deepEqual(data, before, 'Projection does not mutate the stored read');
  assert.deepEqual(addMorningGoogle(decorated), decorated);
});

test('without Google flags the costliest freelancer Meta set leads, with known zero purchases shown honestly', () => {
  const data = withMeta(input(), [
    { name: 'Invented Fern', spend: 120, purchases: 3 },
    { name: 'Invented Cedar', spend: 150, purchases: 2 },
  ]), card = googleCard(data);
  assert.match(card.title, /Invented Cedar/); assert.match(card.flag!, /^Also: .*Invented Fern/);
  assert.equal(card.figure.kind, 'dial');
  if (card.figure.kind !== 'dial') assert.fail('A known positive purchase cost uses its measured dial');
  assert.equal(card.figure.value, 75); assert.equal(card.figure.bar, data.settings.adRules.freelancerTriggerGbp);
  const zero = googleCard(withMeta(input(), [
    { name: 'Invented Fern', spend: 120, purchases: 3 },
    { name: 'Invented Willow', spend: 75, purchases: 0 },
  ]));
  assert.match(zero.title, /Invented Willow/); assert.equal(zero.figure.kind, 'plain');
  if (zero.figure.kind !== 'plain') assert.fail('Zero purchases must not create a fabricated numeric ratio');
  assert.equal(zero.figure.value, 'No purchases');
  assert.doesNotMatch(JSON.stringify(zero), /Infinity|NaN/);
});

test('freelancer Meta spend floor is inclusive and cost must be strictly over the bar, with unknown actions excluded', () => {
  const cases: Array<[SetFigures, boolean]> = [
    [{ name: 'Invented at floor', spend: 75, purchases: 2 }, true],
    [{ name: 'Invented below floor', spend: 74, purchases: 1 }, false],
    [{ name: 'Invented at cost bar', spend: 90, purchases: 3 }, false],
    [{ name: 'Invented below cost bar', spend: 90, purchases: 4 }, false],
    [{ name: 'Invented unknown actions', spend: 90, purchases: null }, false],
    [{ name: 'Invented known zero', spend: 75, purchases: 0 }, true],
    [{ name: 'Invented own set', spend: 90, purchases: 1, owner: 'ours' }, false],
    [{ name: 'Invented unassigned set', spend: 90, purchases: 1, owner: 'unassigned' }, false],
    [{ name: 'Invented dollar set', spend: 90, purchases: 1, currency: 'USD' }, false],
  ];
  for (const [figures, eligible] of cases) {
    const data = withMeta(input(), [figures]), projected = morningDeck(addMorningGoogle(data), [], now);
    assert.equal(projected.snapshot.cards.some(card => card.kind === 'google'), eligible, figures.name);
    if (!eligible) assert.ok(projected.snapshot.fine.some(row => row.label === 'No Google flags'));
  }
  const noSpend = withMeta(input(), [{ name: 'Invented no spend', spend: 0, purchases: 0 }]);
  noSpend.settings.adRules.killFloorGbp = 0;
  assert.equal(googleCard(noSpend), undefined, 'No spend never becomes a loss at a zero floor');
});

test('freelancer messages use matching source modes and remain available with live actions disabled', () => {
  const data = withMeta(input(), [{ name: 'Invented Fern', spend: 90, purchases: 1 }]);
  data.adSets!.actionsEnabled = false;
  assert.equal(googleCard(data).primary.kind, 'copy');
  data.adSets!.mode = 'sample';
  assert.equal(googleCard(data), undefined, 'Sample Meta figures cannot enter a live freelancer message');
  data.mode = 'sample';
  assert.equal(googleCard(data).primary.kind, 'copy');
  assert.match(googleCard(data).sourceLine, /sample/i);
  data.adSets!.mode = 'live';
  assert.equal(googleCard(data), undefined, 'A sample message cannot present live Meta figures as invented');
});

test('Meta line identities join the legacy Google hash, while changed figures and ranking keep the same state', () => {
  const data = withMeta(input([flag('network')]), [
    { name: 'Invented Fern', spend: 120, purchases: 3 },
    { name: 'Invented Cedar', spend: 150, purchases: 2 },
  ]), card = googleCard(data), held = saved(card);
  assert.equal(card.factsHash, morningFacts('google', data.settings.googleCustomerId, 'warn', [
    ...data.needs.map(need => need.id), ...data.adSets!.rows.map(row => `meta:${row.set.id}:purchase-cost`),
  ]));
  const changed = withMeta(input([flag('network')]), [
    { name: 'Invented Fern', spend: 180, purchases: 2 },
    { name: 'Invented Cedar', spend: 100, purchases: 2 },
  ]);
  assert.equal(googleCard(changed).factsHash, card.factsHash);
  assert.equal(morningDeck(addMorningGoogle(changed), [held], now).snapshot.cards.length, 0);
  changed.adSets!.rows = changed.adSets!.rows.filter(row => row.set.id !== data.adSets!.rows[0]!.set.id);
  assert.notEqual(googleCard(changed).factsHash, card.factsHash);
  assert.equal(morningDeck(addMorningGoogle(changed), [held], now).snapshot.cards.length, 1);
});

test('a held combined freelancer card omits only Google Watch rows from Home and never its Alarm or Meta rows', () => {
  const alarm = { ...flag('under'), state: 'alarm' as const }, watch = flag('network');
  const data = addMorningGoogle(withMeta(input([alarm, watch]), [{ name: 'Invented Fern', spend: 90, purchases: 1 }]));
  const card = googleCard(data), held: MorningState = { ...saved(card), state: 'answered', answer: 'hold', untilDay: '2032-04-14' };
  assert.deepEqual(homeMorningOmissions(data, [held], now), { needs: [watch.id], adSets: [], creatives: [] });
  const deck = morningDeck(data, [held], now).snapshot;
  assert.deepEqual(deck.cards.map(card => card.subjectId), [alarm.id]);
  assert.equal(deck.cards[0]!.state, 'alarm');
  assert.equal(homeMorningOmissions(data, [held], new Date('2032-04-14T08:00:00Z')), undefined);
});
