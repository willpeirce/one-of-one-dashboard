import type {IssuesView, IssueCase} from './model.js';
import type {IssueReason} from './taxonomy.js';

export interface IssueCasesPage {
  reason: IssueReason; mode: IssuesView['mode']; status: IssuesView['status'];
  thisMonth: string; lastMonth: string; current: number; previous: number;
  cases: IssueCase[]; total: number; nextOffset: number | null; version: string; notes: string[];
}
