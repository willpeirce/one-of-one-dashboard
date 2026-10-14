import type { SourceMode } from '../sources.js';

export type CreativeOwner = 'ours' | 'freelancer' | 'unassigned';
export type CreativeMarket = 'uk' | 'us' | 'unknown';
export interface CreativeAd {
  id: string; accountId: string; name: string; status: string; effectiveStatus: string;
  createdAt: string; adSetId: string; adSetName: string; campaignId: string; campaignName: string;
  owner: CreativeOwner; market: CreativeMarket; creativeId: string;
  creativeType: 'video' | 'image' | 'carousel' | 'catalogue' | 'other';
  mediaGroupId: string; body: string; title: string; callToAction: string; linkUrl: string | null;
  utmContent: string | null; firstSpendDay: string | null; lastSeen: string;
  facebookUrl: string | null; instagramUrl: string | null;
  objectStoryId: string | null; instagramMediaId: string | null;
}
export interface MediaGroup {
  id: string; kind: 'image' | 'video'; key: string; title: string; lengthSeconds: number | null;
  width: number | null; height: number | null; firstSeen: string; mergedIntoId: string | null;
  alternates: { kind: 'image' | 'video'; key: string }[];
  thumbnailUrl: string; // App route (or an invented sample SVG), never a Meta credential.
}
export interface AdInsight {
  adId: string; adSetId: string; day: string; spend: number; impressions: number; reach: number;
  frequency: number; linkClicks: number; threeSecondPlays: number;
  threeSecondSource: 'video_view' | 'video_continuous_2_sec_watched_actions' | 'none';
  plays: number; thruPlays: number; plays25: number; plays50: number; plays75: number; plays100: number;
  averagePlayTime: number; addsToCart: number; purchases: number; purchaseValue: number;
}
export interface CreativeFrequencyRead { adIds: string[]; from: string; to: string; frequency: number | null }
export interface CreativeData {
  mode: SourceMode; ads: CreativeAd[]; groups: MediaGroup[]; insights: AdInsight[];
  frequencyReads?: CreativeFrequencyRead[];
}
export interface CatalogueMedia extends Omit<MediaGroup, 'id' | 'mergedIntoId' | 'thumbnailUrl'> {
  id?: string;
  thumbnail: Uint8Array | null; poster: Uint8Array | null; frames: Uint8Array[];
}
export interface CatalogueEntry { ad: Omit<CreativeAd, 'mediaGroupId' | 'firstSpendDay'>; media: CatalogueMedia }
export type StoredCatalogueAd = Pick<CreativeAd, 'id' | 'creativeId' | 'mediaGroupId'>;
/** A list-only refresh preserves the stored creative fields and media group. */
export interface CatalogueRefresh {
  ad: Pick<CreativeAd, 'id' | 'name' | 'status' | 'effectiveStatus' | 'lastSeen'
    | 'adSetId' | 'adSetName' | 'campaignId' | 'campaignName' | 'owner' | 'market'>;
  media: null;
}
export type CatalogueRead = CatalogueEntry | CatalogueRefresh;
export interface CreativeReader {
  rememberStoredMedia?(keys: string[]): void;
  rememberStoredAds?(ads: StoredCatalogueAd[]): void;
  readCatalogue(account: string, settings: import('../settings.js').Settings, now: Date): AsyncIterable<CatalogueRead[]>;
  readInsights(account: string, from: string, to: string): Promise<AdInsight[]>;
  readFrequency?(account: string, adIds: string[], from: string, to: string): Promise<number | null>;
  videoSource(videoId: string): Promise<string>;
  imageBytes(account: string, key: string, full?: boolean): Promise<Uint8Array>;
  videoFrames(videoId: string): Promise<Uint8Array[]>;
}
export function canonicalVideoTitle(title: string): string {
  return title.replace(/^(?:Auto_Cropped_(?:AR_)?[\d_Xx]+_(?:DCO_)?)+/i, '').trim().toLowerCase();
}
