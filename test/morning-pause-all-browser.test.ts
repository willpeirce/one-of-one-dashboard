import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MorningCard, MorningMetaAction, MorningPauseMember, MorningSnapshot } from '../src/morning/model-types.js';
import { pauseAllSequential, undoPausesSequential, type PausedMorningSet } from '../src/morning/pause-all-browser.js';

const member = (index: number): MorningPauseMember => ({ cardKey: `invented-kill-${index}`, factsHash: `invented-facts-${index}`, adSetId: `12000000000000000${index}` });
const members = (count: number): MorningPauseMember[] => Array.from({ length: count }, (_, index) => member(index + 1));
const groupKey = 'invented-pause-all';
function kill(target: MorningPauseMember): MorningCard {
  return { key: target.cardKey, kind: 'meta-kill', subjectId: target.adSetId, sourceScope: 'adsets', factsHash: target.factsHash,
    ruleId: 'purchase-cost', state: 'decide', tier: 1, order: 0, title: `Invented fern ${target.adSetId}`, lane: 'Meta', source: 'meta',
    figure: { kind: 'plain', value: '£80 spend', label: 'Invented judgement' }, why: 'Invented purchase cost is over its bar.',
    rule: 'Invented rule', sourceLine: 'Invented stored read',
    primary: { kind: 'live', label: 'Pause', adSetId: target.adSetId, action: 'pause', value: 'PAUSED', confirm: 'Pause this invented set?' },
    menu: [], allowedPresses: ['park'] };
}
function snapshot(open: MorningPauseMember[], deferred = false, actions: MorningMetaAction[] = []): MorningSnapshot {
  const cards = open.map(kill);
  const group: MorningCard | undefined = cards[0] && open.length >= 3 && !deferred ? { ...cards[0], key: groupKey, kind: 'pause-all',
    subjectId: 'invented-group', title: `${open.length} of ours are over the bar`,
    figure: { kind: 'list', rows: cards.slice(0, 8).map(card => ({ label: card.title, value: '£80 spend' })), more: Math.max(0, cards.length - 8) },
    primary: { kind: 'pause-all', label: `Pause all ${open.length}`, confirm: `Pause these ${open.length} ad sets now?`, members: open.map(row => ({ ...row })) } } : undefined;
  return { mode: 'live', day: '2032-04-06', cards: group ? [group] : cards, more: 0, watchOnHome: 0, fine: [],
    parked: [], hidden: [], presses: [], metaActions: actions, passedDates: [], answers: [], brief: null, completed: 0,
    total: group ? 1 : cards.length, pauseAll: { cardKey: groupKey, members: open.map(row => ({ ...row })), deferred } };
}
const unexpectedDefer = async (): Promise<MorningSnapshot> => { throw new Error('Unexpected invented deferral'); };
function receipt(target: MorningPauseMember, index: number, overrides: Partial<MorningMetaAction> = {}): MorningMetaAction {
  const id = `invented-action-${index}`;
  return { id, time: `2032-04-06T10:00:${String(index).padStart(2, '0')}Z`, adSetId: target.adSetId,
    action: 'pause', oldValue: 'ACTIVE', newValue: 'PAUSED', result: 'success', undoneAt: null, undoOf: null, errorCode: null,
    title: 'Invented set paused', undo: { kind: 'live', label: 'Undo', adSetId: target.adSetId, action: 'undo', value: id,
      confirm: 'Undo the invented pause?' }, ...overrides };
}


test('Pause all reads before every sequential request and finishes the original cohort below three', async () => {
  const original = members(5); let open = [...original], reads = 0, inFlight = 0, maximumInFlight = 0;
  const calls: string[] = [], progress: number[][] = [];
  const result = await pauseAllSequential(original, {
    read: async () => { reads++; return snapshot(open); }, defer: unexpectedDefer,
    pause: async row => {
      inFlight++; maximumInFlight = Math.max(maximumInFlight, inFlight); await Promise.resolve();
      calls.push(row.adSetId); open = open.filter(target => target.adSetId !== row.adSetId); inFlight--;
      return { id: `invented-action-${calls.length}` };
    }, progress: (done, total) => progress.push([done, total]),
  });
  assert.deepEqual(calls, original.map(row => row.adSetId)); assert.equal(reads, 6); assert.equal(maximumInFlight, 1);
  assert.deepEqual(progress, [[1, 5], [2, 5], [3, 5], [4, 5], [5, 5]]);
  assert.equal(result.paused.length, 5); assert.equal(result.error, undefined); assert.equal(result.snapshot?.cards.length, 0);
  assert.equal(result.skipped, 0); assert.equal(result.deferred, false);
});

test('A failure on the third of five keeps two action references, defers three remaining sets and never retries', async () => {
  const original = members(5); let open = [...original], attempts = 0, reads = 0, deferrals = 0, deferred = false;
  const result = await pauseAllSequential(original, {
    read: async () => { reads++; return snapshot(open, deferred); },
    pause: async row => {
      attempts++; if (attempts === 3) throw new Error('Invented third pause refused.');
      open = open.filter(target => target.adSetId !== row.adSetId); return { id: `invented-action-${attempts}` };
    },
    defer: async key => { assert.equal(key, groupKey); deferrals++; deferred = true; return snapshot(open, true); },
  });
  assert.equal(attempts, 3); assert.equal(reads, 4); assert.equal(deferrals, 1);
  assert.equal(result.error, 'Invented third pause refused.'); assert.equal(result.deferred, true);
  assert.deepEqual(result.paused.map(row => row.actionId), ['invented-action-1', 'invented-action-2']);
  assert.deepEqual(result.snapshot?.cards.map(card => card.key), original.slice(2).map(row => row.cardKey));
  assert.equal(result.skipped, 2);
});

test('A committed third pause with a lost response recovers its new audit receipt and stops without retry', async () => {
  const original = members(5); let open = [...original], attempts = 0, reads = 0;
  const audits: MorningMetaAction[] = [];
  const result = await pauseAllSequential(original, {
    read: async () => { reads++; return snapshot(open, false, audits); }, defer: unexpectedDefer,
    pause: async row => {
      attempts++; open = open.filter(target => target.adSetId !== row.adSetId);
      const action = receipt(row, attempts); audits.unshift(action);
      if (attempts === 3) throw new Error('Invented pause response was lost.');
      return { id: action.id };
    },
  });
  assert.equal(attempts, 3); assert.equal(reads, 4); assert.equal(result.paused.length, 3);
  assert.equal(result.error, 'Invented pause response was lost.');
  assert.deepEqual(result.paused.map(row => row.actionId), ['invented-action-1', 'invented-action-2', 'invented-action-3']);
  assert.deepEqual(result.snapshot?.cards.map(card => card.key), original.slice(3).map(row => row.cardKey));
  const undone: string[] = [];
  assert.deepEqual(await undoPausesSequential(result.paused, async row => { undone.push(row.actionId); }), { undone: 3 });
  assert.deepEqual(undone, ['invented-action-3', 'invented-action-2', 'invented-action-1']);
});

test('Receipt recovery rejects old, failed, undone, undo, ambiguous and superseded actions', async () => {
  const target = member(1), pause = receipt(target, 3);
  const cases: { label: string; before: MorningMetaAction[]; after: MorningMetaAction[] }[] = [
    { label: 'already seen', before: [pause], after: [pause] },
    { label: 'failed', before: [], after: [{ ...pause, result: 'failed' }] },
    { label: 'undone', before: [], after: [{ ...pause, undoneAt: '2032-04-06T10:00:04Z' }] },
    { label: 'undo row', before: [], after: [{ ...pause, undoOf: 'invented-prior-action' }] },
    { label: 'another set', before: [], after: [receipt(member(2), 3)] },
    { label: 'multiple pauses', before: [], after: [pause, receipt(target, 4)] },
    { label: 'later resume', before: [], after: [pause, receipt(target, 4, { action: 'resume', oldValue: 'PAUSED', newValue: 'ACTIVE' })] },
    { label: 'later budget', before: [], after: [pause, receipt(target, 4, { action: 'budget', oldValue: '2000', newValue: '2400' })] },
    { label: 'unknown time', before: [], after: [{ ...pause, time: 'invented invalid time' }] },
    { label: 'wrong transition', before: [], after: [{ ...pause, oldValue: 'PAUSED' }] },
  ];
  for (const scenario of cases) {
    let failed = false, attempts = 0, reads = 0;
    const result = await pauseAllSequential([target], {
      read: async () => { reads++; return snapshot([target], false, failed ? scenario.after : scenario.before); },
      defer: unexpectedDefer, pause: async () => { attempts++; failed = true; throw new Error('Invented lost response.'); },
    });
    assert.equal(attempts, 1, scenario.label); assert.equal(reads, 2, scenario.label);
    assert.equal(result.paused.length, 0, scenario.label); assert.equal(result.error, 'Invented lost response.', scenario.label);
  }
});

test('A known successful receipt is not appended twice if progress reporting fails', async () => {
  const target = member(1), action = receipt(target, 1); let paused = false;
  const result = await pauseAllSequential([target], {
    read: async () => snapshot(paused ? [] : [target], false, paused ? [action] : []), defer: unexpectedDefer,
    pause: async () => { paused = true; return { id: action.id }; },
    progress: () => { throw new Error('Invented progress unavailable.'); },
  });
  assert.deepEqual(result.paused.map(row => row.actionId), [action.id]);
  assert.equal(result.error, 'Invented progress unavailable.');
});

test('Changed facts, changed identities and absent members are skipped without adding a new member', async () => {
  const original = members(4), replacement = member(5); let calls = 0, reads = 0;
  let current = [{ ...original[0]!, factsHash: 'invented-new-facts' }, { ...original[1]!, adSetId: replacement.adSetId }, original[3]!, replacement];
  const result = await pauseAllSequential(original, {
    read: async () => { reads++; return snapshot(current); }, defer: unexpectedDefer,
    pause: async row => { calls++; assert.deepEqual(row, original[3]); current = current.filter(target => target.adSetId !== row.adSetId); return { id: 'invented-only-action' }; },
  });
  assert.equal(calls, 1); assert.equal(reads, 5); assert.equal(result.skipped, 3);
  assert.deepEqual(result.paused.map(row => row.member), [original[3]]);
});

test('The confirmed cohort is copied before the first read and duplicate ad-set IDs cannot pause twice', async () => {
  const canonical = members(2), original = [canonical[0]!, { ...canonical[0]!, factsHash: 'invented-duplicate-facts' }, canonical[1]!, canonical[0]!];
  let open = canonical.map(row => ({ ...row })), changed = false;
  const calls: string[] = [], totals: number[] = [];
  const result = await pauseAllSequential(original, {
    read: async () => {
      if (!changed) { changed = true; original[2]!.factsHash = 'invented-mutated-after-confirmation'; original.push(member(3)); }
      return snapshot(open);
    }, defer: unexpectedDefer,
    pause: async row => { calls.push(row.adSetId); open = open.filter(target => target.adSetId !== row.adSetId); return { id: `invented-action-${calls.length}` }; },
    progress: (_done, total) => totals.push(total),
  });
  assert.deepEqual(calls, canonical.map(row => row.adSetId)); assert.deepEqual(totals, [2, 2]);
  assert.equal(result.paused.length, 2); assert.equal(result.skipped, 2);
});

test('One by one chosen during a sequence stops its remaining members after the next fresh read', async () => {
  const original = members(3); let open = [...original], deferred = false, reads = 0, calls = 0;
  const result = await pauseAllSequential(original, {
    read: async () => { reads++; return snapshot(open, deferred); }, defer: unexpectedDefer,
    pause: async row => { calls++; open = open.filter(target => target.adSetId !== row.adSetId); deferred = true; return { id: 'invented-first-action' }; },
  });
  assert.equal(calls, 1); assert.equal(reads, 2); assert.equal(result.deferred, true); assert.equal(result.skipped, 2);
  assert.deepEqual(result.snapshot?.cards.map(card => card.key), original.slice(1).map(row => row.cardKey));
});

test('A mode change stops remaining requests even if stale eligibility metadata is present', async () => {
  const original = members(3); let paused = false, calls = 0, reads = 0;
  const result = await pauseAllSequential(original, {
    read: async () => { reads++; return { ...snapshot(original), mode: paused ? 'sample' : 'live' }; },
    defer: unexpectedDefer, pause: async () => { calls++; paused = true; return { id: 'invented-first-action' }; },
  });
  assert.equal(calls, 1); assert.equal(reads, 2); assert.equal(result.paused.length, 1);
  assert.equal(result.skipped, 2); assert.equal(result.error, undefined); assert.equal(result.snapshot?.mode, 'sample');
  calls = 0;
  const sample = await pauseAllSequential(original, {
    read: async () => ({ ...snapshot(original), mode: 'sample' }), defer: unexpectedDefer,
    pause: async () => { calls++; return { id: 'invented-forbidden-action' }; },
  });
  assert.equal(calls, 0); assert.equal(sample.skipped, 3); assert.equal(sample.error, undefined);
});

test('Missing eligibility metadata never causes a pause', async () => {
  const original = members(3); let reads = 0;
  const result = await pauseAllSequential(original, {
    read: async () => { reads++; const next = snapshot(original); delete next.pauseAll; return next; }, defer: unexpectedDefer,
    pause: async () => { throw new Error('An absent member must not be requested'); },
  });
  assert.equal(reads, 3); assert.equal(result.paused.length, 0); assert.equal(result.skipped, 3); assert.equal(result.error, undefined);
});

test('A failed preflight read stops without retry and retains only a snapshot newer than any own write', async () => {
  const original = members(3); let reads = 0;
  const first = snapshot([]);
  const withoutWrites = await pauseAllSequential(original, {
    read: async () => { if (++reads === 2) throw new Error('Invented read unavailable.'); return first; },
    defer: unexpectedDefer, pause: async () => { throw new Error('Unexpected invented pause'); },
  });
  assert.equal(reads, 2); assert.equal(withoutWrites.snapshot, first); assert.equal(withoutWrites.error, 'Invented read unavailable.');
  reads = 0; let pauses = 0;
  const afterWrite = await pauseAllSequential(original, {
    read: async () => { if (++reads === 2) throw new Error('Invented read unavailable.'); return snapshot(original); },
    defer: unexpectedDefer, pause: async () => { pauses++; return { id: 'invented-first-action' }; },
  });
  assert.equal(reads, 2); assert.equal(pauses, 1); assert.equal(afterWrite.snapshot, null); assert.equal(afterWrite.paused.length, 1);
});

test('A failed final read cannot return the pre-pause snapshot', async () => {
  const original = members(1); let reads = 0;
  const result = await pauseAllSequential(original, {
    read: async () => { if (++reads === 2) throw new Error('Invented final read failed.'); return snapshot(original); },
    defer: unexpectedDefer, pause: async () => ({ id: 'invented-only-action' }),
  });
  assert.equal(reads, 2); assert.equal(result.paused.length, 1); assert.equal(result.snapshot, null);
  assert.equal(result.error, 'Invented final read failed.');
});

test('A failed reconciliation preserves the first pause error and cannot return a pre-write snapshot', async () => {
  const original = members(3); let reads = 0, pauses = 0;
  const result = await pauseAllSequential(original, {
    read: async () => { if (++reads === 2) throw new Error('Invented reconciliation failed.'); return snapshot(original); },
    defer: unexpectedDefer, pause: async () => { pauses++; throw new Error('Invented pause refused.'); },
  });
  assert.equal(pauses, 1); assert.equal(reads, 2); assert.equal(result.snapshot, null);
  assert.equal(result.error, 'Invented pause refused. Could not refresh Morning or switch to one by one.');
});

test('A lost local deferral response is read back once and never retried', async () => {
  const original = members(3); let deferred = false, deferrals = 0, reads = 0;
  const result = await pauseAllSequential(original, {
    read: async () => { reads++; return snapshot(original, deferred); },
    pause: async () => { throw new Error('Invented pause refused.'); },
    defer: async () => { deferrals++; deferred = true; throw new Error('Invented lost local response.'); },
  });
  assert.equal(reads, 3); assert.equal(deferrals, 1); assert.equal(result.deferred, true);
  assert.equal(result.error, 'Invented pause refused.'); assert.ok(result.snapshot?.cards.every(card => card.kind === 'meta-kill'));
});

test('A failed local deferral keeps the first error and explains that individual cards could not be restored', async () => {
  const original = members(3); let deferrals = 0;
  const result = await pauseAllSequential(original, {
    read: async () => snapshot(original), pause: async () => { throw new Error('Invented pause refused.'); },
    defer: async () => { deferrals++; throw new Error('Invented local refusal.'); },
  });
  assert.equal(deferrals, 1); assert.equal(result.deferred, false);
  assert.equal(result.error, 'Invented pause refused. Could not switch to one by one. Refresh Morning.');
});

test('Undo all sends the saved audit references in reverse order, sequentially, and stops at the first failure', async () => {
  const paused: PausedMorningSet[] = members(3).map((row, index) => ({ member: row, actionId: `invented-action-${index + 1}` }));
  const calls: string[] = []; let inFlight = 0, maximumInFlight = 0;
  const done = await undoPausesSequential(paused, async row => {
    inFlight++; maximumInFlight = Math.max(maximumInFlight, inFlight); await Promise.resolve(); calls.push(row.actionId); inFlight--;
  });
  assert.deepEqual(calls, ['invented-action-3', 'invented-action-2', 'invented-action-1']);
  assert.equal(maximumInFlight, 1); assert.deepEqual(done, { undone: 3 });
  calls.length = 0;
  const stopped = await undoPausesSequential(paused, async row => { calls.push(row.actionId); if (calls.length === 2) throw new Error('Invented undo refused.'); });
  assert.deepEqual(calls, ['invented-action-3', 'invented-action-2']);
  assert.deepEqual(stopped, { undone: 1, error: 'Invented undo refused.' });
});
