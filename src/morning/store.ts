import type { Database } from '../db.js';
import { addDays, ukToday } from '../hero-range.js';
import type { SourceMode } from '../sources.js';
import { morningDeck } from './model.js';
import type { MorningAction, MorningCard, MorningInput, MorningResult, MorningSnapshot, MorningState } from './model-types.js';

export type MorningInputLoader = (now: Date) => Promise<MorningInput>;
export interface MorningPress { cardKey: string; action: MorningAction | 'undo'; answer?: 'a' | 'b' | 'draw' }

export class MorningPressError extends Error {
  constructor(readonly statusCode: 404 | 409, message: string) { super(message); }
}

export async function readMorningStates(db: Database, mode: SourceMode): Promise<MorningState[]> {
  const rows = (await db.query<{
    mode: SourceMode; card_key: string; state: MorningState['state']; until_day: string | null;
    facts_hash: string; answer: MorningState['answer']; credential_id: string; pressed_at: Date | string;
    cleared_at: Date | string | null; title: string; card_kind: MorningState['kind']; subject_id: string; source_scope: string;
  }>(`SELECT mode,card_key,state,until_day::text AS until_day,facts_hash,answer,credential_id,pressed_at,cleared_at,
    title,card_kind,subject_id,source_scope FROM pulse.morning_card_states WHERE mode=$1 ORDER BY pressed_at,card_key`, [mode])).rows;
  return rows.map(row => ({ mode: row.mode, cardKey: row.card_key, state: row.state, untilDay: row.until_day,
    factsHash: row.facts_hash, answer: row.answer, credentialId: row.credential_id, pressedAt: new Date(row.pressed_at).toISOString(),
    clearedAt: row.cleared_at ? new Date(row.cleared_at).toISOString() : null, title: row.title, kind: row.card_kind,
    subjectId: row.subject_id, sourceScope: row.source_scope }));
}

async function resolve(db: Database, input: MorningInput, now: Date): Promise<{states: MorningState[]; result: MorningResult}> {
  const states = await readMorningStates(db, input.mode);
  const result = morningDeck(input, states, now);
  try {
    if (result.clearKeys.length || result.deleteKeys.length) await db.transaction(async cleanup => {
      // A savepoint keeps failed best-effort cleanup from aborting the enclosing press.
      if (result.clearKeys.length) await cleanup.query(`UPDATE pulse.morning_card_states SET cleared_at=$3
        WHERE mode=$1 AND card_key=ANY($2::text[]) AND cleared_at IS NULL`, [input.mode, result.clearKeys, now]);
      if (result.deleteKeys.length) await cleanup.query('DELETE FROM pulse.morning_card_states WHERE mode=$1 AND card_key=ANY($2::text[])',
        [input.mode, result.deleteKeys]);
    });
  } catch { console.warn('Morning state cleanup failed; using the current projection.'); }
  return {states, result};
}

async function lock(db: Database, mode: SourceMode): Promise<void> {
  // The transaction only holds local state; source snapshots were already loaded before this lock.
  await db.query('SELECT pg_advisory_xact_lock(1668244583,hashtext($1))', [`morning:${mode}`]);
}

export async function readMorningResult(db: Database, loadInputs: MorningInputLoader, now: Date): Promise<MorningResult> {
  const input = await loadInputs(now);
  return db.transaction(async tx => {
    await lock(tx, input.mode);
    return (await resolve(tx, input, now)).result;
  });
}

export async function readMorning(db: Database, loadInputs: MorningInputLoader, now: Date): Promise<MorningSnapshot> {
  return (await readMorningResult(db, loadInputs, now)).snapshot;
}

function answerState(card: MorningCard, press: MorningPress, credentialId: string, mode: SourceMode, now: Date): MorningState {
  const today = ukToday(now);
  let state: MorningState['state'] = 'parked', answer: MorningState['answer'] = null, untilDay: string | null = addDays(today, 1);
  if (press.action === 'remind') {
    if (!card.eventDate) throw new MorningPressError(409, 'This card does not offer a reminder.');
    untilDay = addDays(card.eventDate, -3);
  } else if (press.action === 'hold') {
    state = 'answered'; answer = 'hold'; untilDay = addDays(today, 7);
  } else if (press.action === 'hide') { state = 'hidden'; untilDay = null; }
  else if (press.action === 'ack') { state = 'seen'; untilDay = card.seenUntilDay ?? addDays(today, 1); }
  else if (press.action === 'call') {
    if (!press.answer || card.callAnswer !== press.answer) throw new MorningPressError(409, 'Choose the call this card offers.');
    state = 'answered'; answer = press.answer; untilDay = null;
  }
  return { mode, cardKey: card.key, state, untilDay, factsHash: card.factsHash, answer, credentialId,
    pressedAt: now.toISOString(), clearedAt: null, title: card.title, kind: card.kind, subjectId: card.subjectId, sourceScope: card.sourceScope };
}

const caption = (press: MorningPress) => ({park: 'parked', remind: 'reminder set', hold: 'held', hide: 'hidden', ack: 'seen',
  call: `called ${press.answer?.toUpperCase()}`, undo: 'put back'}[press.action]);

export async function pressMorning(db: Database, loadInputs: MorningInputLoader, press: MorningPress,
  credentialId: string, now: Date): Promise<MorningSnapshot> {
  const input = await loadInputs(now);
  return db.transaction(async tx => {
    await lock(tx, input.mode);
    const {states, result} = await resolve(tx, input, now);
    let title: string;
    if (press.action === 'undo') {
      const previous = states.find(row => row.cardKey === press.cardKey);
      if (!previous) throw new MorningPressError(404, 'This saved answer is no longer listed.');
      title = previous.title;
      await tx.query('DELETE FROM pulse.morning_card_states WHERE mode=$1 AND card_key=$2', [input.mode, press.cardKey]);
    } else {
      const card = result.candidates.find(row => row.key === press.cardKey);
      if (!card) throw new MorningPressError(404, 'This card is no longer listed.');
      // Home offers eligible test calls through the same current candidate guard.
      const offered = card.kind === 'test-call' && press.action === 'call' ? result.openCards : result.snapshot.cards;
      if (!card.allowedPresses.includes(press.action) || !offered.some(row => row.key === card.key))
        throw new MorningPressError(409, 'This card does not offer that press.');
      const row = answerState(card, press, credentialId, input.mode, now);
      title = card.title;
      await tx.query(`INSERT INTO pulse.morning_card_states(mode,card_key,state,until_day,facts_hash,answer,credential_id,
        pressed_at,cleared_at,title,card_kind,subject_id,source_scope) VALUES($1,$2,$3,$4,$5,$6,$7,$8,NULL,$9,$10,$11,$12)
        ON CONFLICT(mode,card_key) DO UPDATE SET state=EXCLUDED.state,until_day=EXCLUDED.until_day,facts_hash=EXCLUDED.facts_hash,
        answer=EXCLUDED.answer,credential_id=EXCLUDED.credential_id,pressed_at=EXCLUDED.pressed_at,cleared_at=NULL,
        title=EXCLUDED.title,card_kind=EXCLUDED.card_kind,subject_id=EXCLUDED.subject_id,source_scope=EXCLUDED.source_scope`,
      [row.mode,row.cardKey,row.state,row.untilDay,row.factsHash,row.answer,row.credentialId,now,row.title,row.kind,row.subjectId,row.sourceScope]);
    }
    await tx.query('INSERT INTO pulse.audit_log(event,credential_id,occurred_at) VALUES($1,$2,$3)',
      [Array.from(`Morning ${caption(press)}: ${title}`).slice(0, 80).join(''), credentialId, now]);
    return (await resolve(tx, input, now)).result.snapshot;
  });
}
