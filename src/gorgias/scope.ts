import {createHash} from 'node:crypto';
import {normalizeGorgiasDomain, type GorgiasSelection} from './model.js';
export {normalizeGorgiasDomain} from './model.js';

/** Presence selects mode; invalid domains remain a contained live read failure. */
export function gorgiasSource(env: NodeJS.ProcessEnv): {mode: 'sample' | 'live'; domain: string} {
  const live = ['GORGIAS_DOMAIN', 'GORGIAS_EMAIL', 'GORGIAS_API_KEY'].every(key => !!env[key]?.trim());
  return {mode: live ? 'live' : 'sample', domain: live ? normalizeGorgiasDomain(env.GORGIAS_DOMAIN!) ?? '' : 'invented-helpdesk'};
}
export function gorgiasAccountScope(domain: string): string {
  return createHash('sha256').update(normalizeGorgiasDomain(domain) ?? '').digest('hex');
}
/** A changed account or selected view/tag never reuses another selection's rows or health. */
export function gorgiasScope(domain: string, selection: GorgiasSelection): string {
  return createHash('sha256').update(JSON.stringify([gorgiasAccountScope(domain), selection.gorgiasHandoverViewId
    ? ['view', selection.gorgiasHandoverViewId] : ['tag', selection.gorgiasHandoverTag]])).digest('hex');
}
