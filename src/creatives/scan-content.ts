import { createHash } from 'node:crypto';
import type { Database } from '../db.js';
import type { ScanScope } from './scan-health.js';

/** Only source inputs form the identity; refresh times, spend and cache contents do not retry a skip. */
export async function readScanContent(db: Database, scope: ScanScope): Promise<Map<string, string>> {
  const [groups, ads] = await Promise.all([
    db.query<{ id: string; merged_into_id: string | null; signature: string }>(`SELECT id,merged_into_id,
      md5(jsonb_build_array(kind,media_key,scan_media_fingerprint)::text) AS signature
      FROM pulse.media_groups WHERE mode=$1 AND account_id=$2`, [scope.mode, scope.accountId]),
    db.query<{ media_group_id: string; signature: string }>(`SELECT media_group_id,
      md5(jsonb_build_array(ad_id,creative_id,body,title,call_to_action)::text) AS signature
      FROM pulse.ads WHERE mode=$1 AND account_id=$2 ORDER BY ad_id`, [scope.mode, scope.accountId]),
  ]);
  const byId = new Map(groups.rows.map(row => [row.id, row]));
  const adSignatures = new Map<string, string[]>();
  for (const ad of ads.rows) {
    let id = ad.media_group_id;
    const seen = new Set<string>();
    while (byId.get(id)?.merged_into_id && !seen.has(id)) {
      seen.add(id); id = byId.get(id)!.merged_into_id!;
    }
    const signatures = adSignatures.get(id) ?? [];
    signatures.push(ad.signature); adSignatures.set(id, signatures);
  }
  return new Map(groups.rows.filter(row => !row.merged_into_id).map(row => [row.id,
    createHash('sha256').update(JSON.stringify([row.signature, adSignatures.get(row.id) ?? []])).digest('hex')]));
}

export const scanMatchesContent = (attempt: { media_group_id: string; content_fingerprint: string | null }, content: Map<string, string>): boolean =>
  content.has(attempt.media_group_id) && (attempt.content_fingerprint === null || attempt.content_fingerprint === content.get(attempt.media_group_id));
