import {formatNumber} from '../money.js';
import type {SourceMode} from '../sources.js';
import type {GorgiasFacts} from './model.js';

/** The only Gorgias values in the Home snapshot: a count and its read state, never a ticket. */
export interface HandoverCount {
  mode: 'sample' | 'live';
  /** False when the source is failing or stale and the count is the last successful read. */
  current: boolean;
  /** Open tickets in the selected handover view or tag: the total, not the newly arrived ones. */
  open: number;
  checkedAt: string;
}

/** Home counts only a completed read. A keyless sample never sits beside live numbers. */
export function handoverCount(facts: GorgiasFacts, dashboardMode: SourceMode): HandoverCount | undefined {
  if (facts.mode === 'sample' && dashboardMode === 'live') return undefined;
  if (!facts.checkedAt) return undefined;
  return {mode: facts.mode, current: facts.status !== 'unavailable', checkedAt: facts.checkedAt,
    open: facts.tickets.filter(ticket => ticket.status === 'open' && ticket.inHandover).length};
}

export function handoverFlagState(count: HandoverCount): 'decide' | 'good' | 'warn' {
  return !count.current ? 'warn' : count.open ? 'decide' : 'good';
}
/** Icon and number stay visible at every width; the word may fold away beside a waiting review flag. */
export function handoverFlagParts(count: HandoverCount): {figure: string; word: string} {
  return {figure: `${({decide: '◆', good: '✓', warn: '△'})[handoverFlagState(count)]} ${formatNumber(count.open)}`,
    word: `${count.mode === 'sample' ? 'sample ' : ''}handover`};
}
export function handoverFlagName(count: HandoverCount): string {
  return `${formatNumber(count.open)} open handover ${count.open === 1 ? 'ticket' : 'tickets'}`
    + `${count.mode === 'sample' ? ', sample data' : ''}`
    + `${count.current ? '' : ', from the last successful read; the Gorgias read is unavailable'}`;
}

const escape = (text: string): string => text.replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]!);
/** One renderer for the server page and browser snapshot updates. Hidden until a read has completed. */
export function handoverFlagHtml(count: HandoverCount | undefined): string {
  if (!count) return '<a class="handover-flag" href="/handover" data-handover-flag hidden></a>';
  const parts = handoverFlagParts(count);
  return `<a class="handover-flag" href="/handover" data-handover-flag data-state="${handoverFlagState(count)}" data-mode="${count.mode}" aria-label="${escape(handoverFlagName(count))}"><span class="hf-figure">${escape(parts.figure)}</span><span class="hf-word"> ${escape(parts.word)}</span></a>`;
}
