import type { Database } from '../db.js';
import { addDays } from '../hero-range.js';
import { readSettings, type Settings } from '../settings.js';
import { getSourceStates, type SourceMode } from '../sources.js';
import { cachedMetaCampaigns, invalidateMetaCampaigns, storedCampaignSync, type CampaignSyncState } from './campaign-cache.js';
import { SPEND_STALE_AFTER_MS } from './worker.js';
export { recordCampaignSync, type CampaignSyncState } from './campaign-cache.js';
import {
  accountFor,
  adSources,
  decimalMicros,
  microsDecimal,
  ownerFor,
  type AdSource,
  type MetaCampaign,
  type MetaCampaignView,
  type SpendRow,
} from './model.js';
export async function saveMetaCampaigns(
  db: Database,
  account: string,
  campaigns: MetaCampaign[],
  now: Date,
): Promise<void> {
  if (!campaigns.length) {
    invalidateMetaCampaigns(db, account);
    return;
  }
  const rows = [...new Map(campaigns.map((campaign) => [campaign.id, campaign])).values()];
  await db.query(
    `INSERT INTO pulse.meta_campaigns(campaign_id,account_id,name,status,created_at,first_seen,last_seen)
    SELECT r.id,$1,r.name,r.status,r.created_at,$3,$3
    FROM jsonb_to_recordset($2::jsonb) AS r(id text,name text,status text,created_at timestamptz)
    ON CONFLICT (campaign_id) DO UPDATE SET account_id=EXCLUDED.account_id,name=EXCLUDED.name,
      status=EXCLUDED.status,created_at=EXCLUDED.created_at,last_seen=EXCLUDED.last_seen`,
    [
      account,
      JSON.stringify(rows.map(({ createdAt, ...row }) => ({ ...row, created_at: createdAt }))),
      now,
    ],
  );
  invalidateMetaCampaigns(db, account);
}

/** Invented source-shaped campaigns; only these sample ids can pick up saved local rules. */
export function sampleMetaCampaigns(settings: Pick<Settings, 'metaOwners'>): MetaCampaignView[] {
  const campaigns: Omit<MetaCampaignView, 'firstSeen' | 'lastSeen' | 'mode'>[] = [
    {
      id: '900000000601', name: 'Invented Aurora discovery', status: 'ACTIVE',
      createdAt: '2026-09-01T08:00:00Z', owner: 'ours', confirmed: true,
    },
    {
      id: '900000000602', name: 'Invented Cedar retargeting', status: 'PAUSED',
      createdAt: '2026-09-12T09:00:00Z', owner: 'freelancer', confirmed: true,
    },
    {
      id: '900000000603', name: 'Invented Lumen launch', status: 'ACTIVE',
      createdAt: '2026-09-29T10:00:00Z', owner: 'ours', confirmed: false,
    },
  ];
  return campaigns.map((campaign) => {
    const saved = settings.metaOwners.find((rule) => rule.campaignId === campaign.id);
    return {
      ...campaign,
      firstSeen: '2026-09-30T12:00:00.000Z', lastSeen: '2026-09-30T12:00:00.000Z',
      owner: saved?.owner ?? campaign.owner,
      confirmed: !!saved || campaign.confirmed,
      mode: 'sample' as const,
    };
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function readMetaCampaigns(
  db: Database,
  settings: Settings,
  env: NodeJS.ProcessEnv,
): Promise<MetaCampaignView[]> {
  const account = settings.metaAdAccountId,
    live = !!account && getSourceStates(env).find((state) => state.source === 'meta')!.mode === 'live';
  if (!live) return sampleMetaCampaigns(settings);
  return (await cachedMetaCampaigns(db, account)).map((row) => ({
    ...row,
    owner: ownerFor('meta', row.id, settings),
    confirmed: settings.metaOwners.some((rule) => rule.campaignId === row.id),
    mode: 'live' as const,
  }));
}

export async function readCampaignSync(
  db: Database,
  settings: Settings,
  env: NodeJS.ProcessEnv,
): Promise<CampaignSyncState> {
  const account = settings.metaAdAccountId,
    live = !!account && getSourceStates(env).find((state) => state.source === 'meta')!.mode === 'live';
  return live ? storedCampaignSync(db, account)
    : { state: 'success', at: '2026-09-30T12:00:00.000Z' };
}
export interface SpendJob {
  source: AdSource;
  account_id: string;
  backfill_next: string;
  backfill_done: boolean;
  last_poll_at: Date | null;
  last_success_at: Date | null;
  failures: number;
}
export async function readJobs(db: Database): Promise<SpendJob[]> {
  return (
    await db.query<SpendJob & Record<string, unknown>>(
      'SELECT source,account_id,backfill_next::text,backfill_done,last_poll_at,last_success_at,failures FROM pulse.ad_spend_jobs',
    )
  ).rows;
}
export async function saveSpend(
  db: Database,
  source: AdSource,
  account: string,
  from: string,
  to: string,
  rows: SpendRow[],
  now: Date,
  next?: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.query(
      'DELETE FROM pulse.ad_spend WHERE mode=$1 AND source=$2 AND account_id=$3 AND uk_day BETWEEN $4 AND $5',
      ['live', source, account, from, to],
    );
    if (rows.length)
      await tx.query(
        `INSERT INTO pulse.ad_spend(mode,source,account_id,campaign_id,campaign_name,ad_set_id,ad_set_name,market,owner,uk_day,spend_amount,spend_gbp,currency,fetched_at)
      SELECT 'live',$1,$2,r.campaign_id,r.campaign_name,r.ad_set_id,r.ad_set_name,r.market,r.owner,r.day,r.amount,CASE WHEN r.currency='GBP' THEN r.amount ELSE NULL END,r.currency,$4
      FROM jsonb_to_recordset($3::jsonb) AS r(campaign_id text,campaign_name text,ad_set_id text,ad_set_name text,market text,owner text,day date,amount numeric,currency text)
      ON CONFLICT (mode,source,campaign_id,ad_set_id,uk_day) DO UPDATE SET account_id=EXCLUDED.account_id,campaign_name=EXCLUDED.campaign_name,ad_set_name=EXCLUDED.ad_set_name,market=EXCLUDED.market,owner=EXCLUDED.owner,spend_amount=EXCLUDED.spend_amount,spend_gbp=EXCLUDED.spend_gbp,currency=EXCLUDED.currency,fetched_at=EXCLUDED.fetched_at`,
        [
          source,
          account,
          JSON.stringify(
            rows.map((r) => ({
              campaign_id: r.campaignId,
              campaign_name: r.campaignName,
              ad_set_id: r.adSetId,
              ad_set_name: r.adSetName,
              market: r.market,
              owner: r.owner,
              day: r.day,
              amount: r.amount,
              currency: r.currency,
            })),
          ),
          now,
        ],
      );
    await tx.query(
      `INSERT INTO pulse.ad_spend_days(source,account_id,uk_day,fetched_at) SELECT $1,$2,day,$5 FROM generate_series($3::date,$4::date,interval '1 day') AS day
      ON CONFLICT (source,account_id,uk_day) DO UPDATE SET fetched_at=EXCLUDED.fetched_at`,
      [source, account, from, to, now],
    );
    if (next)
      await tx.query(
        'UPDATE pulse.ad_spend_jobs SET backfill_next=$3 WHERE source=$1 AND account_id=$2',
        [source, account, next],
      );
  });
}
export interface SpendFacts {
  mode: SourceMode;
  rows: SpendRow[];
  sources: {
    source: AdSource;
    live: boolean;
    ready: boolean;
    status: string;
    fetchedAt: string | null;
    failures?: number;
    stale?: boolean;
    lastAttemptAt?: string | null;
  }[];
  days: { source: AdSource; day: string }[];
}
export async function spendFacts(
  db: Database,
  settings: Settings,
  env: NodeJS.ProcessEnv,
  mode: SourceMode,
  from: string,
  to: string,
  now = new Date(),
): Promise<SpendFacts> {
  if (mode === 'sample') return sampleSpend(from, to, settings);
  const states = getSourceStates(env),
    jobs = await readJobs(db);
  const sources = adSources.map((source) => {
    const account = accountFor(source, settings),
      live = !!account && states.find((s) => s.source === source)!.mode === 'live';
    const job = jobs.find((j) => j.source === source && j.account_id === account);
    return sourceFacts(source, live, job, now);
  });
  const rows: SpendRow[] = [],
    days: SpendFacts['days'] = [];
  for (const source of sources.filter((s) => s.live)) {
    const account = accountFor(source.source, settings);
    const stored = await db.query<any>(
      `SELECT campaign_id,campaign_name,ad_set_id,ad_set_name,market,uk_day::text,spend_amount::text,currency FROM pulse.ad_spend WHERE mode='live' AND source=$1 AND account_id=$2 AND uk_day BETWEEN $3 AND $4`,
      [source.source, account, from, to],
    );
    rows.push(
      ...stored.rows.map((r) => ({
        source: source.source,
        accountId: account,
        campaignId: r.campaign_id,
        campaignName: r.campaign_name,
        adSetId: r.ad_set_id,
        adSetName: r.ad_set_name,
        market: r.market,
        owner: ownerFor(source.source, r.campaign_id, settings),
        day: r.uk_day,
        amount: r.spend_amount,
        currency: r.currency,
      })),
    );
    const coverage = await db.query<{ day: string }>(
      'SELECT uk_day::text AS day FROM pulse.ad_spend_days WHERE source=$1 AND account_id=$2 AND uk_day BETWEEN $3 AND $4',
      [source.source, account, from, to],
    );
    days.push(...coverage.rows.map((r) => ({ ...r, source: source.source })));
    // A successfully fetched zero-spend day is still stored coverage for this range.
    if (source.stale && !stored.rows.length && !coverage.rows.length) source.ready = false;
  }
  return { mode, rows, sources, days };
}
/** Invented daily spend, only returned alongside sample Shopify facts. */
export function sampleSpend(
  from: string,
  to: string,
  settings: Pick<Settings, 'metaOwners'> = { metaOwners: [] },
): SpendFacts {
  const rows: SpendRow[] = [],
    days: SpendFacts['days'] = [];
  const campaigns = sampleMetaCampaigns(settings);
  for (let day = from; day <= to; day = addDays(day, 1)) {
    for (const [source, owner, market, amount] of [
      ['meta', 'ours', 'uk', '48.20'],
      ['meta', 'ours', 'us', '0.00'],
      ['meta', 'freelancer', 'uk', '252.00'],
      ['meta', 'freelancer', 'us', '240.00'],
      ['google-ads', 'freelancer', 'uk', '70.00'],
      ['google-ads', 'freelancer', 'us', '30.00'],
      ['tiktok', 'freelancer', 'uk', '12.40'],
    ] as const) {
      const campaign = source === 'meta'
        ? campaigns.find((row) => row.id === (owner === 'ours' ? '900000000601' : '900000000602'))!
        : null;
      rows.push({
        source,
        accountId: `sample-${source}-account`,
        campaignId: campaign?.id ?? `sample-${source}-${owner}-${market}`,
        campaignName: campaign?.name ?? `Invented ${source} ${market.toUpperCase()}`,
        adSetId: source === 'meta' ? `sample-adset-${owner}-${market}` : null,
        adSetName: source === 'meta' ? 'Invented ad set' : null,
        market,
        owner: campaign?.owner ?? owner,
        day,
        amount: microsDecimal(decimalMicros(amount)),
        currency: 'GBP',
      });
    }
    for (const source of adSources) days.push({ source, day });
  }
  return {
    mode: 'sample',
    rows,
    days,
    sources: adSources.map((source) => ({
      source,
      live: false,
      ready: true,
      status: 'sample data · waiting for keys',
      fetchedAt: null,
    })),
  };
}
function sourceFacts(source: AdSource, live: boolean, job: SpendJob | undefined, now: Date) {
  const fetchedAt = job?.last_success_at ? new Date(job.last_success_at).toISOString() : null,
    stale = live && !!fetchedAt && now.getTime() - new Date(fetchedAt).getTime() > SPEND_STALE_AFTER_MS;
  return {
    source,
    live,
    ready: live && !!fetchedAt,
    status: !live
      ? 'waiting for keys'
      : job?.failures
        ? 'source unavailable'
        : !fetchedAt
          ? 'first sync pending'
          : stale
            ? `stale · last fetched ${new Intl.DateTimeFormat('en-GB', {
              timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short',
            }).format(new Date(fetchedAt))} UK`
            : !job!.backfill_done
              ? `backfill running · next ${job!.backfill_next}`
              : 'live',
    fetchedAt,
    failures: live ? job?.failures ?? 0 : 0,
    stale,
    lastAttemptAt: job?.last_poll_at ? new Date(job.last_poll_at).toISOString() : null,
  };
}
export async function spendHealth(db: Database, env: NodeJS.ProcessEnv, settings: Settings, now = new Date()) {
  const jobs = await readJobs(db),
    states = getSourceStates(env);
  return adSources.map((source) => {
    const account = accountFor(source, settings),
      live = !!account && states.find((s) => s.source === source)!.mode === 'live';
    const job = jobs.find((j) => j.source === source && j.account_id === account);
    return sourceFacts(source, live, job, now);
  });
}
