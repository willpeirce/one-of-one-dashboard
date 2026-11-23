import Anthropic from '@anthropic-ai/sdk';
import type { BetaMessage, MessageCreateParamsNonStreaming, BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import {
  askCapped, askDeadlineMs, askSystem, askToolSchema, askUnavailable, validateAskTool,
  type AskAnswer, type AskModel, type AskSource, type AskTool,
} from './protocol.js';

export interface AskUsage { input: number; output: number; cacheWrite: number; cacheRead: number }
export interface AskCall { name: string; input: Record<string, string> }
export interface AskRun { result: AskAnswer; usage: AskUsage; calls: AskCall[] }
type Request = MessageCreateParamsNonStreaming;
type Reply = Pick<BetaMessage, 'content' | 'usage' | 'stop_reason'> & { stop_details?: { category?: string | null } | null };

export type AskClient = (params: Request, signal: AbortSignal) => Promise<Reply>;

export function createAskClient(apiKey: string, model: AskModel, fetcher = fetch): AskClient {
  const client = new Anthropic({
    apiKey, baseURL: 'https://api.anthropic.com', maxRetries: 2, logLevel: 'off',
    fetch: async (input, options) => {
      const response = await fetcher(input, options);
      if (response.ok || response.status === 429 || response.status >= 500) return response;
      const headers = new Headers(response.headers);
      headers.set('x-should-retry', 'false');
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    },
  });
  return async (params, signal) => model === 'claude-sonnet-5-5'
    ? client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, { signal })
    : client.beta.messages.create(params, { signal });
}

export const newAskUsage = (): AskUsage => ({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0 });

type Log = (line: string) => void;
export const askErrorType = (error: unknown) => error instanceof Error && /^[A-Za-z0-9_]{1,64}$/.test(error.name) ? error.name : 'Error';

export async function runAsk(question: string, ukDate: string, model: AskModel, client: AskClient, tool: AskTool,
  log: Log = line => console.warn(line), timeoutMs = askDeadlineMs, withinBudget: (spent: AskUsage) => boolean = () => true): Promise<AskRun> {
  const usage = newAskUsage(), calls: AskCall[] = [], sources = new Map<string, AskSource>();
  const abort = new AbortController();
  const deadline = setTimeout(() => abort.abort(), timeoutMs);
  const unavailable: AskAnswer = { answer: askUnavailable, outcome: 'unavailable', sources: [] };
  const run = async (): Promise<AskAnswer> => {
    const messages: BetaMessageParam[] = [{ role: 'user', content: `Today in the UK is ${ukDate}. Dashboard mode: live.\n\n${question}` }];
    let text = '';
    for (let round = 0; round < 6; round++) {
      abort.signal.throwIfAborted();
      if (!withinBudget(usage)) return { answer: askCapped, outcome: 'capped', sources: [...sources.values()] };
      const response = await client({
        model, system: askSystem, messages, max_tokens: 4000,
        output_config: { effort: 'low' }, tool_choice: { type: 'auto' }, tools: askToolSchema,
        cache_control: { type: 'ephemeral' },
      }, abort.signal);
      abort.signal.throwIfAborted();
      usage.input += response.usage.input_tokens;
      usage.output += response.usage.output_tokens;
      usage.cacheWrite += response.usage.cache_creation_input_tokens ?? 0;
      usage.cacheRead += response.usage.cache_read_input_tokens ?? 0;
      const turnText = response.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n');
      if (turnText) text = turnText;
      const answerSources = () => [...sources.values()];
      switch (response.stop_reason) {
        case 'end_turn': return { answer: turnText || askUnavailable, outcome: turnText ? 'answered' : 'unavailable', sources: answerSources() };
        case 'max_tokens': return { answer: [turnText, 'Answer cut short'].filter(Boolean).join('\n\n'), outcome: 'cut short', sources: answerSources() };
        case 'refusal': {
          const category = response.stop_details?.category;
          log(`Ask refusal (${category && /^[a-z_]{1,48}$/.test(category) ? category : 'unknown'}).`);
          return { answer: 'Ask can’t answer that one', outcome: 'refused', sources: answerSources() };
        }
        case 'tool_use': {
          messages.push({ role: 'assistant', content: response.content });
          const results = [];
          for (const block of response.content) {
            if (block.type !== 'tool_use') continue;
            abort.signal.throwIfAborted();
            const validated = validateAskTool(block.name, block.input);
            if (validated) {
              calls.push(validated);
              try {
                const output = await tool(validated.name, validated.input);
                abort.signal.throwIfAborted();
                for (const source of output.sources) sources.set(`${source.name}:${source.asOf ?? ''}`, source);
                results.push({ type: 'tool_result' as const, tool_use_id: block.id, content: JSON.stringify(output) });
                continue;
              } catch (error) {
                abort.signal.throwIfAborted();
                log(`Ask tool ${validated.name} failed (${askErrorType(error)}).`);
              }
            }
            results.push({ type: 'tool_result' as const, tool_use_id: block.id, content: 'Tool input was invalid or the source is unavailable.', is_error: true });
          }
          messages.push({ role: 'user', content: results });
          break;
        }
        default:
          log('Ask stopped with an unsupported reason.');
          return { ...unavailable, sources: answerSources() };
      }
    }
    return { answer: [text, 'Answer cut short'].filter(Boolean).join('\n\n'), outcome: 'cut short', sources: [...sources.values()] };
  };
  try {
    const timedOut = new Promise<AskAnswer>(resolve => abort.signal.addEventListener('abort', () => {
      log('Ask failed (TimeoutError).');
      resolve({ ...unavailable, sources: [...sources.values()] });
    }, { once: true }));
    return { result: await Promise.race([run(), timedOut]), usage, calls };
  } catch (error) {
    log(`Ask failed (${askErrorType(error)}).`);
    return { result: { ...unavailable, sources: [...sources.values()] }, usage, calls };
  } finally {
    clearTimeout(deadline);
  }
}

const prices = { 'claude-haiku-5-5': [0.10, 0.50], 'claude-sonnet-5-5': [2, 10] } as const;
export function askCostPence(model: AskModel, usage: AskUsage, gbpPerUsd: number): number {
  const [input, output] = prices[model];
  const dollars = ((usage.input + 1.25 * usage.cacheWrite + usage.cacheRead) * input + usage.output * output) / 1_000_000;
  return Math.ceil(dollars * gbpPerUsd * 100 * 1_000_000) / 1_000_000;
}
