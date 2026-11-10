import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { Database } from '../src/db.js';
import { dashboardPage } from '../src/dashboard-view.js';
import { decisionsHtml } from '../src/decisions/view.js';
import { defaultSettings } from '../src/settings.js';
import { getSampleDashboard } from '../src/sample-dashboard.js';
import { sampleAdSetsView } from '../src/meta-adsets/presentation.js';
import type { ShopifyDashboard } from '../src/shopify/dashboard.js';
import { tickerState } from '../src/ticker/model.js';
import { morningDeck, type MorningCard, type MorningInput, type MorningState } from '../src/morning/model.js';
import { morningInputFromDashboard } from '../src/morning/inputs.js';
import { homeMorningOmissions, readHomeMorningOmissions } from '../src/morning/home.js';
import { pressMorning, readMorningStates } from '../src/morning/store.js';
import { createTestDatabase } from './helpers/database.js';

const now = new Date('2032-04-07T08:00:00Z');
const need = (id: string, state: 'warn' | 'alarm' = 'warn') => ({ id, state, source: 'shopify' as const,
  title: `Invented ${id}`, why: 'An invented stored rule.', link: '/sources', figure: { value: '12', label: 'Invented measure' } });
const shopify = (needs: ShopifyDashboard['needs'] = []): ShopifyDashboard => ({ mode: 'live', needs, checks: [], stock: [],
  detail: {}, live: { lastOrder: 'Invented', dispatch: 'Invented', carts: 'Invented' } });
function input(): MorningInput {
  return { mode: 'live', needs: [need('watch'), need('alarm', 'alarm')], checks: [],
    adSets: { ...sampleAdSetsView(defaultSettings()), mode: 'live' },
    creativeCards: [
      { id: 'invented-fading', kind: 'watch', groupId: 'invented-group', picture: '/assets/icon-192.png', title: 'Invented fading', reason: 'An invented frequency trigger.', mode: 'live', ruleIds: ['frequency'] },
      { id: 'invented-next', kind: 'decide', groupId: 'invented-group-next', picture: '/assets/icon-192.png', title: 'Invented next', reason: 'An invented pattern.', brief: 'An invented brief.', mode: 'live' },
    ], ticker: tickerState([], [], now, 'live'), settings: defaultSettings(), activity: [], metaActions: [],
    sourceReadOk: { 'needs:shopify': true, adsets: true, creatives: true, ticker: true } };
}
function saved(card: MorningCard, changes: Partial<MorningState> = {}): MorningState {
  return { mode: 'live', cardKey: card.key, state: 'parked', untilDay: '2032-04-08', factsHash: card.factsHash,
    answer: null, credentialId: 'invented-device', pressedAt: now.toISOString(), clearedAt: null,
    title: card.title, kind: card.kind, subjectId: card.subjectId, sourceScope: card.sourceScope, ...changes };
}

test('Home projects every current parked, hidden and held identity beyond the Morning cap, keeping source arrays whole', () => {
  const data = input(), original = structuredClone(data), cards = morningDeck(data, [], now).candidates;
  const rows = cards.map(card => saved(card, card.kind === 'meta-step'
    ? { state: 'answered', answer: 'hold', untilDay: '2032-04-14' }
    : card.state === 'warn' ? { state: 'hidden', untilDay: null } : {}));
  assert.equal(morningDeck(data, rows, now).snapshot.cards.length, 0, 'Saved presses have filled the daily cap');
  const omissions = homeMorningOmissions(data, rows, now)!;
  assert.deepEqual(omissions.needs, ['watch']);
  assert.deepEqual(omissions.creatives.sort(), ['invented-fading', 'invented-next']);
  assert.deepEqual(omissions.adSets.map(row => row.verdict), ['Kill', 'Slipping', 'Step', 'Delivery', 'Test share']);
  assert.deepEqual(data, original, 'The original full Home inputs are not filtered or mutated');
  const model = shopify(data.needs), before = structuredClone(model);
  const html = decisionsHtml({ shopify: model, adSets: data.adSets, creatives: data.creativeCards, morningOmissions: omissions });
  assert.match(html, /Invented alarm/);
  assert.doesNotMatch(html, /Invented watch|Invented fading|Invented next|data-adset-verdict=/);
  assert.deepEqual(model, before);
});

test('Home holds only the Step proposal and immediately shows a new Kill on the same set', () => {
  const data = input(), step = morningDeck(data, [], now).candidates.find(card => card.kind === 'meta-step')!;
  const hold = saved(step, { state: 'answered', answer: 'hold', untilDay: '2032-04-14' });
  const held = homeMorningOmissions(data, [hold], now)!;
  assert.deepEqual(held.adSets, [{ id: step.subjectId, verdict: 'Step' }]);
  const row = data.adSets!.rows.find(item => item.set.id === step.subjectId)!;
  row.verdict!.proposedBase = 999;
  assert.deepEqual(homeMorningOmissions(data, [hold], now), held, 'A moving proposal amount remains held');
  row.verdict!.verdict = 'Kill';
  row.verdict!.reasons = [{ rule: 'purchase-cost', verdict: 'Kill', text: 'An invented kill rule.', figures: ['£99', '£20'] }];
  assert.equal(homeMorningOmissions(data, [hold], now), undefined);
  assert.match(decisionsHtml({ adSets: data.adSets, morningOmissions: held }), new RegExp(`data-adset-open="${step.subjectId}"`), 'A prior Step omission cannot conceal the replacement verdict');
  assert.equal(homeMorningOmissions(input(), [hold], new Date('2032-04-14T08:00:00Z')), undefined);
});

test('Home uses Morning facts and read success, ignores cleared/expired/other-mode states and never omits Alarm', () => {
  const data = input(), cards = morningDeck(data, [], now).candidates;
  const watch = cards.find(card => card.subjectId === 'watch')!, fading = cards.find(card => card.kind === 'fading')!;
  const hidden = saved(fading, { state: 'hidden', untilDay: null });
  data.creativeCards[0]!.reason = 'A moving numeric value: 999';
  assert.deepEqual(homeMorningOmissions(data, [hidden], now)?.creatives, ['invented-fading']);
  data.creativeCards[0]!.ruleIds = ['ctr-drop'];
  assert.equal(homeMorningOmissions(data, [hidden], now), undefined, 'A changed confirmed trigger restores the card');
  data.sourceReadOk.creatives = false;
  assert.equal(homeMorningOmissions(data, [hidden], now), undefined, 'Present changed facts restore the card even during a failed read');
  assert.ok(morningDeck(data, [hidden], now).openCards.some(card => card.key === hidden.cardKey));
  for (const row of [saved(watch, { clearedAt: now.toISOString() }), saved(watch, { untilDay: '2032-04-07' }),
    saved(watch, { mode: 'sample' }), saved(watch, { state: 'seen' })]) assert.equal(homeMorningOmissions(data, [row], now), undefined);
  data.needs[0]!.state = 'alarm'; data.sourceReadOk['needs:shopify'] = false;
  assert.equal(homeMorningOmissions(data, [saved(watch, { state: 'hidden', untilDay: null })], now), undefined);
  assert.match(decisionsHtml({ shopify: shopify(data.needs), morningOmissions: { needs: ['watch', 'alarm'], adSets: [], creatives: [] } }), /Invented watch/);
});

test('Home without Morning state performs one read, adds no property and retains the same rendered page', async () => {
  const dashboard = {...getSampleDashboard(), generatedAt: now.toISOString()}, original = structuredClone(dashboard), calls: string[] = [];
  const db: Database = {
    async query(sql, values) { calls.push(sql); assert.match(sql, /^SELECT .*mode,card_key/s); assert.deepEqual(values, ['sample']); return { rows: [], rowCount: 0 }; },
    async transaction() { throw new Error('Home must not start a state mutation transaction'); },
    async close() {},
  };
  const result = await readHomeMorningOmissions(db, dashboard, defaultSettings(), 'sample', now);
  assert.equal(result, undefined); assert.equal(calls.length, 1);
  assert.equal(Object.hasOwn(dashboard, 'morningOmissions'), false);
  assert.deepEqual(dashboard, original);
  // Rendered from main 3d43b39 at this fixed invented time. Only C's approved link is removed.
  const markup = dashboardPage({...dashboard, morningOmissions: result});
  const morningLink = '<a class="btn morning-link" href="/morning">Morning ›</a>';
  assert.equal(markup.split(morningLink).length, 2);
  assert.equal(createHash('sha256').update(markup.replace(morningLink, '')).digest('hex'),
    'c44fd61adb59b2be939a42e4f3d7086191a2d82f17b68c1a8d3043a8b13307c5');
});

test('Home reads persisted answers without cleanup writes, isolates modes and restores after Undo', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const settings = defaultSettings(), dashboard = getSampleDashboard(settings);
  dashboard.shopify = { ...shopify([need('stored-watch')]), mode: 'sample' };
  const data = morningInputFromDashboard(dashboard, settings, tickerState([], [], now, 'sample'), 'sample');
  const card = morningDeck(data, [], now).candidates[0]!;
  await pressMorning(db, async () => data, { cardKey: card.key, action: 'hide' }, 'invented-device', now);
  const queries: string[] = [];
  const readOnly: Database = {
    query(sql, values) { queries.push(sql); assert.match(sql.trim(), /^SELECT\b/); return db.query(sql, values); },
    async transaction() { throw new Error('Home must not mutate state'); }, async close() {},
  };
  assert.deepEqual(await readHomeMorningOmissions(readOnly, dashboard, settings, 'sample', now), { needs: ['stored-watch'], adSets: [], creatives: [] });
  assert.equal((await readMorningStates(db, 'sample'))[0]!.clearedAt, null);
  queries.length = 0;
  assert.equal(await readHomeMorningOmissions(readOnly, dashboard, settings, 'live', now), undefined);
  assert.equal(queries.length, 1, 'Sample answers do not trigger live source reads');
  dashboard.shopify.needs[0]!.state = 'alarm';
  assert.equal(await readHomeMorningOmissions(readOnly, dashboard, settings, 'sample', now), undefined);
  assert.equal((await readMorningStates(db, 'sample'))[0]!.clearedAt, null, 'Morning read/press remains the cleanup authority');
  await pressMorning(db, async () => data, { cardKey: card.key, action: 'undo' }, 'invented-device', now);
  dashboard.shopify.needs[0]!.state = 'warn'; queries.length = 0;
  assert.equal(await readHomeMorningOmissions(readOnly, dashboard, settings, 'sample', now), undefined);
  assert.equal(queries.length, 1, 'Undo returns Home to the cheap empty-state path');
});
