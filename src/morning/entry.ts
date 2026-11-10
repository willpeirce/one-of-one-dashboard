import type { Database } from '../db.js';
import { ukToday } from '../hero-range.js';

export const MORNING_DAY_COOKIE = 'pulse_morning_day';
export const MORNING_DAY_COOKIE_SECONDS = 2 * 24 * 60 * 60;

export function opensMorning(enabled: boolean, marker: string | undefined, url: string, now: Date): boolean {
  return enabled && url === '/' && marker !== ukToday(now);
}

/** Decide before Home builds its snapshot, without seeding or loading the Settings document. */
export async function readMorningFirst(db: Database): Promise<boolean> {
  const result = await db.query<{ enabled: boolean | null }>(
    "SELECT values->'morningOpensFirst' = 'true'::jsonb AS enabled FROM pulse.settings WHERE singleton=true",
  );
  return result.rows[0]?.enabled === true;
}
