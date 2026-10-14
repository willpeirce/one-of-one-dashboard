import type { SourceMode } from '../sources.js';
import type { CreativeAd } from './model.js';
import type { aggregateCreativeGroups, topCreatives, CreativeWindow, CreativeFilter } from './ranking.js';
import type { creativePerformance } from './performance.js';
import type { AttributeDefinition, ResolvedAttribute } from './attributes.js';
import type { TaggingQueueEntry } from './tagging.js';
import type { CreativeScanView } from './scan-view.js';

export type GroupPerformance = ReturnType<typeof aggregateCreativeGroups>[number];
export type CreativeSelection = CreativeFilter & { window?: Exclude<CreativeWindow, 'lifetime'>; attribute?: string; value?: string };
export interface CreativeCard {
  id: string; kind: 'watch' | 'decide'; groupId: string; picture: string;
  title: string; reason: string; mode: SourceMode; brief?: string;
}
export interface LiftExample {
  kind: 'video' | 'image'; label: string; confidence: string;
  withCppGbp: number; withoutCppGbp: number; withGroupCount: number; withoutGroupCount: number;
  withSpendGbp: number; withoutSpendGbp: number; brief: string;
}
export interface CreativeView {
  mode: SourceMode; accountId: string; selection: CreativeSelection;
  top: ReturnType<typeof topCreatives>; performance: ReturnType<typeof creativePerformance>;
  groups: GroupPerformance[]; cards: CreativeCard[]; lifts: LiftExample[];
  scan: CreativeScanView; taggingQueue: TaggingQueueEntry[]; attributeFilters: AttributeDefinition[];
  targets: { uk: number; us: number }; freelancerInitial: string;
  merged: { id: string; title: string; parentId: string }[];
}
export interface CreativeSheet {
  mode: SourceMode; group: GroupPerformance; scan: CreativeScanView;
  windows: { window: CreativeWindow; totals: GroupPerformance['totals'] }[];
  comparison: { from: string; to: string; purchases: number; shopifyOrders: number | null; shopifyMode: SourceMode };
  frequency: { value: number | null; eligible: boolean };
  links: { label: string; url: string }[];
  ads: CreativeAd[]; attributes: ResolvedAttribute[]; note: string; brief?: string;
}
