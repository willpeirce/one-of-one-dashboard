/** Scanning is opt-in; ad-set actions are separately opt-in. */
export function creativeFeatureFlags(env: NodeJS.ProcessEnv = process.env): {
  creativeScanEnabled: boolean; metaActionsEnabled: boolean;
} {
  return { creativeScanEnabled: env.CREATIVE_SCAN_ENABLED === 'true', metaActionsEnabled: env.META_ACTIONS_ENABLED === 'true' };
}
