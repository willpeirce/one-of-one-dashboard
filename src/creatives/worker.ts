import type { Database } from '../db.js';
import type { Settings } from '../settings.js';
import { addDays, ukToday } from '../hero-range.js';
import { adErrorCode } from '../ad-spend/model.js';
import type { CreativeReader, StoredCatalogueAd } from './model.js';
import { enforceMediaCap, readLiveCreativeData, saveCatalogue, saveInsights } from './store.js';
import { refreshCreativeFrequencies } from './frequency.js';

/** Called by the existing 30-minute spend worker, with the same read-only Meta transport. */
export class CreativeWorker {
  constructor(private readonly db: Database, private readonly reader: CreativeReader) {}
  async run(account: string, settings: Settings, now = new Date()): Promise<void> {
    const today = ukToday(now), yesterday = addDays(today,-1);
    let step: 'catalogue' | 'insights' | 'backfill' = 'catalogue';
    try {
      await this.db.query('INSERT INTO pulse.creative_jobs(account_id) VALUES($1) ON CONFLICT DO NOTHING',[account]);
      const job = (await this.db.query<any>('SELECT *,backfill_next::text,nightly_day::text FROM pulse.creative_jobs WHERE account_id=$1',[account])).rows[0];
      if (this.reader.rememberStoredAds) {
        const known = await this.db.query<StoredCatalogueAd>(`SELECT ad_id AS id,creative_id AS "creativeId",media_group_id AS "mediaGroupId" FROM pulse.ads WHERE mode='live' AND account_id=$1`,[account]);
        this.reader.rememberStoredAds(known.rows);
      }
      if (this.reader.rememberStoredMedia) {
        const known = await this.db.query<{ kind: string; media_key: string }>("SELECT kind,media_key FROM pulse.media_groups WHERE mode='live' AND account_id=$1",[account]);
        this.reader.rememberStoredMedia(known.rows.map(row => `${row.kind}:${row.media_key}`));
      }
      await saveCatalogue(this.db,account,await this.reader.readCatalogue(account,settings,now),now);
      await this.db.query('UPDATE pulse.creative_jobs SET last_catalogue_at=$2 WHERE account_id=$1',[account,now]);
      await enforceMediaCap(this.db,account,settings.creativeMediaCapMb);
      step = 'insights';
      await saveInsights(this.db,account,yesterday,today,await this.reader.readInsights(account,yesterday,today),now);
      await this.db.query('UPDATE pulse.creative_jobs SET last_success_at=$2 WHERE account_id=$1',[account,now]);
      // One local-day refresh, including yesterday's attribution revisions and zero-spend days.
      if (job.nightly_day !== today) {
        const from = addDays(today,-7);
        await saveInsights(this.db,account,from,yesterday,await this.reader.readInsights(account,from,yesterday),now);
        await this.db.query('UPDATE pulse.creative_jobs SET nightly_day=$2 WHERE account_id=$1',[account,today]);
      }
      step = 'backfill';
      let cursor = job.backfill_next;
      for (let chunk=0; chunk<4 && !job.backfill_done && cursor<=yesterday; chunk++) {
        const end = [addDays(cursor,6),yesterday].sort()[0]!;
        const next = addDays(end,1);
        // The rows and cursor commit together. A refused later page/chunk cannot skip a day.
        await saveInsights(this.db,account,cursor,end,await this.reader.readInsights(account,cursor,end),now,next);
        cursor=next;
      }
      await this.db.query('UPDATE pulse.creative_jobs SET backfill_done=backfill_done OR backfill_next>$3::date,last_success_at=$2,error_code=NULL WHERE account_id=$1',[account,now,yesterday]);
    } catch(error) {
      const code = `${adErrorCode(error,'meta')} at ${step}`;
      await this.db.query('UPDATE pulse.creative_jobs SET error_code=$2 WHERE account_id=$1',[account,code]).catch(()=>{});
      // The provider body and token are never persisted or passed to a logger.
      console.error(`Meta creatives read failed (${code}).`);
      if (step === 'catalogue') return;
    }
    // Frequency is a separate exact-window read: failure cannot invalidate saved insights.
    if (this.reader.readFrequency) {
      try {
        await refreshCreativeFrequencies(this.db,this.reader,account,await readLiveCreativeData(this.db,settings),now);
      } catch(error) {
        console.error(`Meta creative frequency read failed (${adErrorCode(error,'meta')}).`);
      }
    }
  }
}
