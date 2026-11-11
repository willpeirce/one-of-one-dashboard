import type {DashboardSnapshot} from '../dashboard-types.js';
import type {Settings} from '../settings.js';
import type {AdSetsView} from '../meta-adsets/presentation.js';
import type {StoredAdSet} from '../meta-adsets/catalogue.js';
import type {MetaAction} from '../meta-adsets/actions.js';

const ruleSettings = (settings: Settings): string => JSON.stringify([
  settings.adRules,settings.cppUkBreakEvenGbp,settings.cppUsBreakEvenGbp,settings.metaOwners,
]);
const verdictFields = ['owner','status','effectiveStatus','currency','flatBudget','dailyBudget','lifetimeBudget',
  'market','name','createdTime','updatedTime','lastSignificantEdit','learningStage'] as const;

/** Never attach cached figures to a different account or replay a changed engine decision. */
export function overlayAdSetControls(view: AdSetsView,cached: Settings,current: Settings,
  sets: readonly StoredAdSet[],actions: MetaAction[],today: string): AdSetsView {
  const sameAccount = cached.metaAdAccountId === current.metaAdAccountId;
  const sameRules = ruleSettings(cached) === ruleSettings(current) && view.today === today;
  const byId = new Map(sets.map(set => [set.id,set]));
  let deferredJudgement = !sameRules;
  const rows = sameAccount ? view.rows.flatMap(row => {
    const set = byId.get(row.set.id);
    if (!set) return [];
    const same = sameRules && verdictFields.every(field => row.set[field] === set[field]);
    if (!same) deferredJudgement = true;
    return [{...row,set: {...set},verdict: same && set.owner === 'ours' && set.status === 'ACTIVE'
      && set.effectiveStatus === 'ACTIVE' && set.currency === 'GBP' ? row.verdict : null}];
  }) : [];
  return {...view,rows,actions,count: sets.length,
    // An omitted cached judgement is not a successful new read proving its rule has cleared.
    stale: view.stale || deferredJudgement,
    ...(!sameAccount ? {lastRead: null,stale: true,accountYesterday: null,activity: undefined} : {}),
    // This optional structural projection also works when the check-item feature is reverted.
    ...('catalogue' in view ? {catalogue: sets.map(({id,name,owner,status,effectiveStatus,currency}) =>
      ({id,name,owner,status,effectiveStatus,currency}))} : {})};
}

export function changedSourceScopes(cached: Settings,current: Settings): Set<string> {
  const changed = new Set<string>();
  if (cached.metaAdAccountId !== current.metaAdAccountId) changed.add('meta');
  if (cached.googleCustomerId !== current.googleCustomerId || cached.googleLoginCustomerId !== current.googleLoginCustomerId) changed.add('google-ads');
  if (cached.tiktokAdvertiserId !== current.tiktokAdvertiserId) changed.add('tiktok');
  return changed;
}

/** The cached financial display keeps its original read labels; decision inputs cannot change identity. */
export function fenceDashboardScopes(dashboard: DashboardSnapshot,changed: ReadonlySet<string>): DashboardSnapshot {
  return {...dashboard,
    ...(dashboard.shopify ? {shopify: {...dashboard.shopify,
      needs: dashboard.shopify.needs.filter(need => !changed.has(need.source)),
      checks: dashboard.shopify.checks.filter(check => ![...changed].some(source =>
        check.id.startsWith(`${source === 'google-ads' ? 'google' : source}-`))),
    }} : {}),
    sourceHealth: dashboard.sourceHealth?.filter(source => !changed.has(source.source)),
    ...(changed.has('meta') ? {creatives: undefined} : {}),
  };
}
