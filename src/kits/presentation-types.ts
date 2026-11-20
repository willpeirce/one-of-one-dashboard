import type {SourceMode} from '../sources.js';

export const KIT_STEPS = ['Choosing the theme', 'Being designed', 'Safety tests', 'Being made', 'Shipping to us', 'On sale', 'Sold out'] as const;
export type KitStatusKind = 'live' | 'flight' | 'planned' | 'proposed' | 'optional' | 'other';
export interface KitStatusView {kind: KitStatusKind; label: string}
export interface KitMoveView {yours: boolean; label: string; action: string; note: string | null}
export interface KitCardView {
  id: string; name: string; series: string; status: KitStatusView; gate: number;
  launch: string; distance: string; stepAside: string; move: KitMoveView | null;
}
export interface KitFoldedView {
  id: string; name: string; status: KitStatusView; gate: number; launchMonth: string; distance: string;
}
/** Only visible chapter fields; full text and order rows are fetched when its sheet opens. */
export interface HomeKits {
  mode: SourceMode; ready: boolean; summary: string | null; stale: boolean; notice: string | null;
  cards: KitCardView[]; folded: KitFoldedView[];
}
export interface KitSheetOrder {
  id: string; item: string; quantity: string | null; status: string; date: string | null; eta: string | null; supplier?: string;
}
export interface KitSheet {
  id: string; name: string; series: string; mode: SourceMode; launch: string; gate: number;
  move: KitMoveView | null; nextDate: string | null; milestone: string | null;
  waiting: {days: number | null; with: string} | null; note: string; orders: KitSheetOrder[]; ordersNotice: string | null;
}
