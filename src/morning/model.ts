import { createHash } from 'node:crypto';
import { addDays, ukToday } from '../hero-range.js';
import { formatPounds } from '../money.js';
import { adSetName } from '../meta-adsets/name.js';
import { allowedBudgetChange } from '../meta-adsets/budget.js';
import { decisionRows } from '../meta-adsets/decision-rows.js';
import { activityObjectType } from '../meta-adsets/activity.js';
import { morningPauseAll } from './pause-all.js';
import { morningCheckItems } from './check-items.js';
import {parsePauseUncertainty,pauseUncertaintyNote} from '../meta-adsets/pause-uncertainty.js';
import type { AdSetRow } from '../meta-adsets/presentation.js';
import type { DashboardNeed } from '../shopify/dashboard.js';
import type { MorningAction, MorningAway, MorningButton, MorningCard, MorningFigure, MorningInput,
  MorningKind, MorningMetaAction, MorningResult, MorningState, MorningTone } from './model-types.js';
export type * from './model-types.js';

export const MORNING_LIMIT = 7;
export const MORNING_DATE_DAYS = 14;
export const MORNING_ACTION_MATCH_MS = 5 * 60_000;
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Compact ASCII keys keep every request below its byte limit, including Unicode date names. */
export const morningKey = (kind: MorningKind, subjectId: string): string => `${kind}:${digest(subjectId)}`;
export const morningFacts = (kind: MorningKind, subjectId: string, state: MorningTone, rules: string | readonly string[]): string =>
  digest([kind, subjectId, state, typeof rules === 'string' ? rules : [...rules].sort()]);

const sourceNames: Record<string, string> = { shopify: 'Shopify', 'j-and-j': 'J&J', meta: 'Meta',
  'google-ads': 'Google', mailchimp: 'Mailchimp', tiktok: 'TikTok', pulse: 'Pulse' };
const sourceName = (source: string): string => sourceNames[source] ?? source;
const readTime = (input: MorningInput, scope: string): string => input.sourceReadAt?.[scope]
  ? `last read ${input.sourceReadAt[scope]}` : 'waiting for a successful read';
const plain = (value: string, label: string): MorningFigure => ({ kind: 'plain', value, label });
const save = (label: string, action: MorningAction): MorningButton => ({ kind: 'save', target: 'morning', label, action });
const park = (): MorningButton => save('Not today', 'park');
const hide = (): MorningButton => save('Stop showing this', 'hide');
const link = (label: string, href: string) => ({ kind: 'link' as const, label, href });
const dateLabel = (day: string): string => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short',
}).format(new Date(`${day}T12:00:00Z`)).replaceAll(',', '');

function identity(kind: MorningKind, subjectId: string, state: MorningTone, ruleId: string) {
  return { key: morningKey(kind, subjectId), kind, subjectId, state, ruleId,
    factsHash: morningFacts(kind, subjectId, state, ruleId) };
}
function needCard(need: DashboardNeed, input: MorningInput, order: number): MorningCard {
  const alarm = need.state === 'alarm', watchdog = input.checks.some(check => check.id === need.id && check.status === 'tripped');
  const source = sourceName(need.source);
  const title = need.link.startsWith('/settings') ? 'Open settings' : need.link.startsWith('/ads') ? 'Open ads'
    : need.link.startsWith('/fulfilment') ? 'Open fulfilment' : need.link.startsWith('/sources') ? 'Open source health'
    : need.link.startsWith('/morning') ? 'Open Morning' : 'Open source';
  return { ...identity('need', need.id, alarm ? 'alarm' : 'warn', need.id), sourceScope: `needs:${need.source}`,
    tier: alarm ? 0 : watchdog ? 2 : 5, order: watchdog ? order : 100 + order,
    title: need.title, lane: source, source: need.source,
    figure: plain(need.figure?.value ?? source, need.figure?.label ?? (alarm ? 'Needs attention' : 'Watch')),
    why: need.why, whyLine: need.why, rule: watchdog ? `Watchdog: ${need.id}` : `Dashboard rule: ${need.id}`,
    sourceLine: `${source} · ${input.mode === 'sample' ? 'sample data · ' : ''}${readTime(input, `needs:${need.source}`)}`,
    sourceHref: need.link, primary: link(title, need.link),
    secondary: alarm ? save('Seen', 'ack') : park(), menu: alarm ? [] : [hide()],
    allowedPresses: alarm ? ['ack'] : ['park', 'hide'],
  };
}
function adFigure(row: AdSetRow, input: MorningInput): MorningFigure {
  const verdict = row.verdict!, rule = verdict.reasons.find(reason => reason.verdict === verdict.verdict)?.rule;
  const rules = row.set.market === 'unknown' ? undefined : input.settings.adRules[row.set.market];
  let value: number | null = null, bar: number | null = null, label = 'Cost per purchase';
  if (rule === 'purchase-cost' && rules && verdict.breakEven !== null) { value = verdict.cpp; bar = verdict.breakEven * rules.killBar; }
  if (rule === 'atc-cost' && rules) { value = verdict.cpatc; bar = rules.atcBarGbp; label = 'Cost per add to cart'; }
  if (rule === 'slipping' && rules && verdict.breakEven !== null) {
    const days = row.days.filter(day => day.day >= addDays(input.adSets!.today, -3) && day.day < input.adSets!.today);
    const purchases = days.every(day => day.purchases !== null) ? days.reduce((sum, day) => sum + day.purchases!, 0) : 0;
    value = purchases > 0 ? days.reduce((sum, day) => sum + day.spend, 0) / purchases : null;
    bar = verdict.breakEven * rules.slippingBar;
  }
  if (verdict.verdict === 'Step' && row.set.dailyBudget !== null && verdict.proposedBase !== null) {
    value = row.set.dailyBudget / 100; bar = verdict.proposedBase; label = 'Daily base';
  }
  return value !== null && bar !== null && Number.isFinite(value) && Number.isFinite(bar) && bar > 0
    ? { kind: 'dial', value, bar, label, formattedValue: formatPounds(value), formattedBar: formatPounds(bar) }
    : plain(verdict.figures[0], verdict.figures[1]);
}
function adCard(row: AdSetRow, input: MorningInput, order: number, today: string): MorningCard {
  const verdict = row.verdict!, word = verdict.verdict, name = adSetName(row.set.name);
  const kind: MorningKind = word === 'Kill' ? 'meta-kill' : word === 'Slipping' ? 'meta-slipping' : word === 'Step' ? 'meta-step' : 'meta-watch';
  const state = kind === 'meta-watch' ? 'warn' : 'decide';
  const ruleId = verdict.reasons.find(reason => reason.verdict === word)?.rule ?? word;
  const uncertain = input.metaActions.find(action => action.adSetId === row.set.id
    && (action.result === 'pending' && parsePauseUncertainty(action.errorCode)?.phase === 'waiting'
      || action.result === 'failed' && parsePauseUncertainty(action.errorCode)?.phase === 'active')
    && !input.metaActions.some(later => later.adSetId === action.adSetId && later.result === 'success' && later.time >= action.time));
  const waiting = uncertain?.result === 'pending';
  const view = input.adSets!, actions = view.mode === 'live' && view.actionsEnabled && row.set.owner === 'ours' && !waiting;
  const open = link('Open set', `/ads#${encodeURIComponent(row.set.id)}`);
  const pause: MorningButton = { kind: 'live', label: `Pause ${name}`, adSetId: row.set.id, action: 'pause', value: 'PAUSED', confirm: `Pause ${name} now?` };
  let primary: MorningButton = open, secondary = park(), menu: MorningButton[] = [], allowedPresses: MorningAction[] = ['park'];
  if (word === 'Kill') {
    primary = actions ? pause : open; secondary = save('One more day', 'park');
    menu = ([3, 7] as const).map(days => ({kind: 'save', target: 'morning', label: `Hold ${days} days`, action: 'hold', days}));
    allowedPresses.push('hold');
  } else if (word === 'Slipping') {
    secondary = save('One more day', 'park'); menu = actions ? [{ ...pause, label: 'Pause it now' }] : [];
  } else if (word === 'Step') {
    const base = row.set.dailyBudget === null ? null : row.set.dailyBudget / 100;
    if (actions && base !== null && verdict.proposedBase !== null) primary = { kind: 'live', label: `Step to ${formatPounds(verdict.proposedBase)} a day`,
      adSetId: row.set.id, action: 'budget', value: verdict.proposedBase,
      confirm: `Step ${name} from ${formatPounds(base)} to ${formatPounds(verdict.proposedBase)} a day?` };
    secondary = save(`Hold until ${dateLabel(addDays(today, 7))}`, 'hold'); menu = [park()]; allowedPresses = ['hold', 'park'];
  } else { menu = [hide()]; allowedPresses.push('hide'); }
  return { ...identity(kind, row.set.id, state, ruleId), sourceScope: 'adsets',
    tier: state === 'decide' ? 1 : 5, order: word === 'Kill' ? order : word === 'Slipping' ? 10_000 + order : word === 'Step' ? 30_000 + order : 10_000 + order,
    title: word === 'Kill' ? `${name} is over its kill bar` : word === 'Slipping' ? `${name} is slipping`
      : word === 'Step' ? `${name} has earned a step` : `${name} · ${word}`,
    lane: `Meta · ${row.set.market === 'unknown' ? 'market unknown' : row.set.market.toUpperCase()}`, source: 'meta',
    figure: adFigure(row, input), whyLine: verdict.reason,
    ...(uncertain ? {flag: pauseUncertaintyNote(uncertain.errorCode) ?? undefined} : {}),
    why: [verdict.reason, uncertain ? pauseUncertaintyNote(uncertain.errorCode) : null].filter(Boolean).join('\n'),
    rule: `${ruleId}: ${verdict.reasons.filter(reason => reason.verdict === word).map(reason => reason.text).join(' · ') || verdict.reason}${word === 'Step' ? ' Hold stops this proposal on this screen. It does not stop a change made outside this app.' : ''}`,
    sourceLine: `Meta · ${view.mode === 'sample' ? 'sample data' : 'stored ad-set read'}${view.lastRead ? ` · ${view.lastRead}` : ''}`, sourceHref: open.href,
    primary, secondary, menu, allowedPresses,
  };
}
function dateCards(input: MorningInput): MorningCard[] {
  return input.ticker.ahead.filter(item => item.days <= MORNING_DATE_DAYS).map((item, index) => {
    const late = item.days < 0;
    const done: MorningButton = { kind: 'save', target: 'ticker', eventKey: item.key, action: 'next',
      label: 'Done, move on', subline: 'Clears it from the strip too' };
    const copy: MorningButton = { kind: 'copy', label: 'Copy a chase note',
      text: `Checking in on ${item.name}, due ${item.dateLabel}.${item.note ? ` ${item.note}` : ''}\nPlease confirm the next step and timing.` };
    const far = item.days >= 4;
    return { ...identity('date', item.key, late ? 'warn' : 'info', late ? 'late-date' : 'upcoming-date'),
      sourceScope: 'ticker', tier: late ? 2 : 3, order: late ? 10_000 + index : index,
      title: item.name, lane: 'Dates', source: 'pulse', eventKey: item.key, eventDate: item.date,
      figure: { kind: 'rail', value: Math.abs(item.days), label: late ? item.chip : item.days === 0 ? 'Due today' : `${item.days} ${item.days === 1 ? 'day' : 'days'} left`, range: MORNING_DATE_DAYS } as MorningFigure,
      flag: late ? item.chip : undefined, why: item.note || `${item.name} is due ${item.dateLabel}.`,
      whyLine: item.note || undefined, rule: 'Hard deadlines and launches. Dates do not advance by themselves.',
      sourceLine: `${input.mode === 'sample' ? 'Sample dates' : 'Saved key dates'} · UK calendar days`, sourceHref: '/settings#keyDates',
      primary: late ? copy : far ? save(`Remind me ${dateLabel(addDays(item.date, -3))}`, 'remind') : done,
      secondary: park(), menu: late || far ? [done, hide()] : [hide()],
      allowedPresses: far ? ['remind', 'park', 'hide'] : ['park', 'hide'],
    };
  });
}
function creativeCards(input: MorningInput): MorningCard[] {
  return input.creativeCards.filter(card => input.mode === 'sample' || card.mode === 'live').map((card, index) => {
    const fading = card.kind === 'watch', kind = fading ? 'fading' : 'make-next', state = fading ? 'warn' : 'info';
    const ruleIds = fading ? [...(card.ruleIds?.length ? card.ruleIds : ['fading'])].sort() : [card.id];
    const copy: MorningButton = { kind: 'copy', label: 'Copy brief', text: card.brief ?? card.reason };
    const open = link('Open creative', `/creatives#${encodeURIComponent(card.groupId)}`);
    const defaultBrief = { bullets: [{ text: card.reason, strength: card.strength === 'Strong' ? 3 : card.strength === 'Likely' ? 2 : 1 }],
      text: card.brief ?? card.reason, footer: 'Stored creative evidence.' };
    const figure = input.creativeFigures?.[card.id] ?? (fading
      ? { kind: 'thumb', src: card.picture, alt: card.title, value: 'Watch', label: card.reason }
      : { kind: 'brief', variants: { '1': { bullets: [], text: 'One-day evidence is unavailable.', footer: 'Read the stored seven-day brief.' },
        '3': { bullets: [], text: 'Three-day evidence is unavailable.', footer: 'Read the stored seven-day brief.' }, '7': defaultBrief } }) as MorningFigure;
    return { ...identity(kind, card.id, state, ruleIds.join('|')),
      factsHash: morningFacts(kind, card.id, state, fading ? ruleIds : card.id), sourceScope: 'creatives',
      tier: fading ? 2 : 3, order: fading ? 30_000 + index : 10_000 + index,
      title: card.title, lane: 'Meta · creative', source: 'meta', figure,
      why: card.reason, whyLine: fading ? card.reason : 'Creative patterns, not proof. Tap for the evidence.', rule: fading ? 'Fading creative: the stored performance rule has tripped.' : 'Make next: stored creative patterns, not proof.',
      sourceLine: `Meta creative evidence · ${card.mode === 'sample' ? 'sample data · ' : ''}${readTime(input, 'creatives')}`, sourceHref: open.href,
      primary: fading && !card.brief ? open : copy, secondary: park(), menu: [hide()], allowedPresses: ['park', 'hide'],
    };
  });
}
function externalChanges(input: MorningInput, today: string): MorningCard[] {
  const rows = input.adSets?.rows ?? [];
  return input.activity.filter(event => event.type === 'update_ad_set_budget' && activityObjectType(event.objectType) === 'Ad set'
    && ukToday(new Date(event.time)) === today && input.settings.ourActors.some(actor => actor.actorId === event.actorId)
    && event.oldPence !== null && event.newPence !== null && event.oldPence !== event.newPence
    && rows.some(row => row.set.id === event.objectId && row.set.owner === 'ours')
    && !input.metaActions.some(action => action.result === 'success' && action.action === 'budget'
      && action.adSetId === event.objectId && action.oldValue === String(event.oldPence) && action.newValue === String(event.newPence)
      && Math.abs(Date.parse(action.time) - Date.parse(event.time)) <= MORNING_ACTION_MATCH_MS)
    && !input.metaActions.some(action => action.result === 'success' && action.action === 'budget' && !action.undoneAt
      && action.adSetId === event.objectId && action.oldValue === String(event.newPence) && action.newValue === String(event.oldPence)
      && Date.parse(action.time) >= Date.parse(event.time)
      && rows.some(row => row.set.id === event.objectId && row.set.dailyBudget === event.oldPence)))
    .map((event, index) => {
      const row = rows.find(row => row.set.id === event.objectId)!, name = adSetName(row.set.name);
      const pounds = event.currency === 'GBP' && row.set.currency === 'GBP';
      const old = pounds ? formatPounds(event.oldPence! / 100) : `${event.currency ?? 'Unknown currency'} ${(event.oldPence! / 100).toFixed(2)}`;
      const value = pounds ? formatPounds(event.newPence! / 100) : `${event.currency ?? 'Unknown currency'} ${(event.newPence! / 100).toFixed(2)}`;
      const canUndo = input.adSets!.mode === 'live' && input.adSets!.actionsEnabled && pounds && row.set.dailyBudget === event.newPence
        && allowedBudgetChange(row.set.dailyBudget!, event.oldPence!);
      return { ...identity('done-for-you', event.id, 'done', event.id), sourceScope: 'activity', tier: 4, order: index,
        title: `${name} stepped from ${old} to ${value} a day`, lane: 'Meta · changed outside this app', source: 'meta',
        figure: plain(value, `Daily base · was ${old}`), why: 'A configured actor changed this set outside this app.',
        rule: 'Today’s budget changes by configured actor IDs, excluding matching app actions within five minutes.',
        sourceLine: `Meta change history · ${event.time}`, sourceHref: `/ads#${encodeURIComponent(row.set.id)}`, primary: save('OK', 'ack'),
        ...(canUndo ? { secondary: { kind: 'live', label: 'Undo the step', adSetId: row.set.id, action: 'budget', value: event.oldPence! / 100,
          confirm: `Put ${name} back to ${old} a day?` } as MorningButton } : {}),
        menu: [], allowedPresses: ['ack'], seenUntilDay: addDays(today, 1),
      } satisfies MorningCard;
    });
}

function allCards(input: MorningInput, today: string): MorningCard[] {
  const excluded = new Set(input.excludeNeedIds ?? []);
  const needs = input.needs.filter(need => !need.id.startsWith('stock:') && !need.id.startsWith('attach:') && !excluded.has(need.id)
    && (need.state === 'alarm' || need.state === 'warn')).map((need, index) => needCard(need, input, index));
  const ads = input.adSets && (input.mode === 'sample' || input.adSets.mode === 'live')
    ? decisionRows(input.adSets).filter(row => row.set.status !== 'PAUSED'
      && !(row.verdict?.verdict === 'Step' && input.metaActions.some(action => action.adSetId === row.set.id
        && action.action === 'budget' && action.result === 'success'
        && ukToday(new Date(action.time)) === today))).map((row, index) => adCard(row, input, index, today)) : [];
  const combined = [...needs, ...ads, ...dateCards(input), ...creativeCards(input), ...externalChanges(input, today), ...(input.extensions ?? [])];
  const unique = new Set<string>();
  return combined.filter(card => { if (unique.has(card.key)) return false; unique.add(card.key); return true; })
    .sort((a, b) => a.tier - b.tier || a.order - b.order);
}
function stateApplies(row: MorningState, card: MorningCard | undefined, input: MorningInput, today: string): boolean {
  if (row.clearedAt || row.untilDay && row.untilDay <= today) return false;
  if (row.state === 'answered' && row.answer === 'hold') return true;
  if (row.state === 'answered') return !input.sourceReadOk[row.sourceScope] || !!input.liveTestIds?.includes(row.subjectId);
  if (row.state === 'seen') return true;
  if (card) return row.factsHash === card.factsHash;
  if (row.state === 'parked') return true;
  if (row.kind === 'need' && input.checks.some(check => check.id === row.subjectId && check.status === 'unknown')) return true;
  return !input.sourceReadOk[row.sourceScope];
}
function away(row: MorningState): MorningAway {
  return { stateRow: row, title: row.title, untilDay: row.untilDay,
    reason: row.state === 'hidden' ? 'Stopped showing until the rule changes'
      : row.answer === 'hold' ? `Held here until ${row.untilDay}. Nothing changed in Meta.`
      : row.state === 'seen' ? `Seen until ${row.untilDay}` : `Parked until ${row.untilDay}` };
}
function actionsToday(input: MorningInput, today: string, now: Date): MorningMetaAction[] {
  return input.metaActions.filter(action => action.result === 'success' && ukToday(new Date(action.time)) === today).map(action => {
    const row = input.adSets?.rows.find(row => row.set.id === action.adSetId), name = row ? adSetName(row.set.name) : 'Ad set';
    const current = row ? String(action.action === 'budget' ? row.set.dailyBudget : row.set.status) : null;
    const later = input.metaActions.some(other => other.id !== action.id && other.adSetId === action.adSetId && other.result === 'success' && other.time >= action.time);
    const canUndo = !!row && input.adSets!.mode === 'live' && input.adSets!.actionsEnabled && row.set.owner === 'ours' && row.set.currency === 'GBP'
      && !action.undoneAt && !action.undoOf && !later && current === action.newValue
      && now.getTime() >= Date.parse(action.time) && now.getTime() - Date.parse(action.time) <= 86_400_000;
    return { ...action, title: action.undoOf ? `Undid a change to ${name}` : action.action === 'budget' ? `${name} stepped to ${formatPounds(Number(action.newValue) / 100)} a day`
      : `${name} ${action.action === 'pause' ? 'paused' : 'resumed'}`,
      undo: canUndo ? { kind: 'live', label: 'Undo', adSetId: action.adSetId, action: 'undo', value: action.id, confirm: `Undo the saved change to ${name}?` } : null };
  });
}

/** Candidates stay complete for Home omissions; only decisions belong in the deck. */
export function morningDeckMember(card: MorningCard): boolean {
  if (card.kind === 'need') return card.state === 'alarm';
  if (card.kind === 'check-item') return true;
  if (['meta-watch', 'date', 'fading', 'make-next', 'new-verdict'].includes(card.kind)) return false;
  // A test call is a decision only when a stored reading backs it; one with no reading stays on Home.
  return card.state === 'decide' || card.kind === 'done-for-you';
}
function deckPriority(card: MorningCard): number {
  if (card.state === 'alarm') return 0;
  if (card.kind === 'pause-all') return 1;
  if (card.kind === 'meta-kill') return 2;
  if (card.kind === 'meta-slipping') return 3;
  if (card.kind === 'check-item' && card.state === 'decide') return 3.5;
  if (card.kind === 'meta-step' || card.kind === 'test-call') return 4;
  if (card.kind === 'done-for-you') return 5;
  if (card.kind === 'google') return 6;
  return 7;
}
function answeredDeckCard(row: MorningState, card: MorningCard | undefined): boolean {
  // One by one changes presentation; the individual decisions still need answers.
  if (row.kind === 'pause-all') return false;
  if (row.kind === 'need') return row.state === 'seen';
  if (row.kind === 'check-item') return true;
  if (row.kind === 'google' && row.sourceScope === 'check') return true;
  if (card) return morningDeckMember(card);
  return ['meta-kill', 'meta-slipping', 'meta-step', 'test-call', 'done-for-you', 'google'].includes(row.kind);
}

/** One deterministic projection: no reads, writes, wall clock or external calls. */
export function morningDeck(input: MorningInput, rows: readonly MorningState[], now: Date): MorningResult {
  const day = ukToday(now), ordinary = allCards(input, day);
  const states = rows.filter(row => row.mode === input.mode), clearKeys: string[] = [], deleteKeys: string[] = [];
  // Fold into open individual decisions before an optional aggregate covers them.
  const openOrdinaryKeys = new Set(ordinary.filter(card => !states.some(row => row.cardKey === card.key
    && stateApplies(row, card, input, day) && !(card.state === 'alarm' && row.state !== 'seen'))).map(card => card.key));
  const check = morningCheckItems(input, ordinary, openOrdinaryKeys, day), candidates = check.candidates;
  input = { ...input, sourceReadOk: { ...input.sourceReadOk, check: check.eligible } };
  const byKey = new Map(candidates.map(card => [card.key, card]));
  const applicable = new Map<string, MorningState>(), effective: MorningState[] = [];
  for (const row of states) {
    const applies = stateApplies(row, byKey.get(row.cardKey), input, day);
    const pressedToday = ukToday(new Date(row.pressedAt)) === day;
    if (applies) { applicable.set(row.cardKey, row); effective.push(row); }
    else if (pressedToday) {
      if (!row.clearedAt) clearKeys.push(row.cardKey);
      effective.push(row.clearedAt ? row : { ...row, clearedAt: now.toISOString() });
    } else deleteKeys.push(row.cardKey);
  }
  const presses = effective.filter(row => ukToday(new Date(row.pressedAt)) === day).sort((a, b) => a.pressedAt.localeCompare(b.pressedAt));
  const metaActions = actionsToday(input, day, now);
  const passedDates = input.ticker.passed.filter(row => ukToday(new Date(row.passed_at)) === day);
  const completed = presses.filter(row => answeredDeckCard(row, byKey.get(row.cardKey))).length
    + metaActions.filter(action => !action.undoOf && !action.undoneAt).length;
  const openCards = candidates.filter(card => {
    const saved = applicable.get(card.key);
    return !saved || card.state === 'alarm' && saved.state !== 'seen';
  });
  const group = morningPauseAll(input, openCards, applicable);
  if (group.card) {
    candidates.push(group.card);
    if (!group.coverage!.deferred) openCards.push(group.card);
  }
  const covered = new Set(group.card && !group.coverage!.deferred ? group.coverage!.members.map(member => member.cardKey) : []);
  const offered = openCards.filter(card => morningDeckMember(card) && !covered.has(card.key))
    .sort((a, b) => deckPriority(a) - deckPriority(b));
  const watchItems = offered.filter(card => card.kind === 'check-item' && card.state === 'warn');
  const allowance = Math.max(3, MORNING_LIMIT - (offered.length - watchItems.length));
  const omitted = new Set(watchItems.slice(allowance).map(card => card.key));
  const cards = offered.filter(card => !omitted.has(card.key));
  const brief = input.brief && check.eligible ? { ...input.brief, moreHere: omitted.size,
    allInDeck: check.totalItemCount > 0 && check.representedItemCount - omitted.size === check.totalItemCount } : input.brief ?? null;
  const watchOnHome = openCards.filter(card => !morningDeckMember(card) && card.state === 'warn').length;
  const fine = input.checks.filter(check => check.status === 'pass').map(check => ({ id: check.id, label: check.name }));
  const clearSets = input.adSets?.rows.filter(row => row.set.owner === 'ours' && row.verdict?.verdict === 'Clear').length ?? 0;
  if (clearSets) fine.push({ id: 'meta-clear', label: `${clearSets} of our ad ${clearSets === 1 ? 'sets is' : 'sets are'} clear` });
  if (!input.needs.some(need => need.source === 'google-ads') && !candidates.some(card => card.kind === 'google') && (input.mode === 'sample' || input.sourceReadOk.google))
    fine.push({ id: 'google-clear', label: 'No Google flags' });
  if (!input.ticker.ahead.some(item => item.days < 0)) fine.push({ id: 'dates-clear', label: 'No late dates' });
  const active = [...applicable.values()];
  return { candidates, openCards, clearKeys, deleteKeys, snapshot: { mode: input.mode, day, cards,
    ...(input.settings.morningSummaryEnabled ? { summaryEnabled: true } : {}),
    ...(group.coverage ? {pauseAll: group.coverage} : {}),
    more: omitted.size, watchOnHome, fine,
    ...(check.datedFromCheck.length ? {datedFromCheck: check.datedFromCheck} : {}),
    parked: active.filter(row => row.state === 'parked' || row.state === 'answered' && row.answer === 'hold').map(away),
    hidden: active.filter(row => row.state === 'hidden').map(away), presses, metaActions, passedDates,
    answers: active.filter(row => row.state === 'answered'), brief,
    completed, total: completed + cards.length,
  } };
}
