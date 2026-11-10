export const HQ_REGISTER_PARSER_VERSION = 3;
export const HQ_ITEM_LIMIT = 12;
export const HQ_ITEM_TEXT_LIMIT = 300;
export const HQ_CELL_LIMIT = 600;
export const HQ_SECTION_ROW_LIMIT = 40;
export const HQ_TRUNCATED_STATUS_MARKER = ' [Status truncated]';

export interface HQBriefItem { text: string; label?: string }
export interface HQBriefEntry {
  day: string;
  runLabel: string;
  status: 'ok' | 'needs' | 'unreadable';
  count: number;
  items: HQBriefItem[];
  firstLines: string[];
}
export interface HQStoredBriefEntry extends HQBriefEntry {
  ref: 'main' | 'claude/ads-daily';
  path: string;
  readAt: string;
}
export type HQTestSection = 'live' | 'queue' | 'history';
export interface HQTestRow { id: string; section: HQTestSection; cells: string[] }
export interface HQStoredTestRow extends HQTestRow {
  firstSeenAt: string;
  sectionFirstSeenAt: string;
  initiallySeen: boolean;
}
export interface HQFacts {
  sourceMode: 'sample' | 'live';
  report: HQStoredBriefEntry | null;
  tests: HQStoredTestRow[];
  registerReadAt: string | null;
  registerReadOk: boolean;
  registerSkippedRows: number;
  registerCappedRows?: number;
  registerHeadingsComplete?: boolean;
  monthReadAt: string | null;
}
export interface HQRegisterResult { readable: boolean; rows: HQTestRow[]; skippedRows: number; cappedRows?: number; complete?: boolean; skippedCells?: string[] }
export interface HQReadingArm {
  key: 'a' | 'b'; value: number; formatted: string; count: number; unit: '' | '£' | '%';
}
export interface HQReading {
  day: string;
  arms: [HQReadingArm,HQReadingArm];
  ahead: 'a' | 'b' | null;
  sure: number;
  mornings: number;
}
export interface HQTestAssessment {
  reading: HQReading | null;
  startedDay: string | null;
  daysRun: number | null;
  answer: 'a' | 'b' | 'draw' | null;
  reasons: string[];
  verdictUntilDay: string | null;
}

/** Bounded display text only; JSONB cannot store U+0000. */
export function hqCut(value: string, limit: number): string {
  return Array.from(value.replaceAll('\0','\uFFFD')).slice(0,limit).join('');
}
export function hqDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return false;
  const at = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(at) && new Date(at).toISOString().slice(0,10) === value;
}
