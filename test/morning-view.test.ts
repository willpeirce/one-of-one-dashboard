import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MorningButton, MorningCard, MorningFigure, MorningKind, MorningSnapshot, MorningState, MorningTone } from '../src/morning/model-types.js';
import { morningBriefHtml, morningCardHtml, morningDeckHtml, morningFineHtml, morningLinesHtml, morningMenuHtml, morningPage, morningProgressHtml, morningWhyHtml } from '../src/morning/view.js';

const card = (overrides: Partial<MorningCard> = {}): MorningCard => ({
  key: 'invented-card', kind: 'need', subjectId: 'invented-subject', sourceScope: 'needs:pulse', factsHash: 'invented-facts', ruleId: 'invented-rule',
  state: 'warn', tier: 2, order: 0, title: 'Invented work needs a look', lane: 'Pulse · sample data', source: 'pulse',
  figure: {kind: 'plain', value: '3', label: 'Invented items'}, flag: 'Invented watch flag', whyLine: 'A short invented reason.',
  why: 'A longer invented reason.', rule: 'The invented bar is three items.', sourceLine: 'Sample stored read', sourceHref: '/sources',
  primary: {kind: 'link', label: 'Open source', href: '/sources'}, secondary: {kind: 'save', target: 'morning', label: 'Not today', action: 'park'},
  menu: [{kind: 'save', target: 'morning', label: 'Stop showing this', action: 'hide', subline: 'Until the rule changes'}], allowedPresses: ['park', 'hide'],
  ...overrides,
});
const snapshot = (cards: MorningCard[] = [card()]): MorningSnapshot => ({
  mode: 'sample', day: '2032-04-06', cards, more: 0, watchOnHome: 0, fine: [{id: 'invented-check', label: 'Invented source read is fine'}],
  parked: [], hidden: [], presses: [], metaActions: [], passedDates: [], answers: [], brief: null, completed: 0, total: cards.length,
});
const state = (index: number): MorningState => ({mode: 'sample', cardKey: `invented-${index}`, state: 'parked', untilDay: '2032-04-07', factsHash: 'invented',
  answer: null, credentialId: 'invented-browser', pressedAt: '2032-04-06T10:00:00Z', clearedAt: null, title: `Invented card ${index}`, kind: 'need', subjectId: `invented-${index}`, sourceScope: 'needs:pulse'});

test('Morning renders every card kind and state with a heading, icon-word state and five button kinds', () => {
  const kinds: MorningKind[] = ['need', 'meta-kill', 'meta-slipping', 'meta-step', 'meta-watch', 'date', 'fading', 'make-next', 'google', 'test-call', 'new-verdict', 'done-for-you', 'pause-all'];
  const tones: [MorningTone, string][] = [['alarm', 'Alarm'], ['decide', 'Decide'], ['warn', 'Watch'], ['info', 'Info'], ['done', 'Done for you']];
  for (const kind of kinds) for (const [tone, word] of tones) {
    const html = morningCardHtml(card({kind, state: tone}));
    assert.ok(html.includes(`data-mn-kind="${kind}"`)); assert.ok(html.includes(`data-state="${tone}"`));
    assert.match(html, /<h2 id="mn-card-title"[^>]*>Invented work needs a look<\/h2>/);
    assert.ok(html.includes(`</span> ${word}</span>`));
    assert.match(html, /id="mn-primary"/); assert.match(html, /id="mn-secondary"/); assert.match(html, /id="mn-menu"/);
  }
  const buttons: MorningButton[] = [
    {kind: 'link', label: 'Open source', href: '/sources'},
    {kind: 'copy', label: 'Copy brief', text: 'Invented note'},
    {kind: 'save', target: 'morning', label: 'Not today', action: 'park'},
    {kind: 'live', label: 'Pause invented set', adSetId: '710000001', action: 'pause', confirm: 'Pause the invented set now?'},
    {kind: 'pause-all', label: 'Pause all 3', confirm: 'Pause these 3 ad sets now?', members: []},
  ];
  for (const primary of buttons) {
    const html = morningCardHtml(card({primary}));
    assert.ok(html.includes(`data-mn-button-kind="${primary.kind}"`));
    assert.ok(html.includes(primary.kind === 'link' ? '<a id="mn-primary"' : '<button id="mn-primary"'));
  }
  const confirmation = morningCardHtml(card(), {confirm: 'Pause the invented set now?'});
  assert.match(confirmation, /Pause the invented set now\?/); assert.match(confirmation, /id="mn-confirm"/); assert.match(confirmation, /id="mn-cancel"/);
  assert.doesNotMatch(confirmation, /id="mn-primary"/);
});

test('Morning figures preserve actual labels, bounded dial values and independent brief windows without nested buttons', () => {
  const variants = Object.fromEntries(['1', '3', '7'].map(day => [day, {bullets: [{text: `Invented ${day}-day evidence`, strength: 2}], text: `Invented ${day}-day copy`, footer: `Invented ${day}-day footer`}])) as Extract<MorningFigure, {kind: 'brief'}>['variants'];
  const figures: MorningFigure[] = [
    {kind: 'plain', value: '£12.34', label: 'Invented cost'},
    {kind: 'dial', value: 40, bar: 20, label: 'Invented cost', formattedValue: '£40', formattedBar: '£20'},
    {kind: 'rail', value: 3, label: '3 days late', range: 14},
    {kind: 'thumb', src: '/media/invented-picture', alt: 'Invented creative', value: '£4', label: 'Invented cost'},
    {kind: 'brief', variants},
    {kind: 'arms', arms: [{label: 'A', value: 3, formatted: '3%', count: 40}, {label: 'B', value: 5, formatted: '5%', count: 44}], sure: 97, eligible: true},
  ];
  for (const figure of figures) {
    const html = morningCardHtml(card({figure}));
    assert.ok(html.includes(`data-mn-figure="${figure.kind}"`)); assert.match(html, /id="mn-figure"[^>]*aria-haspopup="dialog"/);
    assert.doesNotMatch(html, /<button\b(?:(?!<\/button>)[\s\S])*<button\b/);
    assert.doesNotMatch(html, /NaN|Infinity/);
  }
  const brief = morningCardHtml(card({figure: figures[4]!}), {window: '1'});
  assert.match(brief, /Invented 1-day evidence/); assert.doesNotMatch(brief, /Invented 3-day evidence|Invented 7-day evidence/);
  assert.match(brief, /data-mn-window="1" aria-pressed="true"/);
  assert.match(brief, /data-mn-strength="2" aria-label="Likely"/);
  for (const window of ['1', '3', '7'] as const) {
    const why = morningWhyHtml(card({figure: figures[4]!, why: 'Invented seven-day-only reason'}), window);
    assert.ok(why.includes(`Invented ${window}-day copy`)); assert.doesNotMatch(why, /Invented seven-day-only reason/);
  }
  const waiting = morningCardHtml(card({figure: {...figures[5] as Extract<MorningFigure, {kind: 'arms'}>, sure: null, eligible: false}}));
  assert.match(waiting, /<strong>—<\/strong>/); assert.doesNotMatch(waiting, /mn-sure mn-eligible/);
});

test('Morning server renders the first card, shares the ticker and escapes its inert bootstrap and action text', () => {
  const payload = '</template><script>window.invented=1</script><img src=x onerror=alert(1)>';
  const data = snapshot([card({title: payload, why: payload, rule: payload, sourceLine: payload, primary: {kind: 'link', label: payload, href: 'javascript:alert(1)'}})]);
  const html = morningPage(data);
  assert.equal((html.match(/<article id="mn-card"/g) ?? []).length, 1);
  assert.match(html, /<header class="top mn-top">[\s\S]*?<\/header><aside class="tk-root"/);
  assert.match(html, /href="\/assets\/fonts.css"/); assert.match(html, /href="\/assets\/morning.css"/);
  assert.match(html, /href="\/\?from=morning"/); assert.match(html, /Sample data/);
  assert.equal((html.match(/<template id="mn-initial">/g) ?? []).length, 1);
  assert.doesNotMatch(html, /<script\b(?![^>]*\bsrc=)|<style\b|href="javascript:/);
  assert.ok(!html.includes(payload)); assert.ok(html.includes('&lt;/template&gt;&lt;script&gt;'));
  const why = morningWhyHtml(data.cards[0]!);
  for (const title of ['Why', 'The rule', 'The source']) assert.ok(why.includes(`<h3>${title}</h3>`));
  assert.ok(!why.includes(payload));
  assert.match(morningMenuHtml(card()), /Until the rule changes/);
});

test('All clear, progress and the fine sheet retain press history, Put back and bounded away rows', () => {
  const data = snapshot([]); data.completed = 2; data.total = 2; data.watchOnHome = 4;
  data.presses = [state(1)];
  data.passedDates = [{name: 'Invented launch', date: '2032-04-06', note: '', kind: 'flag', key: 'invented launch|2032-04-06', days: 0, chip: 'today', dateLabel: 'Tue 6 Apr', passed_at: '2032-04-06T10:00:00Z'}];
  data.parked = Array.from({length: 5}, (_, index) => ({stateRow: state(index), title: `Invented card ${index}`, reason: 'Not today', untilDay: '2032-04-07'}));
  const html = morningDeckHtml(data);
  assert.match(html, /id="mn-all-clear"/); assert.match(html, /What you did/);
  assert.match(morningDeckHtml(data, {error: 'Invented restore failure.'}), /id="mn-error"[^>]*role="alert">✕ Invented restore failure\./);
  assert.match(html, /data-mn-put-back="invented-1"/); assert.match(html, /data-mn-ticker-restore="invented launch\|2032-04-06"/);
  assert.match(morningProgressHtml(data), /2 of 2/);
  assert.equal((morningFineHtml(data).match(/data-mn-put-back=/g) ?? []).length, 3);
  assert.match(morningFineHtml(data), /\+2 more/);
  assert.equal((morningFineHtml(data, true).match(/data-mn-put-back=/g) ?? []).length, 5);
  assert.match(morningPage(data), /Good · 1 fine/); assert.match(morningPage(data), /Watch · 4 on Home/);
  assert.match(html, /Your Morning deck is clear. 4 Watch cards are on Home/);
  assert.doesNotMatch(morningPage(data), /Everything else is fine/);
});


test('Morning lines show one Good and Watch row, with a quiet non-link when none are on Home', () => {
  const data = snapshot();
  const none = morningLinesHtml(data);
  assert.match(none, /<button[^>]+id="mn-good"[^>]+aria-haspopup="dialog"/);
  assert.match(none, /✓<\/span> Good · 1 fine/);
  assert.match(none, /<span class="mn-watch-line" id="mn-watch-none"><span aria-hidden="true">△<\/span> Watch · none<\/span>/);
  assert.doesNotMatch(none, /id="mn-more-home"/);
  data.watchOnHome = 5;
  assert.match(morningLinesHtml(data), /<a[^>]+id="mn-more-home" href="\/\?from=morning"[^>]*><span aria-hidden="true">△<\/span> Watch · 5 on Home<\/a>/);
  assert.equal((morningPage(data).match(/id="mn-good"/g) ?? []).length, 1);
});

test('Morning progress keeps counts beyond eight and only draws pips up to eight', () => {
  const data = snapshot(); data.completed = 2; data.total = 8;
  assert.equal((morningProgressHtml(data).match(/<i class=/g) ?? []).length, 8);
  assert.match(morningProgressHtml(data), /3 of 8/);
  data.total = 11;
  assert.equal(morningProgressHtml(data), '<span>3 of 11</span>');
});

test('Morning check coverage, item lines and dated fine rows render without treating text as markup', () => {
  const data = snapshot();
  data.brief = {text: 'Morning check · 4 items', status: 'needs', mode: 'live', allInDeck: true,
    items: [{text: 'Invented detail', lines: ['Invented <b>line</b>']}]};
  assert.match(morningLinesHtml(data), /· all in the deck/);
  data.brief.moreHere = 2;
  assert.match(morningLinesHtml(data), /· 2 more here/);
  assert.doesNotMatch(morningLinesHtml(data), /all in the deck/);
  assert.match(morningBriefHtml(data.brief), /Invented &lt;b&gt;line&lt;\/b&gt;/);
  data.datedFromCheck = [{text: 'Invented deadline', lines: ['Invented date detail']}];
  const fine = morningFineHtml(data);
  assert.ok(fine.indexOf('Dated, from the check') < fine.indexOf('Parked and hidden'));
  assert.match(fine, /Invented date detail/);
});

test('Pause all list figure caps eight escaped rows and adds the overflow to its more count', () => {
  const figure: MorningFigure = {kind: 'list', rows: Array.from({length: 10}, (_, index) => ({label: `Invented <fern> ${index}`, value: `£${80 + index} spend`})), more: 2};
  const html = morningCardHtml(card({kind: 'pause-all', state: 'decide', figure, why: 'Invented first set\nInvented last set'}));
  assert.equal((html.match(/class="mn-list-row"/g) ?? []).length, 8);
  assert.match(html, /\+4 more/); assert.match(html, /Invented &lt;fern&gt; 0/);
  assert.doesNotMatch(html, /<fern>|Invented &lt;fern&gt; 8/);
  assert.match(morningWhyHtml(card({figure})), /class="mn-brief-evidence"/);
});
