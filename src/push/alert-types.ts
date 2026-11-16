import type { Check } from '../shopify/watchdogs.js';

export const ALERT_CHECK_IDS = ['orders', 'checkout', 'dispatch', 'refunds', 'webhooks', 'geo', 'self', 'ads_check'] as const;
export type AlertCheckId = typeof ALERT_CHECK_IDS[number];
export const ALERT_KEYS = [...ALERT_CHECK_IDS, 'jj-monthly'] as const;
export type AlertKey = typeof ALERT_KEYS[number];
export const isAlertCheckId = (value: unknown): value is AlertCheckId => typeof value === 'string'
  && (ALERT_CHECK_IDS as readonly string[]).includes(value);
export const isAlertKey = (value: unknown): value is AlertKey => typeof value === 'string'
  && (ALERT_KEYS as readonly string[]).includes(value);
export interface AlertEvaluation {
  /** A successful watchdog run's real timestamp, not a request or cached read time. */
  evaluationId: string;
  checks: Check[];
  monthlyUploadOpen: boolean;
}
