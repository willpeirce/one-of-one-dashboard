/** Scanning is opt-in; source ad actions remain unavailable. */
export function creativeFeatureFlags(env: NodeJS.ProcessEnv = process.env): {
  creativeScanEnabled: boolean; metaActionsEnabled: false;
} {
  return { creativeScanEnabled: env.CREATIVE_SCAN_ENABLED === 'true', metaActionsEnabled: false };
}
