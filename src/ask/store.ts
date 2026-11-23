import { randomUUID } from 'node:crypto';
import type { Database } from '../db.js';
import { ukToday } from '../hero-range.js';
import { askCostPence, createAskClient, runAsk, type AskClient } from './engine.js';
import { askCapped, askExamples, askSample, askUnavailable, type AskAnswer, type AskSettings, type AskTool } from './protocol.js';

export interface AskSourceStatus { lastAt: string | null; spentGbp: number; capGbp: number; model: string }
export interface AskServiceOptions {
  db: Database; settings: AskSettings & { jjGbpPerUsd: number }; tool: AskTool;
  mode: 'sample' | 'live'; now: Date; question: string; apiKey?: string; client?: AskClient;
}

export async function readAskStatus(db: Database, settings: AskSettings, now: Date): Promise<AskSourceStatus> {
  const { rows } = await db.query<{ last_at: Date | null; spent_pence: string }>(`
    SELECT max(asked_at) AS last_at, COALESCE(sum(cost_pence) FILTER (
      WHERE (asked_at AT TIME ZONE 'Europe/London')::date = $1::date), 0)::text AS spent_pence FROM pulse.ask_log`, [ukToday(now)]);
  return { lastAt: rows[0]?.last_at?.toISOString() ?? null, spentGbp: Number(rows[0]?.spent_pence ?? 0) / 100,
    capGbp: settings.askDailyCapGbp, model: settings.askModel };
}

export async function cleanupAsk(db: Database, now: Date): Promise<void> {
  await db.query("DELETE FROM pulse.ask_log WHERE asked_at < $1::timestamptz - interval '90 days'", [now]);
}

export function parseAskQuestion(input: unknown): string | null {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1 || !Object.hasOwn(input, 'question')) return null;
  const value = (input as { question: unknown }).question;
  if (typeof value !== 'string' || value.length > 300 || !value.trim()) return null;
  return value.trim();
}

const answer = (text: string, outcome: AskAnswer['outcome'] = 'unavailable'): AskAnswer => ({ answer: text, outcome, sources: [] });
const hourlyLimit = 30;
export const askHourlyMessage = 'Ask has reached its hourly limit. Try again later.';

export async function askQuestion({ db, settings, tool, mode, now, question, apiKey, client }: AskServiceOptions): Promise<AskAnswer> {
  if (mode === 'sample') return askSample(question);
  const at = ukToday(now), id = randomUUID();
  const start = performance.now();
  // Only predefined example text can be retained with certainty. Free-form text can contain names or addresses.
  const logQuestion = askExamples.find(example => example === question) ?? null;
  const access = await db.transaction(async tx => {
    await tx.query('SELECT pg_advisory_xact_lock(61251387)');
    const { rows } = await tx.query<{ recent: number; active: boolean; spent: string }>(`
      SELECT count(*) FILTER (WHERE asked_at > $1::timestamptz - interval '1 hour')::int AS recent,
        COALESCE(bool_or(pending AND asked_at > $1::timestamptz - interval '60 seconds'), false) AS active,
        COALESCE(sum(cost_pence) FILTER (WHERE (asked_at AT TIME ZONE 'Europe/London')::date = $2::date), 0)::text AS spent
      FROM pulse.ask_log WHERE asked_at >= LEAST($1::timestamptz - interval '1 hour', $2::date::timestamp AT TIME ZONE 'Europe/London')`, [now, at]);
    const status = rows[0]!;
    if (status.recent >= hourlyLimit) return 'hourly';
    if (status.active) return 'busy';
    const capped = Number(status.spent) >= settings.askDailyCapGbp * 100;
    await tx.query('INSERT INTO pulse.ask_log (id, question, model, outcome, asked_at, pending) VALUES ($1,$2,$3,$4,$5,$6)',
      [id, logQuestion, settings.askModel, capped ? 'capped' : 'unavailable', now, !capped]);
    return capped ? 'capped' : 'allowed';
  });
  if (access === 'capped') return answer(askCapped, 'capped');
  if (access === 'hourly') return answer(askHourlyMessage);
  if (access === 'busy') return answer('Ask is already answering a question');
  const deadline = Math.max(1, 60_000 - (performance.now() - start));
  const allowed = !/[@]|https?:\/\/|\b\d[\d ().-]{6,}\d\b/i.test(question);
  const activeClient = allowed ? client ?? (apiKey?.trim() ? createAskClient(apiKey.trim(), settings.askModel) : undefined) : undefined;
  const run = activeClient ? await runAsk(question, at, settings.askModel, activeClient, tool, undefined, deadline) : null;
  const result = run?.result ?? answer(allowed ? askUnavailable : 'Ask about dashboard figures without including contact details');
  const usage = run?.usage;
  // Retain fixed status messages and token/tool accounting. Model answer text can echo arbitrary user input.
  const logAnswer = result.outcome === 'refused' ? 'Ask can’t answer that one' : result.outcome === 'unavailable' ? askUnavailable : null;
  await db.query(`UPDATE pulse.ask_log SET answer=$2, tools=$3, input_tokens=$4, output_tokens=$5, cache_write_tokens=$6,
      cache_read_tokens=$7, cost_pence=$8, duration_ms=$9, outcome=$10, pending=false WHERE id=$1`,
  [id, logAnswer, JSON.stringify(run?.calls ?? []), usage?.input ?? 0, usage?.output ?? 0, usage?.cacheWrite ?? 0, usage?.cacheRead ?? 0,
    usage ? askCostPence(settings.askModel, usage, settings.jjGbpPerUsd) : 0, Math.round(performance.now() - start), result.outcome]);
  return result;
}
