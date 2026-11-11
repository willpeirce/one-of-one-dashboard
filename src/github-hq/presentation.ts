import { appConfig } from '../config.js';
import { addDays, ukToday } from '../hero-range.js';
import { defaultSettings } from '../settings.js';
import { adsCheckDue } from '../shopify/watchdogs.js';
import { tickerState } from '../ticker/model.js';
import { morningDeck, morningFacts, morningKey } from '../morning/model.js';
import type { MorningBrief, MorningCard, MorningInput, MorningState } from '../morning/model-types.js';
import type { TestModel } from '../dashboard-types.js';
import type { HQFacts, HQStoredTestRow } from './model.js';
import { readTest } from './reading.js';
import type { HomeTests, HomeTestRow } from './presentation-types.js';

export function hqFileLink(ref: string, path: string): string {
  return `https://github.com/${encodeURIComponent(appConfig.github.owner)}/${encodeURIComponent(appConfig.github.repository)}/blob/${encodeURIComponent(ref)}/${path.split('/').map(encodeURIComponent).join('/')}`;
}
const registerLink = (): string => hqFileLink('main', 'ops/tests/register.md');
const callLabel = (answer: 'a' | 'b' | 'draw'): string => answer === 'draw' ? 'Call a draw' : `Call ${answer.toUpperCase()}`;
const testTitle = (row: HQStoredTestRow): string => row.cells[0] || row.id;
function verdictFigure(value: string): string {
  const phrase = /^(?:A wins|B wins|Draw|Stopped|Mixed)\b/i.exec(value.trim())?.[0];
  const points = Array.from(value.trim());
  return phrase || (points.length > 80 ? `${points.slice(0, 79).join('')}…` : value.trim()) || 'Recorded';
}
const details = (row: HQStoredTestRow): string => row.section === 'history'
  ? `Question: ${row.cells[1]}\nVerdict: ${row.cells[2]}\nRule: ${row.cells[3]}\nEvidence: ${row.cells[4]}`
  : row.section === 'queue' ? `Question: ${row.cells[2]}\nArms: ${row.cells[3]}\nMetric and bar: ${row.cells[4]}\nHow it would run: ${row.cells[5]}\nNeeds: ${row.cells[6]}`
    : `Question: ${row.cells[2]}\nArms: ${row.cells[3]}\nMetric and bar: ${row.cells[4]}\nStarted: ${row.cells[5]}\nEnds: ${row.cells[6]}\nWhere measured: ${row.cells[7]}\nStatus: ${row.cells[8]}`;

export function morningBrief(mode: MorningInput['mode'], facts: HQFacts, now: Date): MorningBrief {
  const day = addDays(ukToday(now), -1);
  if (mode === 'sample') return { mode, status: 'needs', text: 'Morning check · 07:41 · 2 items', day,
    runLabel: 'run · 07:41 · invented example', count: 2, items: [
      { label: 'Review', text: 'Review: the invented sample campaign.' },
      { label: 'Creative', text: 'Creative: compare the invented new opening.' },
    ], href: hqFileLink('main', `ops/ads-daily/${day.slice(0, 7)}.md`) };
  if (facts.sourceMode !== 'live') return { mode, status: 'key', text: 'Morning check: needs its key', href: '/sources' };
  const entry = facts.report?.day === day ? facts.report : null;
  if (!entry) return { mode, status: 'missing', text: 'No morning check yet today', tone: adsCheckDue(now) ? 'warn' : 'info', day };
  const time = /\b\d{2}:\d{2}\b/.exec(entry.runLabel)?.[0];
  const text = entry.status === 'unreadable' ? "Morning check: couldn't read"
    : `Morning check${time ? ` · ${time}` : ''} · ${entry.status === 'ok' ? 'nothing needs you' : `${entry.count} ${entry.count === 1 ? 'item' : 'items'}`}`;
  return { mode, status: entry.status, text, day, runLabel: entry.runLabel, count: entry.count,
    items: entry.items, firstLines: entry.firstLines, href: hqFileLink(entry.ref, entry.path) };
}

function hqCards(facts: HQFacts, now: Date): MorningCard[] {
  return facts.tests.flatMap<MorningCard>((row, index) => {
    const assessment = readTest(row, now), title = testTitle(row), href = registerLink();
    const sourceLine = `HQ test register · ${facts.registerReadAt ? `last read ${facts.registerReadAt}` : 'waiting for a successful read'}`;
    if (row.section === 'live' && assessment.answer) {
      const answer = assessment.answer, ruleId = `test-call:${answer}`, reading = assessment.reading;
      const unmeasured = answer === 'draw' && !reading, state = unmeasured ? 'info' : 'decide';
      return [{ key: morningKey('test-call', row.id), kind: 'test-call', subjectId: row.id, sourceScope: 'tests',
        factsHash: morningFacts('test-call', row.id, state, ruleId), ruleId, state, tier: unmeasured ? 3 : 1, order: 20_000 + index,
        title: `${title} is ready to call`, lane: `${row.cells[1] || 'Test'} · register`, source: 'github-hq',
        figure: { kind: 'arms', arms: reading?.arms.map(arm => ({ label: arm.key.toUpperCase(), value: arm.value, formatted: arm.formatted, count: arm.count })) ?? [],
          sure: reading?.sure ?? null, eligible: true },
        why: details(row), whyLine: answer === 'draw' ? 'The test has reached its 28-day stopping point.' : 'The stored reading has held its call bar.',
        rule: answer === 'draw' ? 'After 28 UK days with no eligible A/B call, call a draw. The app does not measure this test.'
          : 'A stored reading from today or yesterday, at least 95% sure on two mornings, 30 events per arm and 7 full UK days; no spike day or Leaning cap. The app does not measure this test.',
        sourceLine, sourceHref: href,
        primary: { kind: 'save', target: 'morning', label: callLabel(answer), action: 'call', answer, confirm: `${callLabel(answer)} for ${title}? The register still needs a write-up.` },
        secondary: { kind: 'save', target: 'morning', label: 'Not today', action: 'park' }, menu: unmeasured ? [{ kind: 'save', target: 'morning', label: 'Stop showing this', action: 'hide' }] : [],
        allowedPresses: unmeasured ? ['call', 'park', 'hide'] : ['call', 'park'], callAnswer: answer,
      } satisfies MorningCard];
    }
    if (row.section === 'history' && assessment.verdictUntilDay) {
      const ruleId = JSON.stringify([row.cells[2], row.cells[3], row.sectionFirstSeenAt]);
      return [{ key: morningKey('new-verdict', row.id), kind: 'new-verdict', subjectId: row.id, sourceScope: 'tests',
        factsHash: morningFacts('new-verdict', row.id, 'info', ruleId), ruleId, state: 'info', tier: 3, order: 20_000 + index,
        title: `New verdict · ${title}`, lane: 'Tests · register', source: 'github-hq', figure: { kind: 'plain', value: verdictFigure(row.cells[2] || ''), label: 'Register verdict' },
        why: details(row), rule: 'A new History verdict stays here for three UK days from its first observed day in History.', sourceLine, sourceHref: href,
        primary: { kind: 'save', target: 'morning', label: 'OK', action: 'ack' }, menu: [], allowedPresses: ['ack'], seenUntilDay: assessment.verdictUntilDay,
      } satisfies MorningCard];
    }
    return [];
  });
}

/** Add only stored HQ observations in live mode; the sample scenario keeps its own test demonstrations. */
export function addMorningHq(input: MorningInput, facts: HQFacts, now: Date): MorningInput {
  const brief = morningBrief(input.mode, facts, now);
  if (input.mode === 'live' && facts.sourceMode === 'live') brief.registerDiagnostics = {malformed: facts.registerSkippedRows, capped: facts.registerCappedRows ?? 0, missingHeadings: facts.registerHeadingsComplete === false};
  if (input.mode === 'sample') return { ...input, brief };
  return { ...input, brief, extensions: [...(input.extensions ?? []).filter(card => !['test-call', 'new-verdict'].includes(card.kind)), ...hqCards(facts, now)],
    liveTestIds: facts.tests.filter(row => row.section === 'live').map(row => row.id),
    sourceReadOk: { ...input.sourceReadOk, tests: facts.registerReadOk }, sourceReadAt: { ...input.sourceReadAt, tests: facts.registerReadAt } };
}

export function homeTestsFromHq(facts: HQFacts, states: readonly MorningState[], now: Date): HomeTests {
  const input = addMorningHq({ mode: 'live', needs: [], checks: [], creativeCards: [], settings: defaultSettings(),
    ticker: tickerState([], [], now, 'live'), activity: [], metaActions: [], sourceReadOk: {} }, facts, now);
  const result = morningDeck(input, states, now), open = new Set(result.openCards.map(card => card.key));
  const rows: HomeTestRow[] = facts.tests.map(row => {
    const assessment = readTest(row, now), reading = assessment.reading, key = morningKey('test-call', row.id);
    const decide = !!assessment.answer && !(assessment.answer === 'draw' && !reading);
    const called = result.snapshot.answers.find(answer => answer.cardKey === key && answer.answer !== 'hold');
    const parked = result.snapshot.parked.find(answer => answer.stateRow.cardKey === key);
    const status = called ? `Called ${called.answer!.toUpperCase()} · waiting for the write-up` : parked
      ? `Parked until ${parked.untilDay}` : row.section === 'history' ? row.cells[2] || 'Recorded' : row.section === 'queue' ? 'Next' : row.cells[8] || 'No reading';
    const model: TestModel | null = row.section !== 'live' ? null : {
      metric: row.cells[4] || '', unit: '', arms: reading?.arms.map(arm => ({ k: arm.key.toUpperCase(), l: arm.key.toUpperCase(), x: arm.value })) ?? [],
      day: assessment.daysRun ?? 0, min: 7, max: 28, minx: 30, prev: 0, denom: 'events per arm', strip: [], note: row.cells[8] || '',
      presentation: { sure: reading?.sure ?? 0, state: decide ? 'decide' : 'info', chipText: decide ? '◆ Decide' : 'i Info',
        say: status, homeSay: status, small: assessment.reasons.join(' · '), progress: assessment.daysRun === null ? '' : `Day ${assessment.daysRun}`,
        buttonText: assessment.answer ? callLabel(assessment.answer) : 'Call', sureZones: [[0, 95, 'info'], [95, 100, 'good']], sureLabel: 'How sure',
        stripLabel: 'Stored reading', sureCaption: reading ? `Reading ${reading.day}` : 'No well-formed reading' },
    };
    return { id: row.id, section: row.section, title: testTitle(row), lane: row.section === 'history' ? 'Tests' : row.cells[1] || 'Tests', cells: row.cells,
      status, model, reading, call: assessment.answer && open.has(key) ? { cardKey: key, answer: assessment.answer, label: callLabel(assessment.answer),
        confirm: `${callLabel(assessment.answer)} for ${testTitle(row)}? The register still needs a write-up.` } : null,
      called: called ? { cardKey: key, answer: called.answer as 'a' | 'b' | 'draw' } : null, parkedUntil: parked?.untilDay ?? null };
  });
  return { mode: 'live', readAt: facts.registerReadAt, readOk: facts.registerReadOk, rows, href: registerLink() };
}
