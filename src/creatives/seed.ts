import type { Database } from '../db.js';
import type { Settings } from '../settings.js';
import { SAMPLE_CREATIVE_ACCOUNT, readSampleCreativeCatalogue, sampleCreativeAttributes, sampleCreativeData, sampleCreativeLifts } from './sample.js';
import { saveCatalogue, saveInsights } from './store.js';

/** Seeds invented examples in their own account/mode, without changing live rows. */
export async function seedCreativeSample(db: Database, settings: Settings, now: Date): Promise<void> {
  const present = await db.query("SELECT id FROM pulse.media_groups WHERE mode='sample' AND account_id=$1 LIMIT 1", [SAMPLE_CREATIVE_ACCOUNT]);
  if (present.rowCount) return;
  const sample = sampleCreativeData(settings, now);
  await db.transaction(async tx => {
    for await (const page of readSampleCreativeCatalogue(settings, now)) {
      await saveCatalogue(tx, SAMPLE_CREATIVE_ACCOUNT, page, now, 'sample');
    }
    const days = sample.insights.map(row => row.day).sort();
    await saveInsights(tx, SAMPLE_CREATIVE_ACCOUNT, days[0]!, days.at(-1)!, sample.insights, now, undefined, 'sample');
    for (const group of sampleCreativeAttributes) for (const attribute of group.attributes) {
      await tx.query(`INSERT INTO pulse.media_attributes(id,mode,account_id,media_group_id,attribute_key,value,source,recorded_at)
        VALUES($1,'sample',$2,$3,$4,$5,'will',$6) ON CONFLICT DO NOTHING`, [
        `invented-${group.groupId}-${attribute.key}`, SAMPLE_CREATIVE_ACCOUNT, group.groupId, attribute.key,
        JSON.stringify({ label: attribute.label, value: attribute.value, sample: true }), now,
      ]);
    }
    for (const lift of sampleCreativeLifts) {
      await tx.query(`INSERT INTO pulse.attribute_lifts(id,mode,account_id,kind,attribute_key,value,metrics,confidence,computed_at)
        VALUES($1,'sample',$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`, [
        `invented-lift-${lift.kind}`, SAMPLE_CREATIVE_ACCOUNT, lift.kind, lift.attributeKey, JSON.stringify(lift.value),
        JSON.stringify({ ...lift, sample: true }), lift.confidence, now,
      ]);
    }
  });
}
