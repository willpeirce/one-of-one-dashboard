import type { MorningPauseMember, MorningSnapshot } from './model-types.js';

export interface PausedMorningSet { member: MorningPauseMember; actionId: string }
export interface PauseAllOperations {
  read(): Promise<MorningSnapshot>;
  pause(member: MorningPauseMember): Promise<{ id: string }>;
  defer(cardKey: string): Promise<MorningSnapshot>;
  progress?(paused: number, total: number): void;
}
export interface PauseAllResult {
  paused: PausedMorningSet[];
  /** Never contains a snapshot from before this sequence's latest possible write. */
  snapshot: MorningSnapshot | null;
  error?: string;
  skipped: number;
  deferred: boolean;
}
const errorText = (error: unknown, fallback: string): string => error instanceof Error && error.message ? error.message : fallback;
const sameMember = (a: MorningPauseMember, b: MorningPauseMember): boolean =>
  a.adSetId === b.adSetId && a.cardKey === b.cardKey && a.factsHash === b.factsHash;
const openGroup = (snapshot: MorningSnapshot): string | undefined => {
  const group = snapshot.pauseAll;
  return snapshot.mode === 'live' && group && !group.deferred && snapshot.cards.some(card => card.kind === 'pause-all' && card.key === group.cardKey)
    ? group.cardKey : undefined;
};

function recoveredPause(member: MorningPauseMember, before: ReadonlySet<string>, snapshot: MorningSnapshot): string | undefined {
  if (snapshot.mode !== 'live') return undefined;
  const candidates = snapshot.metaActions.filter(action => !before.has(action.id) && action.adSetId === member.adSetId
    && action.action === 'pause' && action.result === 'success' && !action.undoOf && !action.undoneAt
    && action.oldValue === 'ACTIVE' && action.newValue === 'PAUSED');
  if (candidates.length !== 1) return undefined;
  const candidate = candidates[0]!, at = Date.parse(candidate.time);
  if (!Number.isFinite(at)) return undefined;
  // The same boundary protects individual Undo: a later success makes this receipt ambiguous.
  if (snapshot.metaActions.some(action => action.id !== candidate.id && action.adSetId === member.adSetId && action.result === 'success'
    && (!Number.isFinite(Date.parse(action.time)) || Date.parse(action.time) >= at))) return undefined;
  return candidate.id;
}

/** The caller supplies the existing guarded routes. This function never retries a request. */
export async function pauseAllSequential(members: readonly MorningPauseMember[], operations: PauseAllOperations): Promise<PauseAllResult> {
  const seen = new Set<string>();
  // Capture the confirmed cohort before the first await; later snapshots can only remove members.
  const cohort = members.filter(member => {
    if (seen.has(member.adSetId)) return false;
    seen.add(member.adSetId); return true;
  }).map(member => ({ ...member }));
  const result: PauseAllResult = { paused: [], snapshot: null, skipped: members.length - cohort.length, deferred: false };

  async function reconcileFailure(member: MorningPauseMember, before: ReadonlySet<string>): Promise<void> {
    try { result.snapshot = await operations.read(); }
    catch {
      result.snapshot = null;
      result.error += ' Could not refresh Morning or switch to one by one.';
      return;
    }
    const recovered = recoveredPause(member, before, result.snapshot);
    if (recovered && !result.paused.some(row => row.actionId === recovered || row.member.adSetId === member.adSetId))
      result.paused.push({ member: { ...member }, actionId: recovered });
    result.deferred = result.snapshot.pauseAll?.deferred ?? false;
    const key = openGroup(result.snapshot);
    if (!key) return;
    result.snapshot = null;
    try {
      result.snapshot = await operations.defer(key);
      result.deferred = result.snapshot.pauseAll?.deferred ?? false;
    } catch {
      // A lost local-press response can follow a committed deferral. Read once, without retrying it.
      try { result.snapshot = await operations.read(); }
      catch { result.snapshot = null; }
      result.deferred = result.snapshot?.pauseAll?.deferred ?? false;
      if (!result.snapshot || openGroup(result.snapshot)) result.error += ' Could not switch to one by one. Refresh Morning.';
    }
  }

  for (let index = 0; index < cohort.length; index++) {
    const member = cohort[index]!;
    try { result.snapshot = await operations.read(); }
    catch (error) {
      result.error = errorText(error, 'Could not refresh Morning.');
      result.skipped += cohort.length - index;
      return result;
    }
    if (result.snapshot.mode !== 'live') {
      result.skipped += cohort.length - index;
      return result;
    }
    if (result.snapshot.pauseAll?.deferred) {
      result.deferred = true;
      result.skipped += cohort.length - index;
      return result;
    }
    if (!result.snapshot.pauseAll?.members.some(current => sameMember(current, member))) {
      result.skipped++; continue;
    }
    const beforeActionIds = new Set(result.snapshot.metaActions.map(action => action.id));
    // Even a rejected response may follow a committed write; only a later read is safe to show.
    result.snapshot = null;
    try {
      const saved = await operations.pause({ ...member });
      result.paused.push({ member: { ...member }, actionId: saved.id });
      operations.progress?.(result.paused.length, cohort.length);
    } catch (error) {
      result.error = errorText(error, 'Could not pause this ad set.');
      result.skipped += cohort.length - index - 1;
      await reconcileFailure(member, beforeActionIds);
      return result;
    }
  }
  if (result.paused.length) {
    try { result.snapshot = await operations.read(); }
    catch (error) { result.error = errorText(error, 'Could not refresh Morning after pausing.'); }
  }
  return result;
}

/** Each undo keeps its original ad-set route and audit reference; there is no bulk source call. */
export async function undoPausesSequential(paused: readonly PausedMorningSet[], undo: (paused: PausedMorningSet) => Promise<unknown>): Promise<{ undone: number; error?: string }> {
  const reversed = paused.map(row => ({ member: { ...row.member }, actionId: row.actionId })).reverse();
  let undone = 0;
  for (const row of reversed) {
    try { await undo(row); undone++; }
    catch (error) { return { undone, error: errorText(error, 'Could not undo this pause.') }; }
  }
  return { undone };
}
