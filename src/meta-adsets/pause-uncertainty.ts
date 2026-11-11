import { AdError } from '../ad-spend/model.js';

export type PauseUncertaintyPhase = 'waiting' | 'active' | 'paused';
export interface PauseUncertainty { phase: PauseUncertaintyPhase; finishedAt: string; code: string }
export const PAUSE_UNCERTAINTY_PREFIX = 'pause-uncertain-v1|';
export const PAUSE_WAITING_MESSAGE = 'Pause result is uncertain. Waiting for the next Meta read; no retry was sent.';

/** A missing acknowledgement is not evidence that Meta rejected the write. */
export function pauseMayHaveApplied(error: unknown): boolean {
  if (!(error instanceof AdError)) return true;
  if (error.code === 'unauthorized' || error.code === 'invalid') return false;
  return !(error.code === 'http' && error.status >= 400 && error.status < 500
    && error.status !== 408 && error.providerCode !== undefined);
}

export function pauseUncertaintyCode(phase: PauseUncertaintyPhase, finishedAt: Date, code: string): string {
  return `${PAUSE_UNCERTAINTY_PREFIX}${phase}|${finishedAt.toISOString()}|${code}`;
}

export function parsePauseUncertainty(value: string | null): PauseUncertainty | null {
  if (!value?.startsWith(PAUSE_UNCERTAINTY_PREFIX)) return null;
  const [, phase, finishedAt, code, extra] = value.split('|');
  if (!['waiting', 'active', 'paused'].includes(phase ?? '') || !finishedAt || !code || extra !== undefined
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(finishedAt)
    || !Number.isFinite(Date.parse(finishedAt)) || !/^[a-z0-9 ,/_-]{1,100}$/.test(code)) return null;
  return {phase: phase as PauseUncertaintyPhase, finishedAt, code};
}

export function pauseUncertaintyNote(errorCode: string | null): string | null {
  const marker = parsePauseUncertainty(errorCode);
  return marker?.phase === 'waiting' ? 'ⓘ Waiting for the next Meta read; the pause result is uncertain.'
    : marker?.phase === 'active' ? 'ⓘ Review individually; the next Meta read showed Active.'
    : marker?.phase === 'paused' ? '✓ Paused, confirmed by a later Meta read.' : null;
}
