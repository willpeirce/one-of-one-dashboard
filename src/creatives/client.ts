import { MetaSpend } from '../ad-spend/clients.js';
import { AdError, hourDay } from '../ad-spend/model.js';
import { addDays } from '../hero-range.js';
import type { AdTransportOptions } from '../ad-spend/http.js';
import { spendMarket } from '../ad-spend/placement.js';
import type { Settings } from '../settings.js';
import type { AdInsight, CatalogueEntry, CatalogueMedia, CatalogueRead, CatalogueRefresh, CreativeReader, StoredCatalogueAd } from './model.js';

const CREATIVE_FIELDS = 'id,object_type,thumbnail_url,image_hash,image_url,video_id,object_story_spec,asset_feed_spec,effective_object_story_id,effective_instagram_media_id,body,title,call_to_action_type,link_url,url_tags,status';
const INSIGHT_FIELDS = 'ad_id,adset_id,date_start,spend,impressions,reach,frequency,inline_link_clicks,actions,action_values,video_continuous_2_sec_watched_actions,video_play_actions,video_thruplay_watched_actions,video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p100_watched_actions,video_avg_time_watched_actions';
const VIDEO_FIELDS = INSIGHT_FIELDS.split(',').filter(field => field.startsWith('video_'));
const ACCOUNT_DAY_FIELDS = ['ad_id', 'adset_id', 'date_start', 'reach', 'frequency', 'actions', ...VIDEO_FIELDS].join(',');
const HOURLY_FIELDS = INSIGHT_FIELDS.split(',').filter(field => !['reach', 'frequency'].includes(field) && !field.startsWith('video_')).join(',');
const ADDITIVE_FIELDS = ['spend', 'impressions', 'linkClicks', 'addsToCart', 'purchases', 'purchaseValue'] as const;
const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
const id = (value: unknown): string => {
  const valueString = String(value ?? '');
  if (!/^[\w-]{1,120}$/.test(valueString)) throw new AdError('invalid');
  return valueString;
};
const optionalId = (value: unknown): string | null => value == null || value === '' ? null : id(value);
const text = (value: unknown, max = 10_000): string => typeof value === 'string' ? value.slice(0, max) : '';
const numeric = (value: unknown): number => {
  if (value == null || value === '') return 0;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new AdError('invalid');
  return number;
};
const rows = (value: unknown): any[] => {
  if (!Array.isArray(value)) throw new AdError('invalid');
  return value;
};
const action = (value: unknown, name?: string): number => {
  if (value == null) return 0;
  const list = rows(value);
  return list.filter(row => !name || row.action_type === name).reduce((sum, row) => sum + numeric(row.value), 0);
};
const instant = (value: unknown, fallback: Date): string => {
  const date = value ? new Date(text(value)) : fallback;
  if (!Number.isFinite(date.getTime())) throw new AdError('invalid');
  return date.toISOString();
};
const mediaKind = (value: unknown): 'video' | 'image' => /video/i.test(text(value)) ? 'video' : 'image';

/** Resolve media before expanding a creative: the ads edge already supplies these fields. */
function creativeMedia(creative: any, attachment?: any) {
  const spec = creative.object_story_spec ?? {}, feed = creative.asset_feed_spec ?? {};
  const alternatives: { kind: 'video' | 'image'; key: string }[] = [
    ...(Array.isArray(feed.images) ? feed.images.flatMap((image: any) => image?.hash ? [{ kind: 'image' as const, key: id(image.hash) }] : []) : []),
    ...(Array.isArray(feed.videos) ? feed.videos.flatMap((video: any) => video?.video_id ? [{ kind: 'video' as const, key: id(video.video_id) }] : []) : []),
  ];
  const children = spec.link_data?.child_attachments;
  const videoId = optionalId(creative.video_id ?? spec.video_data?.video_id ?? children?.[0]?.video_id
    ?? (/video/i.test(attachment?.type ?? '') ? attachment?.target?.id : null));
  const imageHash = optionalId(creative.image_hash ?? spec.link_data?.image_hash ?? children?.[0]?.image_hash);
  const storyId = optionalId(creative.effective_object_story_id);
  const primary = alternatives[0] ?? (videoId ? { kind: 'video' as const, key: videoId }
    : imageHash ? { kind: 'image' as const, key: imageHash }
      : storyId && attachment ? { kind: mediaKind(attachment.type), key: `post:${storyId}` } : null);
  return { spec, feed, alternatives, children, primary };
}

function insightDay(value: unknown): string {
  const day = text(value);
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day))
    || new Date(day).toISOString().slice(0, 10) !== day) throw new AdError('invalid');
  return day;
}
function parseInsight(row: any, day: string): AdInsight {
  const direct = Array.isArray(row.actions) && row.actions.some((item: any) => item.action_type === 'video_view');
  const fallback = Array.isArray(row.video_continuous_2_sec_watched_actions) && row.video_continuous_2_sec_watched_actions.length > 0;
  return { adId: id(row.ad_id), adSetId: id(row.adset_id), day, spend: numeric(row.spend), impressions: numeric(row.impressions), reach: numeric(row.reach), frequency: numeric(row.frequency),
    linkClicks: row.inline_link_clicks == null ? action(row.actions, 'link_click') : numeric(row.inline_link_clicks),
    threeSecondPlays: direct ? action(row.actions, 'video_view') : action(row.video_continuous_2_sec_watched_actions), threeSecondSource: direct ? 'video_view' : fallback ? 'video_continuous_2_sec_watched_actions' : 'none',
    plays: action(row.video_play_actions), thruPlays: action(row.video_thruplay_watched_actions), plays25: action(row.video_p25_watched_actions), plays50: action(row.video_p50_watched_actions), plays75: action(row.video_p75_watched_actions), plays100: action(row.video_p100_watched_actions), averagePlayTime: action(row.video_avg_time_watched_actions),
    addsToCart: action(row.actions, 'omni_add_to_cart'), purchases: action(row.actions, 'omni_purchase'), purchaseValue: action(row.action_values, 'omni_purchase') || action(row.action_values, 'omni_purchase_values') };
}

/** Fixed Graph GET reads share the spend adapter's version, transport and safe diagnostics. */
export class MetaCreativeClient implements CreativeReader {
  private readonly fetcher: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly refused = new Set<string>();
  private readonly permalinks = new Map<string, Promise<any | null>>();
  private readonly accounts = new Map<string, string>();
  private readonly knownMedia = new Set<string>();
  private readonly storedAds = new Map<string, StoredCatalogueAd>();
  private readonly detailRetries = new Map<string, StoredCatalogueAd>();
  constructor(private readonly meta: MetaSpend, private readonly options: AdTransportOptions = {}) {
    this.fetcher = options.fetch ?? fetch;
    this.sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  }
  rememberStoredMedia(keys: string[]): void {
    this.knownMedia.clear();
    for (const key of keys) this.knownMedia.add(key);
  }
  rememberStoredAds(ads: StoredCatalogueAd[]): void {
    this.storedAds.clear();
    for (const ad of ads) this.storedAds.set(ad.id, ad);
  }
  rememberDetailRetries(ads: StoredCatalogueAd[]): void {
    this.detailRetries.clear();
    for (const ad of ads) this.detailRetries.set(ad.id, ad);
  }
  private async optional<T>(scope: string, read: () => Promise<T>): Promise<T | null> {
    try { return await read(); }
    catch {
      if (!this.refused.has(scope)) {
        this.refused.add(scope);
        console.info('Meta creative optional media or permalink read unavailable.');
      }
      return null;
    }
  }
  private async account(account: string): Promise<string> {
    const cached = this.accounts.get(account);
    if (cached) return cached;
    const facts = await this.meta.readGraph(`act_${id(account)}`, { fields: 'currency,timezone_name' });
    if (facts.currency !== 'GBP') throw new AdError('unsupported_account');
    const zone = text(facts.timezone_name, 100);
    if (!zone) throw new AdError('invalid');
    try { new Intl.DateTimeFormat('en-GB', { timeZone: zone }); }
    catch { throw new AdError('invalid'); }
    this.accounts.set(account, zone);
    return zone;
  }
  private mediaUrl(value: unknown): string {
    const result = this.meta.safeMediaUrl(value), url = new URL(result);
    if (!['fbcdn.net', 'fbsbx.com', 'cdninstagram.com', 'facebook.com'].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`)) || (url.port && url.port !== '443')) throw new AdError('invalid');
    return result;
  }
  private link(value: unknown): string | null {
    if (!value) return null;
    try {
      const result = this.meta.safeMediaUrl(value);
      if ([...new URL(result).searchParams.keys()].some(key => /token|secret|authorization/i.test(key))) return null;
      return result;
    } catch { return null; }
  }
  private async bytes(value: unknown, jpeg = true): Promise<Uint8Array> {
    const url = this.mediaUrl(value);
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const response = await this.fetcher(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10_000), headers: { Accept: jpeg ? 'image/jpeg' : 'image/*' } });
        if (!response.ok) throw new AdError(response.status === 429 ? 'rate_limit' : 'http', response.status);
        const mime = response.headers.get('content-type')?.split(';')[0]?.toLowerCase();
        if (jpeg ? mime !== 'image/jpeg' && mime !== 'image/jpg' : !['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(mime ?? '')) throw new AdError('invalid');
        if (numeric(response.headers.get('content-length')) > MAX_MEDIA_BYTES || !response.body) throw new AdError('invalid');
        const reader = response.body.getReader(), chunks: Uint8Array[] = [];
        let length = 0;
        try {
          while (true) {
            const { done, value: chunk } = await reader.read();
            if (done) break;
            length += chunk.byteLength;
            if (length > MAX_MEDIA_BYTES) throw new AdError('invalid');
            chunks.push(chunk);
          }
        } finally { await reader.cancel().catch(() => {}); }
        if (!length) throw new AdError('invalid');
        const output = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
        if (jpeg && (output[0] !== 0xff || output[1] !== 0xd8)) throw new AdError('invalid');
        return output;
      } catch (error) {
        const safe = error instanceof AdError ? error : new AdError('timeout');
        if (attempt === 3 || safe.code === 'invalid' || (safe.status >= 400 && safe.status < 500 && safe.status !== 429)) throw safe;
        await this.sleep(250 * 2 ** attempt);
      }
    }
    throw new AdError('http');
  }
  private creative(creativeId: string): Promise<any> {
    return this.meta.readGraph(id(creativeId), { fields: CREATIVE_FIELDS, thumbnail_width: '600', thumbnail_height: '600' });
  }
  private post(storyId: string): Promise<any> {
    return this.meta.readGraph(id(storyId), { fields: 'attachments{type,media,target,subattachments},permalink_url' });
  }
  private attachment(post: any): any {
    const first = post?.attachments?.data?.[0];
    return first?.subattachments?.data?.[0] ?? first;
  }
  private permalink(kind: 'post' | 'instagram', sourceId: string): Promise<any | null> {
    const key = `${kind}:${sourceId}`;
    if (!this.permalinks.has(key)) this.permalinks.set(key, this.optional(key, () => this.meta.readGraph(id(sourceId), { fields: kind === 'post' ? 'permalink_url' : 'permalink,media_type' })));
    return this.permalinks.get(key)!;
  }
  async *readCatalogue(account: string, settings: Settings, now: Date): AsyncIterable<CatalogueRead[]> {
    await this.account(account);
    const creativeCache = new Map<string, any>(), mediaCache = new Map<string, CatalogueMedia>(), postCache = new Map<string, any>();
    const reduced = new Set<string>(), expanded = new Set<string>();
    const retryResults = new Map<string, CatalogueMedia | null>();
    for await (const ads of this.meta.readPages(`act_${id(account)}/ads`, { fields: `id,name,status,effective_status,created_time,adset{id,name},campaign{id,name},creative{${CREATIVE_FIELDS}}`, limit: '25',
      effective_status: JSON.stringify(['ACTIVE', 'PAUSED', 'ARCHIVED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED', 'PENDING_REVIEW', 'DISAPPROVED', 'PREAPPROVED', 'PENDING_BILLING_INFO', 'IN_PROCESS', 'WITH_ISSUES']) }, 60_000, { fallbackLimit: 10 })) {
      const entries: CatalogueRead[] = [];
      for (const row of ads) {
        if (!row.creative?.id) continue;
        const adId = id(row.id), creativeId = id(row.creative.id), storedAd = this.storedAds.get(adId);
        const campaignId = id(row.campaign?.id ?? row.campaign_id), campaignName = text(row.campaign?.name, 300), adSetName = text(row.adset?.name, 300);
        const owner = settings.metaOwners.find(rule => rule.campaignId === campaignId)?.owner ?? 'unassigned';
        const listedAd: CatalogueRefresh['ad'] = { id: adId, name: text(row.name, 300), status: text(row.status, 50),
          effectiveStatus: text(row.effective_status, 50), lastSeen: now.toISOString(),
          adSetId: id(row.adset?.id ?? row.adset_id), adSetName, campaignId, campaignName, owner,
          market: spendMarket({ source: 'meta', campaignName, adSetName, owner }) };
        if (storedAd?.creativeId === creativeId && storedAd.mediaGroupId) {
          entries.push({ ad: listedAd, media: null });
          continue;
        }
        const retry = this.detailRetries.get(adId);
        const retryGroupId = retry?.creativeId === creativeId ? retry.mediaGroupId : undefined;
        if (retryGroupId && retryResults.get(retryGroupId) === null) {
          entries.push({ ad: listedAd, media: null, retryGroupId });
          continue;
        }
        if (retryGroupId && !retryResults.has(retryGroupId)) {
          try {
            const detail = await this.creative(creativeId);
            creativeCache.set(creativeId, { ...row.creative, ...detail, thumbnail_url: detail.thumbnail_url ?? row.creative.thumbnail_url });
            expanded.add(creativeId);
          } catch {
            retryResults.set(retryGroupId, null);
            entries.push({ ad: listedAd, media: null, retryGroupId });
            continue;
          }
        } else if (retryGroupId && !creativeCache.has(creativeId)) creativeCache.set(creativeId, row.creative);
        if (!creativeCache.has(creativeId)) {
          const storyId = optionalId(row.creative.effective_object_story_id);
          if (storyId && !postCache.has(storyId)) postCache.set(storyId, await this.optional(`post-media:${storyId}`, () => this.post(storyId)));
          const listed = creativeMedia(row.creative, this.attachment(storyId ? postCache.get(storyId) : null)).primary;
          const existingKey = listed ? `${listed.kind}:${listed.key}` : null;
          const known = existingKey && (this.knownMedia.has(existingKey) || mediaCache.has(existingKey))
            || ['image', 'video'].some(kind => this.knownMedia.has(`${kind}:creative:${creativeId}`)
              || storyId && (this.knownMedia.has(`${kind}:post:${storyId}`) || mediaCache.has(`${kind}:post:${storyId}`)));
          let creative = row.creative;
          if (!known) {
            try {
              // Expanding a new media key adds the 600px thumbnail. Other ads retain their own copy.
              const detail = await this.creative(creativeId);
              creative = { ...row.creative, ...detail, thumbnail_url: detail.thumbnail_url ?? row.creative.thumbnail_url };
              expanded.add(creativeId);
            } catch {
              reduced.add(creativeId);
            }
          }
          creativeCache.set(creativeId, creative);
        }
        const creative = creativeCache.get(creativeId);
        const storyId = optionalId(creative.effective_object_story_id), instagramId = optionalId(creative.effective_instagram_media_id);
        if (storyId && !postCache.has(storyId)) postCache.set(storyId, await this.optional(`post-media:${storyId}`, () => this.post(storyId)));
        const post = storyId ? postCache.get(storyId) : null, attachment = this.attachment(post);
        const instagram = instagramId ? await this.permalink('instagram', instagramId) : null;
        const { spec, feed, alternatives, children, primary: resolved } = creativeMedia(creative, attachment);
        const storedPostKind = storyId ? (['image', 'video'] as const).find(kind =>
          this.knownMedia.has(`${kind}:post:${storyId}`) || mediaCache.has(`${kind}:post:${storyId}`)) : null;
        const primary = resolved ?? (storedPostKind ? { kind: storedPostKind, key: `post:${storyId}` }
          : { kind: mediaKind(attachment?.type ?? instagram?.media_type ?? (/video/i.test(creative.object_type ?? '') ? 'video' : creative.thumbnail_url)), key: `creative:${creativeId}` });
        // A SHARE fallback can be a video picture without an accessible video id.
        const key = `${primary.kind}:${primary.key}`;
        let media = retryGroupId ? retryResults.get(retryGroupId) : mediaCache.get(key);
        if (!media) {
          const actualVideoId = primary.kind === 'video' && !primary.key.includes(':') ? primary.key : null;
          const metadata = actualVideoId ? await this.optional(`video-info:${actualVideoId}`, () => this.meta.readGraph(id(actualVideoId), { fields: 'title,length,format,picture' })) : null;
          const format = metadata?.format?.[0];
          const thumbnailUrl = creative.thumbnail_url ?? creative.image_url ?? attachment?.media?.image?.src ?? metadata?.picture;
          const stored = !retryGroupId && this.knownMedia.has(key);
          let thumbnail = !stored && thumbnailUrl ? await this.optional(`thumbnail:${key}`, () => this.bytes(thumbnailUrl)) : null;
          if (!stored && !thumbnail && primary.kind === 'image') thumbnail = await this.optional(`image:${key}`, () => this.imageBytes(account, primary.key));
          const frames = !stored && actualVideoId ? await this.optional(`frames:${key}`, () => this.videoFrames(actualVideoId)) ?? [] : [];
          media = { kind: primary.kind, key: primary.key, title: text(metadata?.title) || text(creative.title) || text(row.name, 300),
            lengthSeconds: metadata?.length == null ? null : numeric(metadata.length),
            width: format?.width == null ? attachment?.media?.image?.width ?? null : numeric(format.width),
            height: format?.height == null ? attachment?.media?.image?.height ?? null : numeric(format.height),
            firstSeen: now.toISOString(), detailReducedAt: reduced.has(creativeId) ? now.toISOString() : expanded.has(creativeId) ? null : undefined, thumbnail, poster: primary.kind === 'video' ? thumbnail : null, frames,
            alternates: alternatives.filter(item => item.kind !== primary.kind || item.key !== primary.key) };
          mediaCache.set(key, media);
        }
        if (retryGroupId && !media.thumbnail) {
          retryResults.set(retryGroupId, null);
          entries.push({ ad: listedAd, media: null, retryGroupId });
          continue;
        }
        const linkUrl = this.link(creative.link_url ?? spec.link_data?.link ?? spec.video_data?.call_to_action?.value?.link);
        const tags = new URLSearchParams(text(creative.url_tags));
        const facebook = post?.permalink_url ? post : storyId ? await this.permalink('post', storyId) : null;
        const ad: CatalogueEntry['ad'] = { ...listedAd, accountId: account, createdAt: instant(row.created_time, now), creativeId,
          creativeType: Array.isArray(children) && children.length > 1 ? 'carousel' : spec.template_data || /catalog|product/i.test(creative.object_type ?? '') ? 'catalogue' : primary.kind,
          body: text(creative.body ?? spec.link_data?.message ?? spec.video_data?.message ?? feed.bodies?.[0]?.text),
          title: text(creative.title ?? spec.link_data?.name ?? spec.video_data?.title ?? feed.titles?.[0]?.text),
          callToAction: text(creative.call_to_action_type ?? spec.link_data?.call_to_action?.type ?? spec.video_data?.call_to_action?.type ?? feed.call_to_action_types?.[0], 100),
          linkUrl, utmContent: tags.get('utm_content') ?? (linkUrl ? new URL(linkUrl).searchParams.get('utm_content') : null),
          facebookUrl: this.link(facebook?.permalink_url), instagramUrl: this.link(instagram?.permalink), objectStoryId: storyId, instagramMediaId: instagramId };
        if (retryGroupId) retryResults.set(retryGroupId, media);
        entries.push({ ad, media, ...(retryGroupId ? { retryGroupId } : {}) });
      }
      yield entries;
    }
  }
  async readInsights(account: string, from: string, to: string): Promise<AdInsight[]> {
    insightDay(from); insightDay(to);
    if (from > to) throw new AdError('invalid');
    const zone = await this.account(account), hourly = zone !== 'Europe/London';
    const path = `act_${id(account)}/insights`;
    const query = { level: 'ad', time_increment: '1', limit: '500' };
    const daily = (await this.meta.readAllPages(path, { ...query, fields: hourly ? ACCOUNT_DAY_FIELDS : INSIGHT_FIELDS,
      time_range: JSON.stringify({ since: from, until: to }) }, 60_000)).map(row => {
      const day = insightDay(row.date_start);
      if (day < from || day > to) throw new AdError('invalid');
      // Non-additive measurements retain their account-day date, even when UK days differ.
      if (!hourly) return parseInsight(row, day);
      // Video fields are unavailable with hourly breakdowns. Keep the daily
      // plays and their matching hold denominator instead of silently storing zero.
      const parsed = parseInsight(Object.fromEntries(ACCOUNT_DAY_FIELDS.split(',').map(field => [field, row[field]])), day);
      return { ...parsed, holdThreeSecondPlays: parsed.threeSecondPlays, threeSecondPlays: 0,
        addsToCart: 0, purchases: 0, purchaseValue: 0, linkClicks: 0 };
    });
    if (!hourly) return daily;
    const keyFor = (row: AdInsight) => JSON.stringify([row.adId, row.day]);
    const grouped = new Map(daily.map(row => [keyFor(row), row]));
    const hooks = new Map<string, { direct: number; fallback: number; hasDirect: boolean; hasFallback: boolean }>();
    const since = addDays(from, -1), until = addDays(to, 1);
    const hours = await this.meta.readAllPages(path, { ...query, fields: HOURLY_FIELDS,
      time_range: JSON.stringify({ since, until }), breakdowns: 'hourly_stats_aggregated_by_advertiser_time_zone' }, 60_000);
    for (const row of hours) {
      const accountDay = insightDay(row.date_start);
      if (accountDay < since || accountDay > until) throw new AdError('invalid');
      const hour = Number(/^([0-2]\d):/.exec(row.hourly_stats_aggregated_by_advertiser_time_zone ?? '')?.[1]);
      const day = hourDay(accountDay, hour, zone);
      if (day < from || day > to) continue;
      const parsed = parseInsight(Object.fromEntries(HOURLY_FIELDS.split(',').map(field => [field, row[field]])), day);
      const key = keyFor(parsed), current = grouped.get(key);
      const hook = hooks.get(key) ?? { direct: 0, fallback: 0, hasDirect: false, hasFallback: false };
      if (parsed.threeSecondSource === 'video_view') { hook.direct += parsed.threeSecondPlays; hook.hasDirect = true; }
      else if (parsed.threeSecondSource === 'video_continuous_2_sec_watched_actions') { hook.fallback += parsed.threeSecondPlays; hook.hasFallback = true; }
      hooks.set(key, hook);
      if (!current) { grouped.set(key, { ...parsed, holdThreeSecondPlays: 0 }); continue; }
      if (current.adSetId !== parsed.adSetId) throw new AdError('invalid');
      for (const field of ADDITIVE_FIELDS) current[field] += parsed[field];
    }
    for (const [key, hook] of hooks) {
      const row = grouped.get(key)!;
      // Meta can omit a zero video_view action from an hour. Select the measure
      // for the whole ad/day, so such an hour cannot mix two-second and three-second counts.
      row.threeSecondPlays = hook.hasDirect ? hook.direct : hook.fallback;
      row.threeSecondSource = hook.hasDirect ? 'video_view' : hook.hasFallback ? 'video_continuous_2_sec_watched_actions' : 'none';
    }
    return [...grouped.values()];
  }
  async readFrequency(account: string, adIds: string[], from: string, to: string): Promise<number | null> {
    const validDay = (value: string) => /^20\d{2}-\d{2}-\d{2}$/.test(value)
      && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
    if (!validDay(from) || !validDay(to) || from > to) throw new AdError('invalid');
    const ids = [...new Set(adIds.map(id))].sort();
    if (!ids.length) return null; // An empty filter must never become the whole account.
    await this.account(account);
    const result = await this.meta.readAllPages(`act_${id(account)}/insights`, {
      fields: 'impressions,reach,frequency', level: 'account',
      time_range: JSON.stringify({ since: from, until: to }),
      filtering: JSON.stringify([{ field: 'ad.id', operator: 'IN', value: ids }]),
    }, 60_000);
    if (!result.length) return null;
    if (result.length !== 1 || !['number', 'string'].includes(typeof result[0]?.frequency) || result[0].frequency === '') throw new AdError('invalid');
    return numeric(result[0].frequency);
  }
  async videoSource(videoId: string): Promise<string> {
    if (videoId.includes(':')) throw new AdError('unauthorized');
    const primary = await this.optional(`video-source:${videoId}`, () => this.meta.readGraph(id(videoId), { fields: 'source' }));
    if (primary?.source) return this.mediaUrl(primary.source);
    const fallback = await this.meta.readGraph(id(videoId), { fields: 'download_hd_url' });
    return this.mediaUrl(fallback.download_hd_url);
  }
  async imageBytes(account: string, key: string, full = false): Promise<Uint8Array> {
    let url: unknown;
    if (key.startsWith('post:')) {
      const attachment = this.attachment(await this.post(id(key.slice(5))));
      url = attachment?.media?.image?.src;
    } else if (key.startsWith('creative:')) {
      const creative = await this.creative(id(key.slice(9)));
      url = full ? creative.image_url ?? creative.thumbnail_url : creative.thumbnail_url ?? creative.image_url;
    } else {
      const images = await this.meta.readAllPages(`act_${id(account)}/adimages`, { hashes: JSON.stringify([id(key)]), fields: 'hash,url,width,height', limit: '100' });
      url = images.find(image => image.hash === key)?.url;
    }
    return this.bytes(url);
  }
  async videoFrames(videoId: string): Promise<Uint8Array[]> {
    if (videoId.includes(':')) return [];
    const thumbnails = await this.meta.readAllPages(`${id(videoId)}/thumbnails`, { fields: 'uri,is_preferred,width,height', limit: '10' });
    const output: Uint8Array[] = [];
    for (const thumbnail of thumbnails.slice(0, 10)) output.push(await this.bytes(thumbnail.uri, false));
    return output;
  }
}
