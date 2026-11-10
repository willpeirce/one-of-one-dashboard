import type { Database } from '../db.js';
import { validatePushKeyPair, type RawPushKeyPair } from './crypto.js';

/** Reuse the pair Auth already creates; this reader never generates or changes keys. */
export async function readPushKeyPair(db: Database): Promise<RawPushKeyPair> {
  try {
    const row = (await db.query<{value: Uint8Array}>("SELECT value FROM pulse_private.app_secrets WHERE name='push_key_pair'")).rows[0];
    if (!row) throw new Error('Missing push key pair.');
    return validatePushKeyPair(JSON.parse(Buffer.from(row.value).toString('utf8')) as unknown);
  } catch {
    // Parsing and database errors can contain their input. Keep those server secrets out of errors, too.
    throw new Error('Push key pair is unavailable.');
  }
}
