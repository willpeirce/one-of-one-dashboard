import type { Database } from '../db.js';
import type { DashboardSnapshot } from '../dashboard-types.js';
import type { Settings } from '../settings.js';
import type { SourceMode } from '../sources.js';
import { ukToday } from '../hero-range.js';
import { readTicker } from '../ticker/store.js';
import { morningInputFromDashboard, readMorningCoverage } from './inputs.js';
import { morningDeck } from './model.js';
import { morningGoogleNeeds } from './google.js';
import { readMorningStates } from './store.js';
import type { MorningHomeOmissions, MorningInput, MorningState } from './model-types.js';

const homeKinds = new Set<MorningState['kind']>(['need', 'meta-kill', 'meta-slipping', 'meta-step', 'meta-watch', 'fading', 'make-next', 'google']);
function relevantStates(rows: readonly MorningState[], mode: SourceMode, now: Date): MorningState[] {
  const today = ukToday(now);
  return rows.filter(row => row.mode === mode && !row.clearedAt && (!row.untilDay || row.untilDay > today)
    && homeKinds.has(row.kind) && (row.state === 'parked' || row.state === 'hidden' || row.state === 'answered' && row.answer === 'hold'));
}

/** Match the current facts and verdict, never merely the shared subject ID. */
export function homeMorningOmissions(input: MorningInput, rows: readonly MorningState[], now: Date): MorningHomeOmissions | undefined {
  const states = relevantStates(rows, input.mode, now);
  if (!states.length) return undefined;
  const result = morningDeck(input, states, now);
  const away = new Set([...result.snapshot.parked, ...result.snapshot.hidden].map(row => row.stateRow.cardKey));
  const omissions: MorningHomeOmissions = { needs: [], adSets: [], creatives: [] };
  for (const card of result.candidates) {
    if (card.state === 'alarm' || !away.has(card.key)) continue;
    if (card.kind === 'need') omissions.needs.push(card.subjectId);
    else if (card.kind === 'google') omissions.needs.push(...morningGoogleNeeds(input).map(need => need.id));
    else if (card.kind === 'fading' || card.kind === 'make-next') omissions.creatives.push(card.subjectId);
    else if (card.kind.startsWith('meta-')) {
      const verdict = input.adSets?.rows.find(row => row.set.id === card.subjectId)?.verdict?.verdict;
      if (verdict) omissions.adSets.push({ id: card.subjectId, verdict });
    }
  }
  return omissions.needs.length || omissions.adSets.length || omissions.creatives.length ? omissions : undefined;
}

/** One cheap state read on the empty path; otherwise reuse the already-built Home observations. */
export async function readHomeMorningOmissions(db: Database, dashboard: DashboardSnapshot, settings: Settings, mode: SourceMode,
  now: Date, options: { metaNow?: Date; googleNow?: Date } = {}): Promise<MorningHomeOmissions | undefined> {
  const states = relevantStates(await readMorningStates(db, mode), mode, now);
  if (!states.length) return undefined;
  const [ticker, coverage] = await Promise.all([
    readTicker(db, mode, now),
    mode === 'live' ? readMorningCoverage(db, settings.metaAdAccountId, options.metaNow ?? now,
      { googleAccount: settings.googleCustomerId, googleNow: options.googleNow ?? now }) : undefined,
  ]);
  // Morning read/press transactions remain the cleanup authority. Home only projects omissions.
  return homeMorningOmissions(morningInputFromDashboard(dashboard, settings, ticker, mode, coverage), states, now);
}
