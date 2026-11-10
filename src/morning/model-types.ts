import type { Settings } from '../settings.js';
import type { SourceMode } from '../sources.js';
import type { DashboardNeed } from '../shopify/dashboard.js';
import type { Check } from '../shopify/watchdogs.js';
import type { AdSetsView } from '../meta-adsets/presentation.js';
import type { MetaActivity } from '../meta-adsets/activity.js';
import type { MetaAction } from '../meta-adsets/actions.js';
import type { VerdictWord } from '../meta-adsets/rules.js';
import type { CreativeCard } from '../creatives/presentation-types.js';
import type { TickerPassed, TickerSnapshot } from '../ticker/model.js';

export type MorningAction = 'park' | 'remind' | 'hold' | 'hide' | 'ack' | 'call';
export type MorningAnswer = 'hold' | 'a' | 'b' | 'draw';
export type MorningTone = 'alarm' | 'decide' | 'warn' | 'info' | 'done';
export type MorningKind = 'need' | 'meta-kill' | 'meta-slipping' | 'meta-step' | 'meta-watch'
  | 'date' | 'fading' | 'make-next' | 'google' | 'test-call' | 'new-verdict' | 'done-for-you';

interface ButtonLabel { label: string; subline?: string }
export interface MorningLiveButton extends ButtonLabel {
  kind: 'live'; adSetId: string; action: 'pause' | 'budget' | 'undo'; value?: number | string; confirm: string;
}
export type MorningButton = MorningLiveButton
  | (ButtonLabel & { kind: 'link'; href: string })
  | (ButtonLabel & { kind: 'copy'; text: string })
  | (ButtonLabel & { kind: 'save'; target: 'morning'; action: MorningAction; answer?: 'a' | 'b' | 'draw'; confirm?: string })
  | (ButtonLabel & { kind: 'save'; target: 'ticker'; eventKey: string; action: 'next' | 'restore' });

export interface MorningBriefVariant {
  bullets: { text: string; strength: 1 | 2 | 3 }[];
  text: string;
  footer: string;
}
export type MorningFigure = { kind: 'plain'; value: string; label: string }
  | { kind: 'dial'; value: number; bar: number; label: string; formattedValue: string; formattedBar: string }
  | { kind: 'rail'; value: number; label: string; range?: number }
  | { kind: 'thumb'; src: string; alt: string; value: string; label: string }
  | { kind: 'brief'; variants: Record<'1' | '3' | '7', MorningBriefVariant> }
  | { kind: 'arms'; arms: { label: string; value: number; formatted: string; count: number }[]; sure: number | null; eligible: boolean };

/** Stored read scopes distinguish a successful empty read from a failed or waiting source. */
export interface MorningCard {
  key: string; kind: MorningKind; subjectId: string; sourceScope: string; factsHash: string; ruleId: string;
  state: MorningTone; tier: number; order: number; title: string; lane: string; source: string;
  figure: MorningFigure; flag?: string; whyLine?: string; why: string; rule: string; sourceLine: string; sourceHref?: string;
  primary: MorningButton; secondary?: MorningButton; menu: MorningButton[]; allowedPresses: MorningAction[];
  eventDate?: string; eventKey?: string; seenUntilDay?: string; callAnswer?: 'a' | 'b' | 'draw';
}
export interface MorningState {
  mode: SourceMode; cardKey: string; state: 'parked' | 'hidden' | 'seen' | 'answered';
  untilDay: string | null; factsHash: string; answer: MorningAnswer | null; credentialId: string;
  pressedAt: string; clearedAt: string | null; title: string; kind: MorningKind; subjectId: string; sourceScope: string;
}
export interface MorningAway { stateRow: MorningState; title: string; reason: string; untilDay: string | null }
export interface MorningFine { id: string; label: string }
export interface MorningMetaAction extends MetaAction { title: string; undo: MorningLiveButton | null }
/** Later parts supply this slim-line presentation without adding a deck card. */
export interface MorningBrief {
  text: string; status: 'ok' | 'needs' | 'unreadable' | 'missing' | 'key'; mode: SourceMode;
  day?: string; runLabel?: string; count?: number; items?: { text: string; label?: string }[];
  firstLines?: string[]; href?: string;
}
export interface MorningInput {
  mode: SourceMode; needs: DashboardNeed[]; checks: Check[]; adSets?: AdSetsView;
  creativeCards: CreativeCard[]; creativeFigures?: Record<string, MorningFigure>;
  ticker: TickerSnapshot; settings: Settings; activity: MetaActivity[]; metaActions: MetaAction[];
  sourceReadOk: Record<string, boolean>; sourceReadAt?: Record<string, string | null>;
  extensions?: MorningCard[]; excludeNeedIds?: string[];
  liveTestIds?: string[]; brief?: MorningBrief | null;
}
export interface MorningSnapshot {
  mode: SourceMode; day: string; cards: MorningCard[]; more: number; fine: MorningFine[];
  parked: MorningAway[]; hidden: MorningAway[]; presses: MorningState[];
  metaActions: MorningMetaAction[]; passedDates: TickerPassed[]; answers: MorningState[];
  brief: MorningBrief | null; completed: number; total: number;
}
export interface MorningResult {
  snapshot: MorningSnapshot;
  candidates: MorningCard[];
  /** Every unsuppressed card, including cards beyond the daily cap, for the summary. */
  openCards: MorningCard[];
  clearKeys: string[];
  deleteKeys: string[];
}
/** Only the Home Decisions renderer consumes these identities; source views remain complete. */
export interface MorningHomeOmissions {
  needs: string[];
  adSets: { id: string; verdict: VerdictWord }[];
  creatives: string[];
}
