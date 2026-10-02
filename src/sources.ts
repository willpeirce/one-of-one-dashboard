import type { Database } from './db.js';

export const sourceDefinitions = [
  { id: 'shopify', name: 'Shopify', stage: 1, requiredKeys: ['SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET'] },
  { id: 'meta', name: 'Meta Ads', stage: 2, requiredKeys: ['META_ACCESS_TOKEN'] },
  { id: 'google-ads', name: 'Google Ads', stage: 3, requiredKeys: ['GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_REFRESH_TOKEN'] },
  { id: 'mailchimp', name: 'Mailchimp', stage: 4, requiredKeys: ['MAILCHIMP_API_KEY'] },
  { id: 'github-hq', name: 'GitHub HQ', stage: 5, requiredKeys: ['GITHUB_HQ_TOKEN'] },
  { id: 'gorgias', name: 'Gorgias', stage: 5, requiredKeys: ['GORGIAS_DOMAIN', 'GORGIAS_EMAIL', 'GORGIAS_API_KEY'] },
  { id: 'judgeme', name: 'Judge.me', stage: 1, requiredKeys: ['JUDGEME_API_TOKEN'] },
  { id: 'discord', name: 'Discord', stage: 5, requiredKeys: ['DISCORD_BOT_TOKEN'] },
  { id: 'ugc', name: 'UGC', stage: 5, requiredKeys: ['UGC_FEED_TOKEN'] },
  { id: 'anthropic', name: 'Anthropic', stage: 6, requiredKeys: ['ANTHROPIC_API_KEY'] },
] as const;

export type SourceId = (typeof sourceDefinitions)[number]['id'];
export type SourceMode = 'sample' | 'live';
export type SourceStatus = 'waiting_for_keys' | 'not_implemented' | 'healthy' | 'error';

export interface SourceState {
  source: SourceId;
  name: string;
  stage: number;
  requiredKeys: readonly string[];
  missingKeys: string[];
  mode: SourceMode;
  status: 'waiting_for_keys' | 'not_implemented';
}

export interface SourceHealth {
  source: SourceId;
  name: string;
  stage: number;
  requiredKeys: readonly string[];
  mode: SourceMode;
  status: SourceStatus;
  lastSuccessAt: Date | null;
  lastAttemptAt: Date | null;
  consecutiveFailures: number;
  updatedAt: Date;
}

// Read presence only. Neither the returned metadata nor the health table contains values.
export function getSourceStates(env: NodeJS.ProcessEnv): SourceState[] {
  return sourceDefinitions.map(({ id, name, stage, requiredKeys }) => {
    const missingKeys = requiredKeys.filter((key) => !env[key]?.trim());
    const mode = missingKeys.length === 0 ? 'live' : 'sample';
    return {
      source: id, name, stage, requiredKeys, missingKeys, mode,
      status: mode === 'sample' ? 'waiting_for_keys' : 'not_implemented',
    };
  });
}

export async function syncSourceHealth(db: Database, env: NodeJS.ProcessEnv): Promise<void> {
  for (const state of getSourceStates(env)) {
    await db.query(
      `INSERT INTO public.source_health (source, mode, status)
       VALUES ($1, $2, $3)
       ON CONFLICT (source) DO UPDATE SET
         mode = EXCLUDED.mode,
         status = EXCLUDED.status,
         last_success_at = CASE WHEN source_health.mode = EXCLUDED.mode
           THEN source_health.last_success_at ELSE NULL END,
         last_attempt_at = CASE WHEN source_health.mode = EXCLUDED.mode
           THEN source_health.last_attempt_at ELSE NULL END,
         consecutive_failures = CASE WHEN source_health.mode = EXCLUDED.mode
           THEN source_health.consecutive_failures ELSE 0 END,
         updated_at = CURRENT_TIMESTAMP`,
      [state.source, state.mode, state.status],
    );
  }
}

interface HealthRow extends Record<string, unknown> {
  source: SourceId;
  mode: SourceMode;
  status: SourceStatus;
  last_success_at: Date | null;
  last_attempt_at: Date | null;
  consecutive_failures: number;
  updated_at: Date;
}

export async function readSourceHealth(db: Database): Promise<SourceHealth[]> {
  const { rows } = await db.query<HealthRow>(
    `SELECT source, mode, status, last_success_at, last_attempt_at,
            consecutive_failures, updated_at FROM public.source_health`,
  );
  const bySource = new Map(rows.map((row) => [row.source, row]));
  return sourceDefinitions.flatMap(({ id, name, stage, requiredKeys }) => {
    const row = bySource.get(id);
    if (!row) return [];
    return [{
      source: id,
      name,
      stage,
      requiredKeys,
      mode: row.mode,
      status: row.status,
      lastSuccessAt: row.last_success_at,
      lastAttemptAt: row.last_attempt_at,
      consecutiveFailures: row.consecutive_failures,
      updatedAt: row.updated_at,
    }];
  });
}
