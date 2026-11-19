import {normalizeGorgiasIntent} from '../gorgias/privacy.js';
import {classifyIssue, issueClassification} from './keywords.js';
import type {IssueReason, IssueTagRule} from './taxonomy.js';

type IntentRule = IssueReason | 'quality' | 'exclude';
/** A star matches any valid second level in that first-level family, never a partial word. */
const intentRules: ReadonlyMap<string, IntentRule> = new Map([
  ['shipping::delivered not received', 'lost parcel'],
  ['order::status', 'late delivery'],
  ['shipping::delay', 'late delivery'],
  ['order::damaged', 'damaged box'],
  ['order::wrong item', 'wrong item'],
  ['order::missing item', 'missing item'],
  ['product::quality issues', 'quality'],
  ['order::refund', 'other'],
  ['order::payment', 'other'],
  ['promotion & discount::issue', 'other'],
  ['feedback::negative', 'other'],
  ['return::*', 'other'],
  ['exchange::*', 'other'],
  ['warranty::*', 'other'],
  ['product::availability', 'exclude'],
  ['product::details', 'exclude'],
  ['product::customization', 'exclude'],
  ['product::usage', 'exclude'],
  ['promotion & discount::information', 'exclude'],
  ['order::cancel', 'exclude'],
  ['order::edit', 'exclude'],
  ['order::placement', 'exclude'],
  ['shipping::information', 'exclude'],
  ['shipping::change address', 'exclude'],
  ['feedback::positive', 'exclude'],
  ['wholesale::*', 'exclude'],
  ['marketing::*', 'exclude'],
  ['account::*', 'exclude'],
  ['subscription::*', 'exclude'],
  ['other::*', 'exclude'],
]);

export interface IssueTicketClassification {reason: IssueReason; rank: 0 | 1 | 2}

/** Explicit tags outrank a recognized intent; unrecognized intents keep the subject-only keyword rule. */
export function classifyIssueTicket(subject: string, tags: readonly string[], aiIntent: string | null | undefined,
  tagRules: readonly IssueTagRule[]): IssueTicketClassification | null {
  const fallback = issueClassification(subject, tags, tagRules);
  if (fallback.mapped) return {reason: fallback.reason, rank: 2};
  const intent = normalizeGorgiasIntent(aiIntent)?.toLowerCase().replace(/ +/g, ' ');
  const rule = intent ? intentRules.get(intent) ?? intentRules.get(`${intent.split('::')[0]}::*`) : undefined;
  if (rule === 'exclude') return null;
  if (rule === 'quality') return {reason: classifyIssue([subject, ...tags].join(' ')), rank: 1};
  if (rule !== undefined) return {reason: rule, rank: 1};
  return {reason: fallback.reason, rank: 0};
}
