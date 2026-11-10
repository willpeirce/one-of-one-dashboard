import type { DashboardNeed } from '../shopify/dashboard.js';
import type { GoogleFlagDetail } from '../google-ads/model.js';
import { morningFacts, morningKey } from './model.js';
import type { MorningCard, MorningFigure, MorningInput } from './model-types.js';

const priorities: Record<GoogleFlagDetail['kind'], number> = {
  under: 0, network: 0, nosale: 1, 'content-share': 2, bidding: 3, unexpected: 4, 'expected-list': 5,
};
function flagKind(need: DashboardNeed): GoogleFlagDetail['kind'] | undefined {
  if (need.googleFlag) return need.googleFlag.kind;
  return (Object.keys(priorities) as GoogleFlagDetail['kind'][]).find(kind => need.id === `google-${kind}` || need.id.startsWith(`google-${kind}:`));
}
/** Alarms remain independent, with their existing Seen-only action. */
export function morningGoogleNeeds(input: MorningInput): DashboardNeed[] {
  return input.needs.filter(need => need.source === 'google-ads' && need.state === 'warn'
    && !need.id.startsWith('stock:') && !need.id.startsWith('attach:'));
}
const flagText = (need: DashboardNeed): string => {
  const measure = need.googleFlag?.measure;
  return [need.title, need.why, ...(measure ? [`${measure.formattedValue} against ${measure.formattedBar} · ${measure.label}`]
    : need.figure ? [`${need.figure.value} · ${need.figure.label}`] : [])].join('\n');
};

/** A pure view of the same open Google needs Home already holds. */
export function addMorningGoogle(input: MorningInput): MorningInput {
  const flags = [...new Map(morningGoogleNeeds(input).map(need => [need.id, need])).values()]
    .sort((a, b) => (priorities[flagKind(a)!] ?? 6) - (priorities[flagKind(b)!] ?? 6));
  const extensions = (input.extensions ?? []).filter(card => card.kind !== 'google');
  const googleIds = new Set(input.needs.filter(need => need.source === 'google-ads').map(need => need.id));
  const excludes = (input.excludeNeedIds ?? []).filter(id => !googleIds.has(id));
  if (!flags.length) return extensions.length === (input.extensions?.length ?? 0) && excludes.length === (input.excludeNeedIds?.length ?? 0)
    ? input : { ...input, extensions, excludeNeedIds: excludes };
  const first = flags[0]!, ids = flags.map(need => need.id).sort(), subjectId = input.settings.googleCustomerId || 'google-account';
  const measure = first.googleFlag?.measure;
  const figure: MorningFigure = measure ? { kind: 'dial', ...measure }
    : { kind: 'plain', value: first.figure?.value ?? 'Review', label: first.figure?.label ?? 'Google checks' };
  const content = flags.find(need => flagKind(need) === 'content-share');
  const contentFlag = content && content.id !== first.id
    ? content.figure ? `Content share: ${content.figure.value} · ${content.figure.label}`
      : content.googleFlag?.measure ? `Content share: ${content.googleFlag.measure.formattedValue} · ${content.googleFlag.measure.label}`
        : content.title : undefined;
  const name = input.settings.googleContactName.trim(), sample = input.mode === 'sample';
  const note = `${sample ? 'Sample data — invented Google checks.\n\n' : ''}Please review these Google checks:\n\n${flags.map((flag, index) => `${index + 1}. ${flagText(flag)}`).join('\n\n')}`;
  const read = input.sourceReadAt?.google;
  const fallbackSource = `Google Ads · ${read ? `last read ${read}` : 'waiting for a successful read'}`;
  const card: MorningCard = {
    key: morningKey('google', subjectId), kind: 'google', subjectId, sourceScope: 'google',
    factsHash: morningFacts('google', subjectId, 'warn', ids), ruleId: ids.join('|'), state: 'warn', tier: 2, order: 20_000,
    title: first.title, lane: `Google${sample ? ' · sample data' : ''}`, source: 'google-ads', figure,
    ...(contentFlag ? { flag: contentFlag } : {}), whyLine: `${flags.length} Google ${flags.length === 1 ? 'check needs' : 'checks need'} review.`,
    why: flags.map(flagText).join('\n\n'),
    rule: flags.map(flag => `${flag.title}: ${flag.googleFlag?.rule ?? `Dashboard rule: ${flag.id}`}`).join('\n\n'),
    sourceLine: `${sample ? 'Sample data · invented example\n' : ''}${[...new Set(flags.map(flag => flag.googleFlag?.sourceLine ?? fallbackSource))].join('\n')}`,
    sourceHref: '/settings', primary: { kind: 'copy', label: name ? `Note for ${name}` : 'Copy a note', text: note },
    secondary: { kind: 'save', target: 'morning', label: 'Not today', action: 'park' },
    menu: [{ kind: 'save', target: 'morning', label: 'Stop showing this', action: 'hide' }], allowedPresses: ['park', 'hide'],
  };
  return { ...input, excludeNeedIds: [...new Set([...excludes, ...ids])], extensions: [...extensions, card] };
}
