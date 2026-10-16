import type { Database } from '../db.js';
import type { Settings } from '../settings.js';
import { SAMPLE_CREATIVE_ACCOUNT, readSampleCreativeCatalogue, sampleCreativeAttributeRows, sampleCreativeData, sampleCreativeStoredLifts } from './sample.js';
import { saveCatalogue, saveInsights } from './store.js';
import { creativeLiftStorageId, saveCreativeLifts } from './lifts.js';

/** Seeds invented examples in their own account/mode, preserving later sample edits. */
export async function seedCreativeSample(db: Database, settings: Settings, now: Date): Promise<void> {
  // A lift illustration is a stable version marker, independent of editable tags or merges.
  const marker = creativeLiftStorageId(SAMPLE_CREATIVE_ACCOUNT, 'sample', 'invented-brief-7-all-video');
  if ((await db.query("SELECT id FROM pulse.attribute_lifts WHERE mode='sample' AND account_id=$1 AND id=$2", [SAMPLE_CREATIVE_ACCOUNT, marker])).rowCount) return;
  const present = await db.query<{ id: string; merged_into_id: string | null }>(
    "SELECT id,merged_into_id FROM pulse.media_groups WHERE mode='sample' AND account_id=$1", [SAMPLE_CREATIVE_ACCOUNT]);
  const sample = sampleCreativeData(settings, now);
  for (const group of sample.groups) {
    const saved = present.rows.find(saved => saved.id === group.id);
    if (saved) group.mergedIntoId = saved.merged_into_id;
  }
  await db.transaction(async tx => {
    if (!present.rowCount) {
      for await (const page of readSampleCreativeCatalogue(settings, now)) {
        await saveCatalogue(tx, SAMPLE_CREATIVE_ACCOUNT, page, now, 'sample');
      }
      const days = sample.insights.map(row => row.day).sort();
      await saveInsights(tx, SAMPLE_CREATIVE_ACCOUNT, days[0]!, days.at(-1)!, sample.insights, now, undefined, 'sample');
    }
    // Upgrade the old reserved-table examples once; no tags were editable before batch 4.
    await tx.query("DELETE FROM pulse.media_attributes WHERE mode='sample' AND account_id=$1 AND id=ANY($2::text[])", [SAMPLE_CREATIVE_ACCOUNT, [
      'invented-sample-video-1-hookType', 'invented-sample-video-1-slabEarly',
      'invented-sample-video-2-setting', 'invented-sample-image-1-format',
    ]]);
    for (const row of sampleCreativeAttributeRows(sample)) {
      await tx.query(`INSERT INTO pulse.media_attributes(id,mode,account_id,media_group_id,attribute_key,value,source,recorded_at)
        VALUES($1,'sample',$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`, [
        `invented-batch4-${row.groupId}-${row.key}-${row.source}`, SAMPLE_CREATIVE_ACCOUNT, row.groupId, row.key,
        JSON.stringify(row.value), row.source, now,
      ]);
    }
    await saveCreativeLifts(tx, SAMPLE_CREATIVE_ACCOUNT, 'sample', sampleCreativeStoredLifts(now));
  });
}
