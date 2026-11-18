/** Retained with the Settings decoder when the Issues feature is reverted. */
export const ISSUE_REASONS = ['scratched slab', 'missing slab', 'missing item', 'wrong item', 'damaged box',
  'late delivery', 'lost parcel', "QR won't register", 'markers dried or faulty', 'other'] as const;
export type IssueReason = typeof ISSUE_REASONS[number];
export interface IssueTagRule {tag: string; reason: IssueReason}
export const ISSUE_TAG_LIMIT = 40;
export const ISSUE_TAG_TEXT_LIMIT = 80;
