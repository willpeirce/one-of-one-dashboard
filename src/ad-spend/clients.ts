import { fetchAdSets, type AdSet } from '../meta-adsets/catalogue.js';
import { addDays } from '../hero-range.js';
import type { Settings } from '../settings.js';
import { AdTransport, type AdTransportOptions } from './http.js';
import {
  AdError,
  aggregateHours,
  decimalMicros,
  microsDecimal,
  hourDay,
  ownerFor,
  type SpendRow,
  type AdSource,
  type MetaCampaign,
} from './model.js';
import { metaAction, META_PURCHASE, META_ADD_TO_CART } from './meta-actions.js';
import { spendMarket } from './placement.js';
export interface SpendReader {
  read(account: string, from: string, to: string, settings: Settings): Promise<SpendRow[]>;
  readCampaigns?(account: string): Promise<MetaCampaign[]>;
  readAdSets?(account: string, settings: Settings): Promise<AdSet[]>;
}
const label = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > 300)
    throw new AdError('invalid');
  return value;
};
const currency = (value: unknown) => {
  const c = label(value);
  if (!/^[A-Z]{3}$/.test(c)) throw new AdError('invalid');
  return c;
};
const identifier = (value: unknown) => {
  const id = String(value ?? '');
  if (!/^[\w-]{1,100}$/.test(id)) throw new AdError('invalid');
  return id;
};
const list = (value: unknown): any[] => {
  if (!Array.isArray(value)) throw new AdError('invalid');
  return value;
};
const apiVersions = { meta: 'v25.0', google: 'v24', tiktok: 'v1.3' } as const;
const campaignStatuses = new Set(['ACTIVE', 'PAUSED', 'ARCHIVED', 'DELETED', 'IN_PROCESS', 'WITH_ISSUES']);
function campaignCreatedAt(value: unknown): string {
  const text = label(value), date = new Date(text);
  if (
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)$/.test(text) ||
    !Number.isFinite(date.getTime()) ||
    new Date(`${text.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !== text.slice(0, 10)
  ) throw new AdError('invalid');
  return date.toISOString();
}
export function parseMeta(
  body: any,
  account: string,
  curr: string,
  zone: string,
  settings: Settings,
): SpendRow[] {
  return list(body.data).map((r) => {
    const campaignId = identifier(r.campaign_id),
      campaignName = label(r.campaign_name),
      adSetName = label(r.adset_name),
      owner = ownerFor('meta', campaignId, settings);
    return {
      source: 'meta',
      impressions: r.impressions == null ? null : Number(microsDecimal(decimalMicros(String(r.impressions)))),
      linkClicks: r.inline_link_clicks == null ? (r.actions == null ? null : metaAction(r.actions, 'link_click')) : Number(microsDecimal(decimalMicros(String(r.inline_link_clicks)))),
      addsToCart: r.actions == null ? null : metaAction(r.actions, META_ADD_TO_CART),
      purchases: r.actions == null ? null : metaAction(r.actions, META_PURCHASE),
      purchaseValue: r.actions == null || r.action_values == null ? null : metaAction(r.action_values, META_PURCHASE) || metaAction(r.action_values, 'omni_purchase_values'),
      accountId: account,
      campaignId,
      campaignName,
      adSetId: identifier(r.adset_id),
      adSetName,
      day:
        zone === 'Europe/London'
          ? label(r.date_start)
          : hourDay(
              label(r.date_start),
              Number(
                /^([0-2]\d):/.exec(r.hourly_stats_aggregated_by_advertiser_time_zone ?? '')?.[1],
              ),
              zone,
            ),
      amount: microsDecimal(decimalMicros(r.spend)),
      currency: currency(curr),
      owner,
      market: spendMarket({ source: 'meta', campaignName, adSetName, owner }),
    };
  });
}
export function parseGoogle(
  body: any,
  account: string,
  curr: string,
  settings: Settings,
): SpendRow[] {
  return list(body)
    .flatMap((chunk) => list(chunk.results ?? []))
    .map((r) => {
      const micros = String(r.metrics?.costMicros ?? '0'),
        campaignId = identifier(r.campaign.id),
        campaignName = label(r.campaign.name),
        owner = ownerFor('google-ads', campaignId, settings);
      if (!/^\d+$/.test(micros)) throw new AdError('invalid');
      return {
        source: 'google-ads',
        accountId: account,
        campaignId,
        campaignName,
        adSetId: null,
        adSetName: null,
        day: hourDay(label(r.segments.date), r.segments.hour ?? 0),
        amount: microsDecimal(BigInt(micros)),
        currency: currency(curr),
        owner,
        market: spendMarket({ source: 'google-ads', campaignName, adSetName: null, owner }),
      };
    });
}
export function parseTikTok(
  body: any,
  account: string,
  curr: string,
  settings: Settings,
): SpendRow[] {
  return list(body.data?.list).map((r) => {
    const instant = label(r.dimensions.stat_time_hour),
      match = /^(20\d{2}-\d{2}-\d{2}) ([0-2]\d):00:00$/.exec(instant);
    if (!match) throw new AdError('invalid');
    const campaignId = identifier(r.dimensions.campaign_id),
      campaignName = label(r.metrics.campaign_name),
      owner = ownerFor('tiktok', campaignId, settings);
    return {
      source: 'tiktok',
      accountId: account,
      campaignId,
      campaignName,
      adSetId: null,
      adSetName: null,
      day: hourDay(match[1]!, Number(match[2])),
      amount: microsDecimal(decimalMicros(r.metrics.spend)),
      currency: currency(curr),
      owner,
      market: spendMarket({ source: 'tiktok', campaignName, adSetName: null, owner }),
    };
  });
}
export class MetaSpend implements SpendReader {
  private readonly http: AdTransport;
  constructor(
    private readonly token: string,
    private readonly options: AdTransportOptions = {},
  ) {
    this.http = new AdTransport('meta', { ...options, log: options.log ? (entry) => {
      if (entry.timeoutMs !== undefined) options.log!(entry);
      else options.log!({ ...entry, requestId: entry.requestId?.includes(token) ? null : entry.requestId });
    } : undefined });
  }
  async readGraph(path: string, params: Record<string, string> = {}, timeoutMs = 10_000, resumeRateLimit = false) {
    const url = new URL(`https://graph.facebook.com/${apiVersions.meta}/${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    for (;;) {
      try {
        return await this.http.request(url.toString(), { method: 'GET', headers: { Authorization: `Bearer ${this.token}` } }, timeoutMs);
      } catch (error) {
        if (!resumeRateLimit || !(error instanceof AdError) || error.providerCode !== 80004) throw error;
        // This wait is outside the transport queue, so spend and daily insights can interleave.
        console.info('Meta creative catalogue rate limited; waiting before resuming this read.');
        await (this.options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms))))(Math.max(15 * 60_000, error.retryAfterMs ?? 0));
      }
    }
  }
  /** A source URL may expire, but must never send the bearer credential to a browser. */
  safeMediaUrl(value: unknown): string {
    try {
      if (typeof value !== 'string' || [value, decodeURIComponent(value)].some(candidate => candidate.includes(this.token))) throw new AdError('invalid');
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password || [...url.searchParams.keys()].some(key => /access_token|authorization/i.test(key))) throw new AdError('invalid');
      return url.toString();
    } catch { throw new AdError('invalid'); }
  }
  /** Shared cursor paging; never follows a provider-supplied URL carrying credentials. */
  async *readPages(path: string, params: Record<string, string> = {}, timeoutMs = 10_000,
    options: { fallbackLimit?: number; resumeRateLimit?: boolean } = {}): AsyncGenerator<any[]> {
    const cursors = new Set<string>();
    let limit = params.limit;
    let after: string | undefined;
    do {
      const query = { ...params, ...(limit ? { limit } : {}), ...(after ? { after } : {}) };
      let body: any;
      const readPage = () => this.readGraph(path, query, timeoutMs, options.resumeRateLimit);
      try {
        body = await readPage();
      } catch (error) {
        const fallback = options.fallbackLimit;
        if (!(error instanceof AdError) || !(error.code === 'timeout' || error.status >= 500 && error.status <= 599)
          || !fallback || !Number.isSafeInteger(fallback) || fallback < 1 || (limit !== undefined && Number(limit) <= fallback)) throw error;
        // Retry this cursor once at a smaller page size, then retain it for the rest of the list.
        limit = String(fallback);
        query.limit=limit;
        body = await readPage();
      }
      const rows = list(body.data);
      const next = body.paging?.next ? label(body.paging?.cursors?.after) : undefined;
      if (next && cursors.has(next)) throw new AdError('invalid');
      if (next) cursors.add(next);
      yield rows;
      after = next;
    } while (after);
  }
  async readAllPages(path: string, params: Record<string, string> = {}, timeoutMs = 10_000, resumeRateLimit = false): Promise<any[]> {
    const rows: any[] = [];
    for await (const page of this.readPages(path, params, timeoutMs, { resumeRateLimit })) rows.push(...page);
    return rows;
  }
  readAdSets(account: string, settings: Settings): Promise<AdSet[]> {
    return fetchAdSets(this, account, settings);
  }
  async readCampaigns(account: string): Promise<MetaCampaign[]> {
    const rows: MetaCampaign[] = [], cursors = new Set<string>();
    let skipped = 0;
    let after: string | undefined;
    do {
      const body = await this.readGraph(`act_${account}/campaigns`, {
        fields: 'id,name,effective_status,created_time',
        // The v25 AdAccount campaigns edge accepts Campaign.EffectiveStatus values.
        effective_status: JSON.stringify(['ACTIVE', 'PAUSED']),
        limit: '100',
        ...(after ? { after } : {}),
      });
      for (const row of list(body.data)) {
        try {
          if (!row || typeof row !== 'object') throw new AdError('invalid');
          const status = label(row.effective_status);
          if (!campaignStatuses.has(status)) throw new AdError('invalid');
          if (typeof row.name !== 'string' || row.name.length > 300) throw new AdError('invalid');
          rows.push({
            id: identifier(row.id), name: row.name.trim(), status,
            createdAt: campaignCreatedAt(row.created_time),
          });
        } catch {
          skipped++;
        }
      }
      after = body.paging?.next ? label(body.paging?.cursors?.after) : undefined;
      if (after && cursors.has(after)) throw new AdError('invalid');
      if (after) cursors.add(after);
    } while (after);
    if (skipped) console.info(`Meta campaigns skipped ${skipped} invalid rows.`);
    return rows;
  }
  async read(account: string, from: string, to: string, settings: Settings): Promise<SpendRow[]> {
    const metadata = await this.readGraph(`act_${account}`, { fields: 'currency,timezone_name' }),
      zone = label(metadata.timezone_name),
      curr = currency(metadata.currency);
    const rows: SpendRow[] = [];
    let after: string | undefined;
    do {
      const body = await this.readGraph(`act_${account}/insights`, {
        fields: 'spend,campaign_id,campaign_name,adset_id,adset_name,date_start,impressions,inline_link_clicks,actions,action_values',
        level: 'adset',
        time_increment: '1',
        time_range: JSON.stringify({
          since: zone === 'Europe/London' ? from : addDays(from, -1),
          until: zone === 'Europe/London' ? to : addDays(to, 1),
        }),
        limit: '500',
        ...(zone === 'Europe/London'
          ? {}
          : { breakdowns: 'hourly_stats_aggregated_by_advertiser_time_zone' }),
        ...(after ? { after } : {}),
      });
      rows.push(...parseMeta(body, account, curr, zone, settings));
      const next = body.paging?.next;
      const cursor = body.paging?.cursors?.after;
      if (next && (!cursor || cursor === after)) throw new AdError('invalid');
      after = next ? label(cursor) : undefined;
    } while (after);
    return aggregateHours(rows, from, to);
  }
}
export class GoogleSpend implements SpendReader {
  private readonly http: AdTransport;
  private accessToken: string | undefined;
  private expires = 0;
  private operations = 0;
  private operationsDay = '';
  private metadata?: {
    account: string;
    currency: string;
    at: number;
  };
  constructor(
    private readonly env: NodeJS.ProcessEnv,
    private readonly options: AdTransportOptions = {},
  ) {
    this.http = new AdTransport('google-ads', options);
  }
  private async token(): Promise<string> {
    const now = this.options.now?.() ?? Date.now();
    if (this.accessToken && now < this.expires) return this.accessToken;
    const body = await this.http.request('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: this.env.GOOGLE_ADS_CLIENT_ID!,
        client_secret: this.env.GOOGLE_ADS_CLIENT_SECRET!,
        refresh_token: this.env.GOOGLE_ADS_REFRESH_TOKEN!,
      }).toString(),
    });
    this.accessToken = label(body.access_token);
    this.expires = now + Math.max(0, Number(body.expires_in) - 60) * 1000;
    return this.accessToken;
  }
  private async query(
    account: string,
    settings: Settings,
    query: string,
    retry = true,
  ): Promise<any[]> {
    const day = new Date(this.options.now?.() ?? Date.now()).toISOString().slice(0, 10);
    if (day !== this.operationsDay) {
      this.operationsDay = day;
      this.operations = 0;
    }
    if (++this.operations > 200) throw new AdError('rate_limit');
    try {
      const body = await this.http.request(
        `https://googleads.googleapis.com/${apiVersions.google}/customers/${account}/googleAds:searchStream`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${await this.token()}`,
            'content-type': 'application/json',
            ...(settings.googleLoginCustomerId
              ? { 'login-customer-id': settings.googleLoginCustomerId }
              : {}),
          },
          body: JSON.stringify({ query }),
        },
      );
      return list(body).flatMap((chunk) => list(chunk.results ?? []));
    } catch (error) {
      if (error instanceof AdError && error.status === 401 && retry) {
        this.accessToken = undefined;
        return this.query(account, settings, query, false);
      }
      throw error;
    }
  }
  async read(account: string, from: string, to: string, settings: Settings): Promise<SpendRow[]> {
    const now = this.options.now?.() ?? Date.now();
    if (!this.metadata || this.metadata.account !== account || now - this.metadata.at > 86400000) {
      const info = await this.query(
        account,
        settings,
        'SELECT customer.currency_code FROM customer',
      );
      this.metadata = {
        account,
        currency: currency(info[0]?.customer?.currencyCode),
        at: now,
      };
    }
    const results = await this.query(
      account,
      settings,
      `SELECT campaign.id, campaign.name, segments.date, segments.hour, metrics.cost_micros FROM campaign WHERE segments.date BETWEEN '${addDays(from, -1)}' AND '${to}'`,
    );
    return aggregateHours(
      parseGoogle([{ results }], account, this.metadata.currency, settings),
      from,
      to,
    );
  }
}
export class TikTokSpend implements SpendReader {
  private readonly http: AdTransport;
  constructor(
    private readonly token: string,
    options: AdTransportOptions = {},
  ) {
    this.http = new AdTransport('tiktok', options);
  }
  private get(path: string, params: Record<string, string>) {
    const url = new URL(`https://business-api.tiktok.com/open_api/${apiVersions.tiktok}/${path}/`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return this.http.request(url.toString(), {
      method: 'GET',
      headers: { 'Access-Token': this.token },
    });
  }
  async read(account: string, from: string, to: string, settings: Settings): Promise<SpendRow[]> {
    const info = await this.get('advertiser/info', {
      advertiser_ids: JSON.stringify([account]),
      fields: JSON.stringify(['currency']),
    });
    const curr = currency(info.data?.list?.[0]?.currency),
      rows: SpendRow[] = [];
    let page = 1,
      total = 1;
    do {
      const body = await this.get('report/integrated/get', {
        advertiser_id: account,
        report_type: 'BASIC',
        data_level: 'AUCTION_CAMPAIGN',
        dimensions: JSON.stringify(['campaign_id', 'stat_time_hour']),
        metrics: JSON.stringify(['spend', 'campaign_name']),
        start_date: addDays(from, -1),
        end_date: to,
        page: String(page),
        page_size: '1000',
      });
      rows.push(...parseTikTok(body, account, curr, settings));
      total = Number(body.data?.page_info?.total_page ?? 1);
      if (!Number.isInteger(total) || total < 1 || total > 10000) throw new AdError('invalid');
      page++;
    } while (page <= total);
    return aggregateHours(rows, from, to);
  }
}
export function liveReader(
  source: AdSource,
  env: NodeJS.ProcessEnv,
  options: AdTransportOptions = {},
): SpendReader {
  return source === 'meta'
    ? new MetaSpend(env.META_ACCESS_TOKEN!, options)
    : source === 'google-ads'
      ? new GoogleSpend(env, options)
      : new TikTokSpend(env.TIKTOK_ACCESS_TOKEN!, options);
}
