import type { DashboardNeed } from '../shopify/dashboard.js';
import type { GoogleFlagDetail } from '../google-ads/model.js';
import {adSetName} from '../meta-adsets/name.js';
import {formatNumber,formatPounds} from '../money.js';
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
  return input.needs.filter(need => need.source === 'google-ads' && need.state === 'warn' && !!need.googleFlag
    && !need.id.startsWith('stock:') && !need.id.startsWith('attach:'));
}
const flagText = (need: DashboardNeed): string => {
  const measure = need.googleFlag?.measure;
  return [need.title, need.why, ...(measure ? [`${measure.formattedValue} against ${measure.formattedBar} · ${measure.label}`]
    : need.figure ? [`${need.figure.value} · ${need.figure.label}`] : [])].join('\n');
};

interface FreelancerLine {
  id: string; title: string; text: string; figure: MorningFigure; rule: string; sourceLine: string;
}

function metaLines(input: MorningInput): FreelancerLine[] {
  const view = input.adSets;
  if (!view || view.mode !== input.mode) return [];
  const bar = input.settings.adRules.freelancerTriggerGbp, floor = input.settings.adRules.killFloorGbp;
  return view.rows.filter(row => row.set.owner === 'freelancer' && row.set.currency === 'GBP'
    && row.spend > 0 && row.spend >= floor && row.purchases !== null
    && (row.purchases === 0 || row.cpp !== null && row.cpp > bar))
    .sort((a, b) => a.purchases === 0 ? b.purchases === 0 ? 0 : -1 : b.purchases === 0 ? 1 : b.cpp! - a.cpp!)
    .map(row => {
      const name = adSetName(row.set.name), noPurchases = row.purchases === 0;
      const title = noPurchases ? `${name} has no purchases` : `${name} is over the purchase-cost bar`;
      const measure = noPurchases ? 'no purchases' : `${formatPounds(row.cpp!)} a purchase`;
      const text = `Meta · ${title}\n${formatPounds(row.spend)} on ${formatNumber(row.purchases!)} purchases over the last seven full UK days; ${measure} against the ${formatPounds(bar)} trigger.`;
      return {id: `meta:${row.set.id}:purchase-cost`, title, text,
        figure: noPurchases ? {kind: 'plain', value: 'No purchases', label: `${formatPounds(row.spend)} Meta spend · 7 days`}
          : {kind: 'dial', value: row.cpp!, bar, label: 'Meta purchase cost · 7 days',
            formattedValue: formatPounds(row.cpp!), formattedBar: formatPounds(bar)},
        rule: `The freelancer's Meta purchase cost over ${formatPounds(bar)}, or known zero purchases, on at least ${formatPounds(floor)} of seven-day spend. Unknown purchase data is not zero.`,
        sourceLine: `Meta Ads · ${view.mode === 'sample' ? 'sample data · ' : ''}stored seven-day figures${view.lastRead ? ` · last read ${view.lastRead}` : ''}`,
      } satisfies FreelancerLine;
    });
}

/** One message decision from the same stored Google needs and freelancer Meta figures. */
export function addMorningGoogle(input: MorningInput): MorningInput {
  const flags = [...new Map(morningGoogleNeeds(input).map(need => [need.id, need])).values()]
    .sort((a, b) => (priorities[flagKind(a)!] ?? 6) - (priorities[flagKind(b)!] ?? 6));
  const extensions = (input.extensions ?? []).filter(card => card.kind !== 'google');
  const googleIds = new Set(input.needs.filter(need => need.source === 'google-ads').map(need => need.id));
  const excludes = (input.excludeNeedIds ?? []).filter(id => !googleIds.has(id));
  const read = input.sourceReadAt?.google;
  const fallbackSource = `Google Ads · ${read ? `last read ${read}` : 'waiting for a successful read'}`;
  const meta = metaLines(input);
  const lines: FreelancerLine[] = [...flags.map(flag => ({id: flag.id, title: flag.title, text: flagText(flag),
    figure: flag.googleFlag?.measure ? {kind: 'dial' as const, ...flag.googleFlag.measure}
      : {kind: 'plain' as const, value: flag.figure?.value ?? 'Review', label: flag.figure?.label ?? 'Google checks'},
    rule: `${flag.title}: ${flag.googleFlag?.rule ?? `Dashboard rule: ${flag.id}`}`,
    sourceLine: flag.googleFlag?.sourceLine ?? fallbackSource,
  })), ...meta];
  if (!lines.length) return extensions.length === (input.extensions?.length ?? 0) && excludes.length === (input.excludeNeedIds?.length ?? 0)
    ? input : { ...input, extensions, excludeNeedIds: excludes };
  const first = lines[0]!, ids = lines.map(line => line.id).sort(), subjectId = input.settings.googleCustomerId || 'google-account';
  const name = input.settings.googleContactName.trim(), sample = input.mode === 'sample';
  const channels = flags.length && meta.length ? 'Google checks and Meta ad sets' : flags.length ? 'Google checks' : 'Meta ad sets';
  const note = `${sample ? `Sample data — invented ${channels}.\n\n` : ''}Please review these ${channels}:\n\n${lines.map((line, index) => `${index + 1}. ${line.text}`).join('\n\n')}`;
  const card: MorningCard = {
    key: morningKey('google', subjectId), kind: 'google', subjectId, sourceScope: 'google',
    // Keep the old Watch identity for the same Google rules; only new loss lines change it.
    factsHash: morningFacts('google', subjectId, 'warn', ids), ruleId: ids.join('|'), state: 'decide', tier: 1, order: 20_000,
    title: first.title, lane: `The freelancer${sample ? ' · sample data' : ''}`, source: flags.length ? 'google-ads' : 'meta', figure: first.figure,
    ...(lines[1] ? {flag: `Also: ${lines[1].title}`} : {}), whyLine: `${lines.length} ${lines.length === 1 ? 'check needs' : 'checks need'} a message to the freelancer.`,
    why: lines.map(line => line.text).join('\n\n'),
    rule: `This app never changes the freelancer's ads. The only action is a message you send.\n\n${lines.map(line => line.rule).join('\n\n')}`,
    sourceLine: `${sample ? 'Sample data · invented example\n' : ''}${[...new Set(lines.map(line => line.sourceLine))].join('\n')}`,
    sourceHref: flags.length ? '/settings' : '/ads', primary: { kind: 'copy', label: name ? `Message for ${name}` : 'Copy a message', text: note },
    secondary: { kind: 'save', target: 'morning', label: 'Leave it, ask in a week', action: 'hold', days: 7 },
    menu: [{ kind: 'save', target: 'morning', label: 'Stop showing this', action: 'hide' }], allowedPresses: ['hold', 'hide'],
  };
  return { ...input, excludeNeedIds: [...new Set([...excludes, ...flags.map(flag => flag.id)])], extensions: [...extensions, card] };
}
