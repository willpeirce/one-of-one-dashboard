import assert from 'node:assert/strict';
import test from 'node:test';
import { addDays } from '../src/hero-range.js';
import { defaultSettings } from '../src/settings.js';
import type { StoredAdSet } from '../src/meta-adsets/catalogue.js';
import { judgeAdSet, type SetDay } from '../src/meta-adsets/rules.js';
import { buildAdSetsView, decisionRows, sampleAdSetsView } from '../src/meta-adsets/presentation.js';
import { morningDeck, type MorningInput } from '../src/morning/model.js';
import { tickerState } from '../src/ticker/model.js';

// Every identity, date and measure here is invented.
const today = '2032-04-11', now = new Date(`${today}T08:00:00Z`), born = '2032-04-01';
function set(extra: Partial<StoredAdSet> = {}): StoredAdSet {
  return { id: '120000000000000011', campaignId: '120000000000000012', name: 'Invented Fern UK', owner: 'ours',
    status: 'ACTIVE', effectiveStatus: 'ACTIVE', flatBudget: true, dailyBudget: null, lifetimeBudget: null,
    currency: 'GBP', market: 'uk', createdTime: `${born}T08:00:00Z`, updatedTime: `${born}T08:00:00Z`,
    lastSignificantEdit: null, learningStage: null, campaignName: 'Invented Garden UK',
    firstSeen: `${born}T08:00:00Z`, lastSeen: now.toISOString(), lastRead: now.toISOString(), ...extra };
}
const life = (extra: Partial<SetDay> = {}): SetDay[] => Array.from({ length: 10 }, (_, index) => ({
  day: addDays(born, index), spend: 10, purchases: 1, addsToCart: 2, ...extra,
}));
const costs = (verdict: ReturnType<typeof judgeAdSet>) => verdict!.reasons.filter(reason => ['purchase-cost', 'atc-cost'].includes(reason.rule));

test('flat cost judgement waits below its spend floor and uses an inclusive gate after one completed day', () => {
  const settings = defaultSettings(), first = set({ createdTime: '2032-04-10T08:00:00Z' });
  const row = { day: '2032-04-10', spend: 59.99, purchases: 1, addsToCart: 1 };
  assert.deepEqual(costs(judgeAdSet(first, [row], settings, today)), []);
  assert.equal(judgeAdSet(first, [row], settings, today)!.reason, 'Below its judgement spend of £60.00');
  const judged = judgeAdSet(first, [{ ...row, spend: 60 }], settings, today)!;
  assert.deepEqual(costs(judged).map(reason => reason.rule), ['purchase-cost', 'atc-cost']);
  assert.equal(judged.spend, 60); assert.equal(judged.cpp, 60); assert.equal(judged.cpatc, 60);
  assert.match(judged.reason, /Reached its judgement spend of £60\.00 · Life:/);
  assert.deepEqual(judged.figures, ['£60.00 life spend', '£60.00 per purchase']);
  assert.deepEqual(costs(judgeAdSet({ ...first, flatBudget: false }, [{ ...row, spend: 80 }], settings, today)), [],
    'A non-flat set still needs two complete action days');
  settings.adRules.flatJudgeGbp = 70;
  assert.deepEqual(costs(judgeAdSet(first, [{ ...row, spend: 60 }], settings, today)), []);
});

test('flat purchase cost reads its whole life and Morning displays that same cost while the Ads row stays seven-day', () => {
  const settings = defaultSettings(), rows = life();
  rows[0] = { ...rows[0]!, spend: 200, purchases: 0, addsToCart: 20 };
  const view = buildAdSetsView([set()], new Map([[set().id, rows]]), settings, today,
    { mode: 'live', lastRead: now.toISOString(), accountYesterday: 10 });
  const row = view.rows[0]!, verdict = row.verdict!;
  assert.equal(row.spend, 70); assert.equal(row.cpp, 10); assert.equal(row.days.length, 7);
  assert.equal(verdict.verdict, 'Kill'); assert.equal(verdict.spend, 290); assert.equal(verdict.purchases, 9);
  assert.equal(verdict.cpp, 290 / 9); assert.equal(verdict.windowFrom, born);
  assert.equal(verdict.windowTo, '2032-04-10');
  assert.match(verdict.reason, /Life: £290\.00 on 9 purchases/);
  const input: MorningInput = { mode: 'live', settings, adSets: view, needs: [], checks: [], creativeCards: [],
    ticker: tickerState([], [], now, 'live'), activity: [], metaActions: [], sourceReadOk: { adsets: true } };
  const card = morningDeck(input, [], now).snapshot.cards[0]!;
  assert.equal(card.kind, 'meta-kill'); assert.equal(card.figure.kind, 'dial');
  if (card.figure.kind === 'dial') assert.equal(card.figure.value, 290 / 9);
  assert.deepEqual(costs(judgeAdSet(set({ flatBudget: false }), rows, settings, today)), [],
    'The same non-flat set still judges the last seven days');
});

test('flat adds-to-cart cost uses all lifetime spend and actions independently of its seven-day window', () => {
  const settings = defaultSettings(), rows = life({ spend: 0, purchases: 1, addsToCart: 0 });
  rows[0] = { ...rows[0]!, spend: 60, addsToCart: 1 };
  rows[9]!.addsToCart = 1;
  const verdict = judgeAdSet(set(), rows, settings, today)!;
  assert.deepEqual(costs(verdict).map(reason => reason.rule), ['atc-cost']);
  assert.equal(verdict.verdict, 'Kill'); assert.equal(verdict.cpatc, 30); assert.equal(verdict.cpp, 6);
  assert.match(verdict.reason, /judgement spend of £60\.00 · Life: £60\.00 on 2 adds to cart/);
  assert.deepEqual(verdict.figures, ['£60.00 life spend', '£30.00 an add to cart']);
});

test('flat cost rules need complete lifetime coverage, never convert null action data into zero and ignore today', () => {
  const settings = defaultSettings(), rows = life({ spend: 40, purchases: 1, addsToCart: 1 });
  for (const partial of [rows.slice(1), rows.filter(row => row.day !== '2032-04-03')])
    assert.deepEqual(costs(judgeAdSet(set(), partial, settings, today)), [], 'Older missing days cannot be judged as a whole life');
  const unknownPurchases = structuredClone(rows); unknownPurchases[0]!.purchases = null;
  const purchaseUnknown = judgeAdSet(set(), unknownPurchases, settings, today)!;
  assert.deepEqual(costs(purchaseUnknown).map(reason => reason.rule), ['atc-cost']);
  assert.equal(purchaseUnknown.purchases, null); assert.equal(purchaseUnknown.cpp, null);
  const unknownAtc = structuredClone(rows); unknownAtc[0]!.addsToCart = null;
  const atcUnknown = judgeAdSet(set(), unknownAtc, settings, today)!;
  assert.deepEqual(costs(atcUnknown).map(reason => reason.rule), ['purchase-cost']);
  assert.equal(atcUnknown.addsToCart, null); assert.equal(atcUnknown.cpatc, null);
  const unknownBoth = rows.map(row => ({ ...row, purchases: null, addsToCart: null }));
  assert.deepEqual(costs(judgeAdSet(set(), unknownBoth, settings, today)), []);
  const future = [...rows, { day: today, spend: 999, purchases: 0, addsToCart: 0 }];
  assert.deepEqual(judgeAdSet(set(), future, settings, today), judgeAdSet(set(), rows, settings, today));
});

test('a flat set inside its cost bars produces no decision card', () => {
  const settings = defaultSettings(), rows = life();
  const view = buildAdSetsView([set()], new Map([[set().id, rows]]), settings, today,
    { mode: 'live', lastRead: now.toISOString(), accountYesterday: 10 });
  assert.equal(view.rows[0]!.verdict!.verdict, 'Clear');
  assert.deepEqual(decisionRows(view), []);
  const data: MorningInput = { mode: 'live', settings, adSets: view, needs: [], checks: [], creativeCards: [],
    ticker: tickerState([], [], now, 'live'), activity: [], metaActions: [], sourceReadOk: { adsets: true } };
  assert.deepEqual(morningDeck(data, [], now).snapshot.cards, []);
  const firstDay = judgeAdSet(set({ createdTime: '2032-04-10T08:00:00Z' }),
    [{ day: '2032-04-10', spend: 60, purchases: 3, addsToCart: 5 }], settings, today)!;
  assert.equal(firstDay.verdict, 'Clear'); assert.equal(firstDay.reason, 'Inside its lifetime cost bars');
});

test('a missing or unknown older lifetime is described as waiting, even with a clean seven-day window', () => {
  const rows = life(), settings = defaultSettings();
  const missing = judgeAdSet(set(), rows.slice(1), settings, today)!;
  assert.equal(missing.verdict, 'Clear');
  assert.equal(missing.reason, 'Waiting for complete lifetime action data before cost judgement');
  rows[0]!.purchases = null;
  assert.equal(judgeAdSet(set(), rows, settings, today)!.reason, missing.reason);
  rows[0]!.purchases = 1; rows[0]!.addsToCart = null;
  assert.equal(judgeAdSet(set(), rows, settings, today)!.reason, missing.reason);
});

test('flat cost changes leave zero-day, first-day-pattern, name-line, Slipping and Step evaluations unchanged', () => {
  const settings = defaultSettings(); settings.adRules.killFloorGbp = 1000; settings.adRules.flatJudgeGbp = 1000;
  const scenarios = [
    { rule: 'zero-day', rows: life({ spend: 20, addsToCart: 0 }), extra: { dailyBudget: 2000 } },
    { rule: 'first-day-pattern', rows: life({ addsToCart: 0 }).map((row, index) => ({ ...row, addsToCart: index ? 0 : 3 })), extra: {} },
    { rule: 'name-line', rows: life(), extra: { name: 'Invented Fern UK kill at 20 ATC / 10 purch' } },
    { rule: 'slipping', rows: life({ spend: 40 }), extra: {} },
    { rule: 'two-clean-days', rows: life({ spend: 16 }), extra: { dailyBudget: 2000 } },
  ];
  for (const scenario of scenarios) {
    const flat = judgeAdSet(set(scenario.extra), scenario.rows, settings, today)!;
    const scheduled = judgeAdSet(set({ ...scenario.extra, flatBudget: false }), scenario.rows, settings, today)!;
    const reason = flat.reasons.find(reason => reason.rule === scenario.rule);
    assert.ok(reason, `The ${scenario.rule} fixture must exercise the rule`);
    assert.deepEqual(reason, scheduled.reasons.find(reason => reason.rule === scenario.rule));
    assert.equal(flat.cpp, scheduled.cpp); assert.equal(flat.windowFrom, scheduled.windowFrom);
    assert.equal(flat.proposedBase, scheduled.proposedBase); assert.equal(flat.stepPercent, scheduled.stepPercent);
  }
});

test('the existing non-flat sample Kill fixture retains its complete verdict unchanged', () => {
  const row = sampleAdSetsView(defaultSettings()).rows.find(row => row.verdict?.verdict === 'Kill')!;
  assert.equal(row.set.flatBudget, null);
  assert.deepEqual(row.verdict, {
    verdict: 'Kill', reason: '£280.00 on 7 purchases, £40.00 each against £26.00 · UK break-even £20.00',
    reasons: [
      { rule: 'purchase-cost', verdict: 'Kill', text: '£280.00 on 7 purchases, £40.00 each against £26.00 · UK break-even £20.00',
        figures: ['£280.00 spend', '£40.00 per purchase'] },
      { rule: 'slipping', verdict: 'Slipping', text: '£120.00 on 3 purchases over 3 of 3 days, £40.00 against £30.00 · UK break-even £20.00',
        figures: ['£120.00 in 3 of 3 days', '£40.00 per purchase'] },
    ], figures: ['£280.00 spend', '£40.00 per purchase'], spend: 280, purchases: 7, addsToCart: 21,
    cpp: 40, cpatc: 280 / 21, windowFrom: '2026-10-09', windowTo: '2026-10-15', includesSpikeDays: false,
    breakEven: 20, breakEvenNote: '', proposedBase: null, proposedWeekday: null, stepPercent: null,
  });
});
