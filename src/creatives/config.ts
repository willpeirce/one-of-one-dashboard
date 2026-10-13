/** Environment flags are display-only until the separate scan workflow is built. */
export function creativeFeatureFlags(env: NodeJS.ProcessEnv = process.env): {
  creativeScanEnabled: boolean; metaActionsEnabled: false;
} {
  return { creativeScanEnabled: env.CREATIVE_SCAN_ENABLED === 'true', metaActionsEnabled: false };
}
