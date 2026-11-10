import { addDays, ukToday } from '../hero-range.js';
import { morningFacts, morningKey } from './model.js';
import type { MorningCard, MorningInput, MorningKind, MorningTone } from './model-types.js';

function identity(kind: MorningKind, subjectId: string, state: MorningTone, ruleId: string) {
  return { key: morningKey(kind, subjectId), kind, subjectId, state, ruleId,
    factsHash: morningFacts(kind, subjectId, state, ruleId) };
}
function sampleExtras(now: Date): MorningCard[] {
  const day = ukToday(now);
  const google: MorningCard = {
    ...identity('google', 'sample-google-account', 'warn', 'sample-content-share'), sourceScope: 'google', tier: 2, order: 20_000,
    title: 'Sample content spend needs a look', lane: 'Google · sample data', source: 'google-ads',
    figure: { kind: 'dial', value: 8, bar: 2, label: 'Content share', formattedValue: '8%', formattedBar: '2%' },
    why: 'An invented campaign puts more spend into content than its sample bar.',
    rule: 'Sample content share 8%, against an invented 2% bar.', sourceLine: 'Sample Google data · invented example', sourceHref: '/settings',
    primary: { kind: 'copy', label: 'Copy a note', text: 'Please review the sample content campaign: content share is 8%, above the sample 2% bar. These are invented figures.' },
    secondary: { kind: 'save', target: 'morning', label: 'Not today', action: 'park' },
    menu: [{ kind: 'save', target: 'morning', label: 'Stop showing this', action: 'hide' }], allowedPresses: ['park', 'hide'],
  };
  const call: MorningCard = {
    ...identity('test-call', 'sample-test-arms', 'decide', 'sample-reading-ready'), sourceScope: 'tests', tier: 1, order: 20_000,
    title: 'Sample button test is ready to call', lane: 'Site · sample data', source: 'github-hq',
    figure: { kind: 'arms', arms: [{ label: 'A', value: 12, formatted: '12%', count: 80 }, { label: 'B', value: 17, formatted: '17%', count: 80 }], sure: 96, eligible: true },
    why: 'The invented reading has held its bar over two mornings.', rule: 'Sample demonstration of an eligible test call; no real experiment is measured.',
    sourceLine: 'Sample register · invented reading', primary: { kind: 'save', target: 'morning', label: 'Call B', action: 'call', answer: 'b', confirm: 'Call B for this sample test?' },
    secondary: { kind: 'save', target: 'morning', label: 'Not today', action: 'park' }, menu: [], allowedPresses: ['call', 'park'], callAnswer: 'b',
  };
  const verdict: MorningCard = {
    ...identity('new-verdict', 'sample-test-verdict', 'info', 'sample-history'), sourceScope: 'tests', tier: 3, order: 20_000,
    title: 'New verdict · sample label test', lane: 'Site · sample data', source: 'github-hq',
    figure: { kind: 'plain', value: 'Draw', label: 'Sample verdict' }, why: 'Neither invented arm reached a useful lead.',
    rule: 'New register verdicts remain visible for three UK days.', sourceLine: 'Sample register · invented verdict',
    primary: { kind: 'save', target: 'morning', label: 'OK', action: 'ack' }, menu: [], allowedPresses: ['ack'], seenUntilDay: addDays(day, 3),
  };
  const done: MorningCard = {
    ...identity('done-for-you', `sample-external-step:${day}`, 'done', `sample-external-step:${day}`), sourceScope: 'activity', tier: 4, order: 0,
    title: 'Sample fern stepped from £20 to £24 a day', lane: 'Meta · changed outside this app', source: 'meta',
    figure: { kind: 'plain', value: '£24', label: 'Sample daily base · was £20' }, why: 'An invented configured actor made this sample change.',
    rule: 'No live change is made in sample mode.', sourceLine: 'Sample Meta activity · invented change', sourceHref: '/ads',
    primary: { kind: 'save', target: 'morning', label: 'OK', action: 'ack' }, menu: [], allowedPresses: ['ack'], seenUntilDay: addDays(day, 1),
  };
  return [google, call, verdict, done];
}

/** A labelled Morning-only scenario; Home and the shared date strip keep their complete fixtures. */
export function curateMorningSample(input: MorningInput, now: Date): MorningInput {
  if (input.mode !== 'sample') return input;
  const late = input.ticker.ahead.find(item => item.days < 0);
  const ahead = input.ticker.ahead.find(item => item.days >= 4 && item.days <= 14);
  const dates = [late, ahead].filter((item): item is NonNullable<typeof item> => !!item);
  const creativeCards = [input.creativeCards.find(card => card.kind === 'watch'), input.creativeCards.find(card => card.kind === 'decide')]
    .filter((card): card is NonNullable<typeof card> => !!card);
  const kinds = new Set(input.extensions?.map(card => card.kind) ?? []);
  const extras = sampleExtras(now).filter(card => !kinds.has(card.kind));
  return { ...input, needs: [], checks: input.checks.filter(check => check.status === 'pass'),
    adSets: input.adSets ? { ...input.adSets, mode: 'sample', actionsEnabled: false,
      rows: input.adSets.rows.filter(row => row.verdict?.verdict === 'Kill').slice(0, 1) } : undefined,
    creativeCards, activity: [],
    ticker: { ...input.ticker, ahead: dates, current: dates[0] ?? null, then: dates.slice(1, 3) },
    extensions: [...(input.extensions ?? []), ...extras],
    liveTestIds: [...new Set([...(input.liveTestIds ?? []), 'sample-test-arms'])],
    sourceReadOk: { ...input.sourceReadOk, adsets: true, creatives: true, ticker: true, activity: true, tests: true, google: true },
  };
}
