import type {IssueReasonRow} from './model.js';

/** A new reason with no previous cases still needs at least three current cases. */
export const issueDoubled = (current: number, previous: number): boolean => current >= 3 && current >= previous * 2;

/** A joined review/ticket case still relies on the observed handover history. */
export function issueWatchState(row: IssueReasonRow,
  context: {thisMonth: string; ticketHistoryCoversLastMonth: boolean}): 'none' | 'watch' | 'history' {
  if (row.reason === 'other' || !issueDoubled(row.current, row.previous)) return 'none';
  return !context.ticketHistoryCoversLastMonth
    && row.cases.some(item => item.month === context.thisMonth && item.sources.includes('gorgias')) ? 'history' : 'watch';
}
