import { addDays } from '../hero-range.js';
import type { Settings } from '../settings.js';
import { AdTransport, type AdTransportOptions } from './http.js';
import {
  AdError,
  aggregateHours,
  decimalMicros,
  microsDecimal,
  hourDay,
  marketFor,
  ownerFor,
  type SpendRow,
  type AdSource,
} from './model.js';
export interface SpendReader {
  read(account: string, from: string, to: string, settings: Settings): Promise<SpendRow[]>;
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
export function parseMeta(
  body: any,
  account: string,
  curr: string,
  zone: string,
  settings: Settings,
  targets: Record<string, string[]> = {},
): SpendRow[] {
  return list(body.data).map((r) => ({
    source: 'meta',
    accountId: account,
    campaignId: identifier(r.campaign_id),
    campaignName: label(r.campaign_name),
    adSetId: identifier(r.adset_id),
    adSetName: label(r.adset_name),
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
    owner: ownerFor('meta', r.campaign_id, settings),
    market: marketFor([r.campaign_name, r.adset_name], targets[r.adset_id]),
  }));
}
export function parseGoogle(
  body: any,
  account: string,
  curr: string,
  settings: Settings,
  targets: Record<string, string[]> = {},
): SpendRow[] {
  return list(body)
    .flatMap((chunk) => list(chunk.results ?? []))
    .map((r) => {
      const micros = String(r.metrics?.costMicros ?? '0');
      if (!/^\d+$/.test(micros)) throw new AdError('invalid');
      return {
        source: 'google-ads',
        accountId: account,
        campaignId: identifier(r.campaign.id),
        campaignName: label(r.campaign.name),
        adSetId: null,
        adSetName: null,
        day: hourDay(label(r.segments.date), r.segments.hour ?? 0),
        amount: microsDecimal(BigInt(micros)),
        currency: currency(curr),
        owner: ownerFor('google-ads', r.campaign.id, settings),
        market: marketFor([r.campaign.name], targets[r.campaign.id]),
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
    return {
      source: 'tiktok',
      accountId: account,
      campaignId: identifier(r.dimensions.campaign_id),
      campaignName: label(r.metrics.campaign_name),
      adSetId: null,
      adSetName: null,
      day: hourDay(match[1]!, Number(match[2])),
      amount: microsDecimal(decimalMicros(r.metrics.spend)),
      currency: currency(curr),
      owner: ownerFor('tiktok', r.dimensions.campaign_id, settings),
      market: marketFor([r.metrics.campaign_name]),
    };
  });
}
export class MetaSpend implements SpendReader {
  private readonly http: AdTransport;
  constructor(
    private readonly token: string,
    options: AdTransportOptions = {},
  ) {
    this.http = new AdTransport('meta', options);
  }
  private get(path: string, params: Record<string, string> = {}) {
    const url = new URL(`https://graph.facebook.com/${apiVersions.meta}/${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return this.http.request(url.toString(), {
      method: 'GET',
      headers: { Authorization: `Bearer ${this.token}` },
    });
  }
  async read(account: string, from: string, to: string, settings: Settings): Promise<SpendRow[]> {
    const metadata = await this.get(`act_${account}`, { fields: 'currency,timezone_name' }),
      zone = label(metadata.timezone_name),
      curr = currency(metadata.currency);
    const targets: Record<string, string[]> = {};
    const rows: SpendRow[] = [];
    let after: string | undefined;
    do {
      const body = await this.get(`act_${account}/insights`, {
        fields: 'spend,campaign_id,campaign_name,adset_id,adset_name,date_start',
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
      for (const r of list(body.data))
        if (marketFor([r.campaign_name, r.adset_name]) === 'unknown' && !targets[r.adset_id]) {
          const adset = await this.get(identifier(r.adset_id), { fields: 'targeting' });
          targets[r.adset_id] = list(adset.targeting?.geo_locations?.countries ?? []);
        }
      rows.push(...parseMeta(body, account, curr, zone, settings, targets));
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
    targets: Record<string, string[]>;
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
      const locations = await this.query(
        account,
        settings,
        "SELECT campaign.id, campaign_criterion.location.geo_target_constant FROM campaign_criterion WHERE campaign_criterion.type = 'LOCATION' AND campaign_criterion.negative = FALSE",
      );
      const ids = [
        ...new Set(
          locations.map((r) =>
            String(r.campaignCriterion.location.geoTargetConstant).split('/').at(-1),
          ),
        ),
      ];
      if (ids.some((id) => !/^\d+$/.test(id!))) throw new AdError('invalid');
      const geo = ids.length
        ? await this.query(
            account,
            settings,
            `SELECT geo_target_constant.id, geo_target_constant.country_code FROM geo_target_constant WHERE geo_target_constant.id IN (${ids.join(',')})`,
          )
        : [];
      const byId = new Map(
          geo.map((r) => [String(r.geoTargetConstant.id), r.geoTargetConstant.countryCode]),
        ),
        targets: Record<string, string[]> = {};
      for (const r of locations) {
        const id = identifier(r.campaign.id),
          country = byId.get(
            String(r.campaignCriterion.location.geoTargetConstant).split('/').at(-1)!,
          );
        (targets[id] ??= []).push(country ?? 'unknown');
      }
      this.metadata = {
        account,
        currency: currency(info[0]?.customer?.currencyCode),
        targets,
        at: now,
      };
    }
    const results = await this.query(
      account,
      settings,
      `SELECT campaign.id, campaign.name, segments.date, segments.hour, metrics.cost_micros FROM campaign WHERE segments.date BETWEEN '${addDays(from, -1)}' AND '${to}'`,
    );
    return aggregateHours(
      parseGoogle([{ results }], account, this.metadata.currency, settings, this.metadata.targets),
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
