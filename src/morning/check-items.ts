import {addDays} from '../hero-range.js';
import {HQ_ITEM_TEXT_LIMIT,type HQBriefItem} from '../github-hq/model.js';
import type {StoredAdSet} from '../meta-adsets/catalogue.js';
import {adSetName} from '../meta-adsets/name.js';
import {morningFacts,morningKey} from './model.js';
import type {MorningAction,MorningBrief,MorningButton,MorningCard,MorningInput} from './model-types.js';

const CHECK_RULE = 'Listed by the daily check. This app did not judge it.';
const AD_CARD_KINDS = new Set(['meta-kill','meta-slipping','meta-step']);
type CheckSet = Pick<StoredAdSet,'id'|'name'|'owner'|'status'|'effectiveStatus'|'currency'>;
interface CheckItem {
  item: HQBriefItem; index: number; lines: string[]; subjectId: string; factsHash: string;
}
export interface MorningCheckItems {
  candidates: MorningCard[];
  datedFromCheck: {text: string; lines?: string[]}[];
  eligible: boolean;
  totalItemCount: number;
  representedItemCount: number;
  standaloneKeys: string[];
}

function title(text: string): string {
  const points = Array.from(text);
  return points.length > 120 ? `${points.slice(0,119).join('')}…` : text;
}
const detail = ({item,lines}: CheckItem): string => [item.text,...lines].join('\n');
const evidence = (items: CheckItem[]): string => `From the morning check\n${items.map(detail).join('\n\n')}`;
const runTime = (brief: MorningBrief): string => /\b(?:[01]\d|2[0-3]):[0-5]\d\b/.exec(brief.runLabel ?? '')?.[0] ?? 'Run time unavailable';
const save = (label: string, action: MorningAction): MorningButton => ({kind: 'save',target: 'morning',label,action});
const week = (): MorningButton => ({kind: 'save',target: 'morning',label: 'Leave it, ask in a week',action: 'hold',days: 7});
const hide = (): MorningButton => save('Stop showing this','hide');
/** The card face asks the question: the item's own decision line wins over its first evidence line. */
const faceLine = (lines: readonly string[]): string | undefined => lines.find(line => /^decision\b[^:]{0,40}:/i.test(line)) ?? lines[0];
/** The check may head its dated list with the bare word, with or without a full stop or colon. */
const datedHeading = (text: string): boolean => /^dated[.:]?$/i.test(text.trim());

function namedSet(item: HQBriefItem): string | undefined {
  if (item.tag && 'adSetId' in item.tag) return /^\d{5,25}$/.test(item.tag.adSetId) ? item.tag.adSetId : undefined;
  const text = Array.from(item.text).slice(0,HQ_ITEM_TEXT_LIMIT).join(''), ids: string[] = [];
  const runEnd = (start: number): number => { let end = start; while (text[end] === '`') end++; return end; };
  for (let index = 0; index < text.length;) {
    if (text[index] !== '`') { index++; continue; }
    const openEnd = runEnd(index), width = openEnd - index;
    let slashes = 0;
    for (let before = index - 1; before >= 0 && text[before] === '\\'; before--) slashes++;
    if (slashes % 2) { index = openEnd; continue; }
    let next = openEnd;
    for (let cursor = openEnd; cursor < text.length;) {
      if (text[cursor] !== '`') { cursor++; continue; }
      const closeEnd = runEnd(cursor);
      if (closeEnd - cursor !== width) { cursor = closeEnd; continue; }
      const content = text.slice(openEnd,cursor);
      if (/^\d{5,25}$/.test(content)) ids.push(content);
      next = closeEnd; break;
    }
    // Skip the whole code span: shorter inner runs are literal content, never another ID.
    index = next;
  }
  return ids.length === 1 ? ids[0] : undefined;
}

function checkItem(item: HQBriefItem,index: number,day: string): CheckItem {
  const lines = item.lines ?? [];
  const tag = item.tag ? [item.tag.type,'adSetId' in item.tag ? item.tag.adSetId : null] : null;
  const state = item.tag?.type === 'pause' || item.tag?.type === 'hold' ? 'decide' : 'warn';
  // A later run label is not a new decision; any stored item-content change is.
  const factsHash = morningFacts('check-item',day,state,JSON.stringify([index,item.text,item.label ?? null,lines,tag]));
  return {item,index,lines,factsHash,subjectId: `${day}:${index}:${factsHash}`};
}

function pause(input: MorningInput,set: CheckSet | undefined): MorningButton | undefined {
  if (!set || input.mode !== 'live' || input.adSets?.mode !== 'live' || !input.adSets.actionsEnabled
    || !/^\d{5,24}$/.test(set.id) || set.owner !== 'ours' || set.status !== 'ACTIVE' || set.effectiveStatus !== 'ACTIVE'
    || set.currency !== 'GBP' || input.metaActions.some(action => action.adSetId === set.id && action.result === 'pending')) return undefined;
  return {kind: 'live',label: 'Pause',adSetId: set.id,action: 'pause',value: 'PAUSED',confirm: `Pause ${adSetName(set.name)} now?`};
}

function standalone(input: MorningInput,brief: MorningBrief,entry: CheckItem,set: CheckSet | undefined): MorningCard {
  const {item,index,lines,subjectId,factsHash} = entry, type = item.tag?.type;
  const live = pause(input,set), seen = save('Seen','ack');
  const open: MorningButton | undefined = set ? {kind: 'link',label: 'Open set',href: `/ads?set=${encodeURIComponent(set.id)}#${encodeURIComponent(set.id)}`} : undefined;
  let primary: MorningButton = seen, secondary: MorningButton | undefined = save('Not today','park');
  let menu: MorningButton[] = live ? [{...live,label: 'Pause it now'}] : [], allowedPresses: MorningAction[] = ['ack','park'];
  if (type === 'pause') {
    primary = live ?? open ?? seen; secondary = save('One more day','park');
    menu = ([3,7] as const).map(days => ({kind: 'save',target: 'morning',label: `Hold ${days} days`,action: 'hold',days}));
    allowedPresses = primary === seen ? ['ack','park','hold'] : ['park','hold'];
  } else if (type === 'hold') {
    primary = save('Hold, look tomorrow','park'); secondary = live ? {...live,label: 'Pause it now'} : undefined;
    menu = []; allowedPresses = ['park'];
  }
  const decide = type === 'pause' || type === 'hold', face = faceLine(lines);
  return {key: morningKey('check-item',subjectId),kind: 'check-item',subjectId,factsHash,sourceScope: 'check',
    state: decide ? 'decide' : 'warn',ruleId: `daily-check:${type ?? 'info'}`,tier: decide ? 1 : 5,order: index,
    title: title(item.text),lane: `Morning check${input.mode === 'sample' ? ' · sample data' : ''}`,source: 'github-hq',
    figure: {kind: 'plain',value: item.label || 'Morning check',label: runTime(brief)},
    ...(face ? {whyLine: face} : {}),why: detail(entry),rule: CHECK_RULE,
    sourceLine: `Daily check · ${brief.runLabel ?? 'stored entry'}${input.mode === 'sample' ? ' · sample data' : ''}`,
    ...(brief.href ? {sourceHref: brief.href} : {}),primary,secondary,menu,allowedPresses};
}

function freelancer(input: MorningInput,brief: MorningBrief,items: CheckItem[],existing?: MorningCard): MorningCard {
  const notes = evidence(items), name = input.settings.googleContactName.trim();
  const label = name ? `Message for ${name}` : 'Copy a message';
  const sample = input.mode === 'sample' ? 'Sample data — invented check items.\n\n' : '';
  const note = `${sample}Please review these items from the morning check:\n\n${notes}`;
  if (existing) return {...existing,state: 'decide',tier: 1,
    why: `${existing.why}\n\n${notes}`,
    primary: {kind: 'copy',label,text: existing.primary.kind === 'copy' ? `${existing.primary.text}\n\n${notes}` : note},
    secondary: week(),menu: [hide()],allowedPresses: ['hold','hide']};
  const subjectId = input.settings.googleCustomerId || 'google-account', rules = items.map(item => item.subjectId);
  return {key: morningKey('google',subjectId),kind: 'google',subjectId,sourceScope: 'check',
    factsHash: morningFacts('google',subjectId,'warn',rules),ruleId: rules.join('|'),state: 'decide',tier: 1,order: 20_000,
    title: title(items[0]!.item.text),lane: `The freelancer${input.mode === 'sample' ? ' · sample data' : ''}`,source: 'github-hq',
    figure: {kind: 'plain',value: 'Morning check',label: runTime(brief)},
    whyLine: faceLine(items[0]!.lines),why: notes,
    rule: `${CHECK_RULE} This app never changes the freelancer's ads. The only action is a message you send.`,
    sourceLine: `Daily check · ${brief.runLabel ?? 'stored entry'}${input.mode === 'sample' ? ' · sample data' : ''}`,
    ...(brief.href ? {sourceHref: brief.href} : {}),primary: {kind: 'copy',label,text: note},
    secondary: week(),menu: [hide()],allowedPresses: ['hold','hide']};
}

/** Fold against resolved ordinary cards before any optional grouping; all work is a pure projection. */
export function morningCheckItems(input: MorningInput,ordinaryCandidates: readonly MorningCard[],
  openOrdinaryKeys: ReadonlySet<string>,today: string): MorningCheckItems {
  const result: MorningCheckItems = {candidates: [...ordinaryCandidates],datedFromCheck: [],eligible: false,
    totalItemCount: 0,representedItemCount: 0,standaloneKeys: []};
  const brief = input.brief;
  if (!brief || brief.mode !== input.mode || brief.day !== addDays(today,-1) || !['ok','needs'].includes(brief.status)) return result;
  result.eligible = true;
  const items = (brief.items ?? []).map((item,index) => checkItem(item,index,brief.day!));
  result.totalItemCount = Math.max(brief.count ?? items.length,items.length);
  const sets = input.adSets?.mode === input.mode ? input.adSets.catalogue ?? input.adSets.rows.map(row => row.set) : [];
  const byId = new Map(sets.map(set => [set.id,set]));
  const folded = new Map<string,CheckItem[]>(), freelancerItems: CheckItem[] = [];
  for (const entry of items) {
    const {item} = entry, tag = item.tag?.type, label = item.label?.trim().toLowerCase();
    if (tag === 'dated' || !tag && (label === 'dated' || datedHeading(item.text))) {
      result.datedFromCheck.push({text: item.text,lines: [...entry.lines]}); continue;
    }
    result.representedItemCount++;
    if (tag === 'freelancer' || !tag && (label === 'google' || label === 'tiktok')) {
      freelancerItems.push(entry); continue;
    }
    const id = namedSet(item);
    const matching = id && ordinaryCandidates.find(card => AD_CARD_KINDS.has(card.kind) && card.subjectId === id && openOrdinaryKeys.has(card.key));
    if (matching) { folded.set(matching.key,[...(folded.get(matching.key) ?? []),entry]); continue; }
    const card = standalone(input,brief,entry,id ? byId.get(id) : undefined);
    result.candidates.push(card); result.standaloneKeys.push(card.key);
  }
  result.candidates = result.candidates.map(card => folded.has(card.key) ? {...card,why: `${card.why}\n\n${evidence(folded.get(card.key)!)}`} : card);
  if (freelancerItems.length) {
    const existing = result.candidates.findIndex(card => card.kind === 'google');
    const card = freelancer(input,brief,freelancerItems,existing < 0 ? undefined : result.candidates[existing]);
    if (existing < 0) result.candidates.push(card); else result.candidates[existing] = card;
  }
  return result;
}
