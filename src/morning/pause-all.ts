import { adSetName } from '../meta-adsets/name.js';
import {parsePauseUncertainty} from '../meta-adsets/pause-uncertainty.js';
import { morningFacts, morningKey } from './model.js';
import type { MorningCard, MorningInput, MorningSnapshot, MorningState } from './model-types.js';

interface PauseAllProjection {
  card?: MorningCard;
  coverage?: NonNullable<MorningSnapshot['pauseAll']>;
}

/** Group resolved open decisions; source observations and individual card identities stay unchanged. */
export function morningPauseAll(input: MorningInput, openCards: readonly MorningCard[],
  states: ReadonlyMap<string, MorningState>): PauseAllProjection {
  const view = input.adSets;
  if (input.mode !== 'live' || view?.mode !== 'live' || !view.actionsEnabled) return {};
  const subjectId = input.settings.metaAdAccountId || 'meta-account';
  const cardKey = morningKey('pause-all', subjectId), ruleId = 'our-active-kills';
  const byId = new Map(view.rows.map(row => [row.set.id, row]));
  const pending = new Set(input.metaActions.filter(action => action.result === 'pending').map(action => action.adSetId));
  const paused = new Set(input.metaActions.filter(action => action.action === 'pause' && action.result === 'success'
    && !action.undoneAt && !input.metaActions.some(later => later.adSetId === action.adSetId
      && later.result === 'success' && later.action === 'resume' && later.time >= action.time)).map(action => action.adSetId));
  const uncertain = new Set(input.metaActions.filter(action => action.action === 'pause' && action.result === 'failed'
    && parsePauseUncertainty(action.errorCode)?.phase === 'active' && !input.metaActions.some(later => later.adSetId === action.adSetId
      && later.result === 'success' && later.time >= action.time)).map(action => action.adSetId));
  const eligible = openCards.filter(card => {
    const button = card.primary, row = byId.get(card.subjectId);
    return card.kind === 'meta-kill' && button.kind === 'live' && button.action === 'pause'
      && button.adSetId === card.subjectId && row?.set.owner === 'ours' && row.set.status === 'ACTIVE'
      && row.set.effectiveStatus === 'ACTIVE' && row.set.currency === 'GBP'
      && row.verdict?.verdict === 'Kill' && !pending.has(row.set.id) && !paused.has(row.set.id) && !uncertain.has(row.set.id);
  });
  const members = eligible.map(card => ({cardKey: card.key, factsHash: card.factsHash, adSetId: card.subjectId}));
  const coverage = {cardKey, members, deferred: states.has(cardKey)};
  if (members.length < 3) return {coverage};
  const covered = new Set(members.map(member => member.adSetId));
  const flags = (['uk', 'us'] as const).flatMap(market => {
    const active = view.rows.filter(row => row.set.owner === 'ours' && row.set.status === 'ACTIVE'
      && row.set.effectiveStatus === 'ACTIVE' && row.set.market === market);
    return active.length && active.every(row => covered.has(row.set.id))
      ? [`After these, nothing of ours is live in the ${market.toUpperCase()}`] : [];
  });
  const lines = eligible.map(card => {
    const row = byId.get(card.subjectId)!;
    return {label: adSetName(row.set.name), value: row.verdict!.figures[0]};
  });
  const count = members.length;
  return {coverage, card: {
    key: cardKey, kind: 'pause-all', subjectId, sourceScope: 'adsets', state: 'decide', ruleId,
    // One by one lasts until tomorrow even when the failing cohort changes.
    factsHash: morningFacts('pause-all', subjectId, 'decide', ruleId), tier: 1, order: -1,
    title: `${count} of ours are over the bar`, lane: 'Meta · our ad sets', source: 'meta',
    figure: {kind: 'list', rows: lines.slice(0, 8), more: Math.max(0, count - 8)},
    ...(flags.length ? {flag: flags.join(' · ')} : {}),
    whyLine: 'Pause these sets together, or review them one by one.',
    why: [...lines.map((line, index) => `${line.label}: ${line.value}\n${eligible[index]!.why}`), ...flags].join('\n\n'),
    rule: 'Only our active sets already offering Pause. After one confirmation, each pause uses the existing guarded Meta action with its own audit and undo.',
    sourceLine: `Meta · stored ad-set read${view.lastRead ? ` · ${view.lastRead}` : ''}`, sourceHref: '/ads',
    primary: {kind: 'pause-all', label: `Pause all ${count}`, confirm: `Pause these ${count} ad sets now?`, members},
    secondary: {kind: 'save', target: 'morning', label: 'One by one', action: 'park'}, menu: [], allowedPresses: ['park'],
  }};
}
