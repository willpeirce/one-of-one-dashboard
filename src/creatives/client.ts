import { MetaSpend } from '../ad-spend/clients.js';
import { AdError } from '../ad-spend/model.js';
import type { AdTransportOptions } from '../ad-spend/http.js';
import { spendMarket } from '../ad-spend/placement.js';
import type { Settings } from '../settings.js';
import type { AdInsight, CatalogueEntry, CatalogueMedia, CreativeReader } from './model.js';

const CREATIVE_FIELDS = 'id,object_type,thumbnail_url,image_hash,image_url,video_id,object_story_spec,asset_feed_spec,effective_object_story_id,effective_instagram_media_id,body,title,call_to_action_type,link_url,url_tags,status';
const INSIGHT_FIELDS = 'ad_id,adset_id,date_start,spend,impressions,reach,frequency,inline_link_clicks,actions,action_values,video_continuous_2_sec_watched_actions,video_play_actions,video_thruplay_watched_actions,video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p100_watched_actions,video_avg_time_watched_actions';
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

/** Fixed Graph GET reads share the spend adapter's version, transport and safe diagnostics. */
export class MetaCreativeClient implements CreativeReader {
  private readonly fetcher: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly refused = new Set<string>();
  private readonly permalinks = new Map<string, Promise<any | null>>();
  private readonly accounts = new Set<string>();
  private readonly knownMedia = new Set<string>();
  constructor(private readonly meta: MetaSpend, private readonly options: AdTransportOptions = {}) {
    this.fetcher = options.fetch ?? fetch;
    this.sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  }
  rememberStoredMedia(keys: string[]): void { for (const key of keys) this.knownMedia.add(key); }
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
  private async account(account: string): Promise<void> {
    if (this.accounts.has(account)) return;
    const facts = await this.meta.readGraph(`act_${id(account)}`, { fields: 'currency,timezone_name' });
    // Summing hourly reach would silently manufacture frequency and ROAS currency.
    if (facts.currency !== 'GBP' || facts.timezone_name !== 'Europe/London') throw new AdError('unsupported_account');
    this.accounts.add(account);
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
  async readCatalogue(account: string, settings: Settings, now: Date): Promise<CatalogueEntry[]> {
    await this.account(account);
    const ads = await this.meta.readPages(`act_${id(account)}/ads`, { fields: `id,name,status,effective_status,created_time,adset{id,name},campaign{id,name},creative{${CREATIVE_FIELDS}}`, limit: '100',
      effective_status: JSON.stringify(['ACTIVE', 'PAUSED', 'DELETED', 'ARCHIVED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED', 'PENDING_REVIEW', 'DISAPPROVED', 'PREAPPROVED', 'PENDING_BILLING_INFO', 'IN_PROCESS', 'WITH_ISSUES']) });
    const creativeCache = new Map<string, any>(), mediaCache = new Map<string, CatalogueMedia>(), postCache = new Map<string, any>();
    const entries: CatalogueEntry[] = [];
    for (const row of ads) {
      const creativeId = id(row.creative?.id);
      if (!creativeCache.has(creativeId)) {
        // The ads edge's default thumbnail is 64px; fetch this creative explicitly at 600.
        const expanded = await this.creative(creativeId);
        creativeCache.set(creativeId, { ...row.creative, ...expanded, thumbnail_url: expanded.thumbnail_url });
      }
      const creative = creativeCache.get(creativeId);
      const storyId = optionalId(creative.effective_object_story_id), instagramId = optionalId(creative.effective_instagram_media_id);
      if (storyId && !postCache.has(storyId)) postCache.set(storyId, await this.optional(`post-media:${storyId}`, () => this.post(storyId)));
      const post = storyId ? postCache.get(storyId) : null, attachment = this.attachment(post);
      const instagram = instagramId ? await this.permalink('instagram', instagramId) : null;
      const spec = creative.object_story_spec ?? {}, feed = creative.asset_feed_spec ?? {};
      const alternatives: { kind: 'video' | 'image'; key: string }[] = [
        ...(Array.isArray(feed.images) ? feed.images.flatMap((image: any) => image.hash ? [{ kind: 'image' as const, key: id(image.hash) }] : []) : []),
        ...(Array.isArray(feed.videos) ? feed.videos.flatMap((video: any) => video.video_id ? [{ kind: 'video' as const, key: id(video.video_id) }] : []) : []),
      ];
      const children = spec.link_data?.child_attachments;
      const videoId = optionalId(creative.video_id ?? spec.video_data?.video_id ?? (Array.isArray(children) ? children[0]?.video_id : null) ?? (/video/i.test(attachment?.type ?? '') ? attachment?.target?.id : null));
      const imageHash = optionalId(creative.image_hash ?? spec.link_data?.image_hash ?? (Array.isArray(children) ? children[0]?.image_hash : null));
      const primary = alternatives[0] ?? (videoId ? { kind: 'video' as const, key: videoId } : imageHash ? { kind: 'image' as const, key: imageHash }
        : { kind: mediaKind(attachment?.type ?? instagram?.media_type ?? (/video/i.test(creative.object_type ?? '') ? 'video' : creative.thumbnail_url)), key: storyId && attachment ? `post:${storyId}` : `creative:${creativeId}` });
      // A SHARE fallback can be a video picture without an accessible video id.
      const key = `${primary.kind}:${primary.key}`;
      let media = mediaCache.get(key);
      if (!media) {
        const actualVideoId = primary.kind === 'video' && !primary.key.includes(':') ? primary.key : null;
        const metadata = actualVideoId ? await this.optional(`video-info:${actualVideoId}`, () => this.meta.readGraph(id(actualVideoId), { fields: 'title,length,format,picture' })) : null;
        const format = metadata?.format?.[0];
        const thumbnailUrl = creative.thumbnail_url ?? creative.image_url ?? attachment?.media?.image?.src ?? metadata?.picture;
        const stored = this.knownMedia.has(key);
        let thumbnail = !stored && thumbnailUrl ? await this.optional(`thumbnail:${key}`, () => this.bytes(thumbnailUrl)) : null;
        if (!stored && !thumbnail && primary.kind === 'image') thumbnail = await this.optional(`image:${key}`, () => this.imageBytes(account, primary.key));
        const frames = !stored && actualVideoId ? await this.optional(`frames:${key}`, () => this.videoFrames(actualVideoId)) ?? [] : [];
        media = { kind: primary.kind, key: primary.key, title: text(metadata?.title) || text(creative.title) || text(row.name, 300),
          lengthSeconds: metadata?.length == null ? null : numeric(metadata.length),
          width: format?.width == null ? attachment?.media?.image?.width ?? null : numeric(format.width),
          height: format?.height == null ? attachment?.media?.image?.height ?? null : numeric(format.height),
          firstSeen: now.toISOString(), thumbnail, poster: primary.kind === 'video' ? thumbnail : null, frames,
          alternates: alternatives.filter(item => item.kind !== primary.kind || item.key !== primary.key) };
        mediaCache.set(key, media);
      }
      const campaignId = id(row.campaign?.id ?? row.campaign_id), campaignName = text(row.campaign?.name, 300), adSetName = text(row.adset?.name, 300);
      const owner = settings.metaOwners.find(rule => rule.campaignId === campaignId)?.owner ?? 'unassigned';
      const linkUrl = this.link(creative.link_url ?? spec.link_data?.link ?? spec.video_data?.call_to_action?.value?.link);
      const tags = new URLSearchParams(text(creative.url_tags));
      const facebook = post?.permalink_url ? post : storyId ? await this.permalink('post', storyId) : null;
      const ad: CatalogueEntry['ad'] = { id: id(row.id), accountId: account, name: text(row.name, 300), status: text(row.status, 50), effectiveStatus: text(row.effective_status, 50),
        createdAt: instant(row.created_time, now), adSetId: id(row.adset?.id ?? row.adset_id), adSetName, campaignId, campaignName, owner,
        market: spendMarket({ source: 'meta', campaignName, adSetName, owner }), creativeId,
        creativeType: Array.isArray(children) && children.length > 1 ? 'carousel' : spec.template_data || /catalog|product/i.test(creative.object_type ?? '') ? 'catalogue' : primary.kind,
        body: text(creative.body ?? spec.link_data?.message ?? spec.video_data?.message ?? feed.bodies?.[0]?.text),
        title: text(creative.title ?? spec.link_data?.name ?? spec.video_data?.title ?? feed.titles?.[0]?.text),
        callToAction: text(creative.call_to_action_type ?? spec.link_data?.call_to_action?.type ?? spec.video_data?.call_to_action?.type ?? feed.call_to_action_types?.[0], 100),
        linkUrl, utmContent: tags.get('utm_content') ?? (linkUrl ? new URL(linkUrl).searchParams.get('utm_content') : null), lastSeen: now.toISOString(),
        facebookUrl: this.link(facebook?.permalink_url), instagramUrl: this.link(instagram?.permalink), objectStoryId: storyId, instagramMediaId: instagramId };
      entries.push({ ad, media });
    }
    return entries;
  }
  async readInsights(account: string, from: string, to: string): Promise<AdInsight[]> {
    await this.account(account);
    return (await this.meta.readPages(`act_${id(account)}/insights`, { fields: INSIGHT_FIELDS, level: 'ad', time_increment: '1', time_range: JSON.stringify({ since: from, until: to }), limit: '500' })).map(row => {
      const direct = Array.isArray(row.actions) && row.actions.some((item: any) => item.action_type === 'video_view');
      const fallback = Array.isArray(row.video_continuous_2_sec_watched_actions) && row.video_continuous_2_sec_watched_actions.length > 0;
      const day = text(row.date_start);
      if (!/^20\d{2}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) || day < from || day > to) throw new AdError('invalid');
      return { adId: id(row.ad_id), adSetId: id(row.adset_id), day, spend: numeric(row.spend), impressions: numeric(row.impressions), reach: numeric(row.reach), frequency: numeric(row.frequency),
        linkClicks: row.inline_link_clicks == null ? action(row.actions, 'link_click') : numeric(row.inline_link_clicks),
        threeSecondPlays: direct ? action(row.actions, 'video_view') : action(row.video_continuous_2_sec_watched_actions), threeSecondSource: direct ? 'video_view' : fallback ? 'video_continuous_2_sec_watched_actions' : 'none',
        plays: action(row.video_play_actions), thruPlays: action(row.video_thruplay_watched_actions), plays25: action(row.video_p25_watched_actions), plays50: action(row.video_p50_watched_actions), plays75: action(row.video_p75_watched_actions), plays100: action(row.video_p100_watched_actions), averagePlayTime: action(row.video_avg_time_watched_actions),
        addsToCart: action(row.actions, 'omni_add_to_cart'), purchases: action(row.actions, 'omni_purchase'), purchaseValue: action(row.action_values, 'omni_purchase') || action(row.action_values, 'omni_purchase_values') };
    });
  }
  async readFrequency(account: string, adIds: string[], from: string, to: string): Promise<number | null> {
    const validDay = (value: string) => /^20\d{2}-\d{2}-\d{2}$/.test(value)
      && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
    if (!validDay(from) || !validDay(to) || from > to) throw new AdError('invalid');
    const ids = [...new Set(adIds.map(id))].sort();
    if (!ids.length) return null; // An empty filter must never become the whole account.
    await this.account(account);
    const result = await this.meta.readPages(`act_${id(account)}/insights`, {
      fields: 'impressions,reach,frequency', level: 'account',
      time_range: JSON.stringify({ since: from, until: to }),
      filtering: JSON.stringify([{ field: 'ad.id', operator: 'IN', value: ids }]),
    });
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
      const images = await this.meta.readPages(`act_${id(account)}/adimages`, { hashes: JSON.stringify([id(key)]), fields: 'hash,url,width,height', limit: '100' });
      url = images.find(image => image.hash === key)?.url;
    }
    return this.bytes(url);
  }
  async videoFrames(videoId: string): Promise<Uint8Array[]> {
    if (videoId.includes(':')) return [];
    const thumbnails = await this.meta.readPages(`${id(videoId)}/thumbnails`, { fields: 'uri,is_preferred,width,height', limit: '10' });
    const output: Uint8Array[] = [];
    for (const thumbnail of thumbnails.slice(0, 10)) output.push(await this.bytes(thumbnail.uri, false));
    return output;
  }
}
