import type {IssueReason, IssueTagRule} from './taxonomy.js';

/** Ordered, deterministic rules. The first matching reason wins; no model or source call. */
const rules: ReadonlyArray<{reason: IssueReason; patterns: readonly RegExp[]}> = [
  {reason: 'scratched slab', patterns: [/\b(?:scratch(?:ed|es|ing)?|scuff(?:ed|s)?)\b.{0,45}\bslabs?\b/iu,
    /\bslabs?\b.{0,45}\b(?:scratch(?:ed|es|ing)?|scuff(?:ed|s)?)\b/iu]},
  {reason: 'missing slab', patterns: [/\b(?:missing|without|no|short(?: of)?)\b.{0,35}\bslabs?\b/iu,
    /\bslabs?\b.{0,35}\b(?:missing|not included|left out)\b/iu]},
  {reason: 'wrong item', patterns: [/\b(?:wrong|incorrect|different)\b.{0,35}\b(?:item|kit|pack|slab|colour|color|size|product)s?\b/iu,
    /\bsent\b.{0,20}\binstead of\b/iu]},
  {reason: 'damaged box', patterns: [/\b(?:damaged|crushed|dented|bent|torn|broken)\b.{0,35}\b(?:box|carton|packaging)\b/iu,
    /\b(?:box|carton|packaging)\b.{0,35}\b(?:damaged|crushed|dented|bent|torn|broken)\b/iu]},
  {reason: 'lost parcel', patterns: [/\b(?:lost|missing)\b.{0,35}\b(?:parcel|package|shipment|delivery)\b/iu,
    /\b(?:parcel|package|shipment)\b.{0,35}\b(?:lost|missing|never arrived|not arrived|not delivered)\b/iu,
    /\b(?:(?:never|not|haven['’]t) (?:received|got)|didn['’]t (?:receive|get|got))\b.{0,35}\b(?:(?:parcel|package|order|shipment|kit|item)s?|deliver(?:y|ies))\b/iu,
    /\b(?:never arrived|never delivered|lost in transit)\b/iu]},
  {reason: 'late delivery', patterns: [/\b(?:late|delayed|overdue)\b.{0,35}\b(?:delivery|parcel|package|shipment|order)\b/iu,
    /\b(?:delivery|parcel|package|shipment|order)\b.{0,35}\b(?:late|delayed|overdue)\b/iu,
    /\barrived late\b/iu]},
  {reason: "QR won't register", patterns: [/\bqr\b.{0,50}\b(?:won['’]?t|wouldn['’]?t|cannot|can['’]?t|not|fail(?:ed|s)?|error|invalid)\b/iu,
    /\b(?:won['’]?t|cannot|can['’]?t|unable to|failed to)\b.{0,30}\b(?:register|scan|activate)\b.{0,30}\bqr\b/iu]},
  {reason: 'markers dried or faulty', patterns: [/\b(?:markers?|pens?)\b.{0,45}\b(?:dry|dried|faulty|broken|not working|won['’]?t work|don['’]?t work)\b/iu,
    /\b(?:dry|dried|faulty|broken)\b.{0,35}\b(?:markers?|pens?)\b/iu]},
  {reason: 'missing item', patterns: [/\b(?:missing|not included|left out|item short|parts? short)\b/iu,
    /\b(?:item|piece|part|pack)s?\b.{0,25}\b(?:absent|short)\b/iu]},
];

export function issueClassification(text: string, tags: readonly string[] = [], tagRules: readonly IssueTagRule[] = []): {reason: IssueReason; mapped: boolean} {
  const normalized = new Set(tags.map(tag => tag.trim().toLowerCase()));
  const mapped = tagRules.find(rule => normalized.has(rule.tag.trim().toLowerCase()));
  if (mapped) return {reason: mapped.reason, mapped: true};
  const plain = text.replace(/\s+/gu, ' ');
  return {reason: rules.find(rule => rule.patterns.some(pattern => pattern.test(plain)))?.reason ?? 'other', mapped: false};
}
export function classifyIssue(text: string, tags: readonly string[] = [], tagRules: readonly IssueTagRule[] = []): IssueReason {
  return issueClassification(text, tags, tagRules).reason;
}
