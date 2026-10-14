import type { Database } from '../db.js';
import type { Settings } from '../settings.js';
import { addDays, ukToday } from '../hero-range.js';
import { adErrorCode } from '../ad-spend/model.js';
import type { CreativeReader, StoredCatalogueAd } from './model.js';
import { enforceMediaCap, readLiveCreativeData, reducedDetailCount, saveCatalogue, saveInsights } from './store.js';
import { refreshCreativeFrequencies } from './frequency.js';
import { recomputeMetaAttributes } from './attribute-store.js';
import { runCreativeScans, type ScanOptions } from './scan.js';

/** Called by the existing 30-minute spend worker, with the same read-only Meta transport. */
export class CreativeWorker {
  constructor(private readonly db: Database, private readonly reader: CreativeReader,
    private readonly scanOptions: Pick<ScanOptions, 'fetch' | 'clock' | 'sleep'> = {}) {}
  async run(account: string, settings: Settings, now = new Date()): Promise<void> {
    await this.readMeta(account,settings,now);
    // Model failures are independent of the Meta catalogue, insights and frequency reads.
    try {
      await runCreativeScans(this.db,settings,{ ...this.scanOptions, accountId: account, mode: 'live', reader: this.reader });
    } catch { console.error('Creative scan could not finish.'); }
  }
  private async readMeta(account: string, settings: Settings, now: Date): Promise<void> {
    const today = ukToday(now), yesterday = addDays(today,-1);
    let step: 'catalogue' | 'insights' | 'backfill' = 'catalogue';
    let savedAds = 0;
    let catalogueCompleted = false;
    try {
      await this.db.query('INSERT INTO pulse.creative_jobs(account_id) VALUES($1) ON CONFLICT DO NOTHING',[account]);
      const job = (await this.db.query<any>('SELECT *,backfill_next::text,nightly_day::text FROM pulse.creative_jobs WHERE account_id=$1',[account])).rows[0];
      const due = 'g.detail_reduced_at<=$2::timestamptz-interval \'24 hours\' AND (g.detail_retry_after IS NULL OR g.detail_retry_after<=$2)';
      if (this.reader.rememberStoredAds) {
        const known = await this.db.query<StoredCatalogueAd>(`SELECT a.ad_id AS id,a.creative_id AS "creativeId",a.media_group_id AS "mediaGroupId" FROM pulse.ads a JOIN pulse.media_groups g ON g.id=a.media_group_id AND g.mode=a.mode AND g.account_id=a.account_id WHERE a.mode='live' AND a.account_id=$1 AND NOT COALESCE((${due}),false)`,[account,now]);
        this.reader.rememberStoredAds(known.rows);
      }
      if (this.reader.rememberDetailRetries) {
        const retries = await this.db.query<StoredCatalogueAd>(`SELECT a.ad_id AS id,a.creative_id AS "creativeId",a.media_group_id AS "mediaGroupId" FROM pulse.ads a JOIN pulse.media_groups g ON g.id=a.media_group_id AND g.mode=a.mode AND g.account_id=a.account_id WHERE a.mode='live' AND a.account_id=$1 AND (${due})`,[account,now]);
        this.reader.rememberDetailRetries(retries.rows);
      }
      if (this.reader.rememberStoredMedia) {
        const known = await this.db.query<{ kind: string; media_key: string }>(`SELECT kind,media_key FROM pulse.media_groups g WHERE mode='live' AND account_id=$1 AND NOT COALESCE((${due}),false)`,[account,now]);
        this.reader.rememberStoredMedia(known.rows.map(row => `${row.kind}:${row.media_key}`));
      }
      for await (const page of this.reader.readCatalogue(account,settings,now)) {
        await saveCatalogue(this.db,account,page,now);
        savedAds += page.length;
        await enforceMediaCap(this.db,account,settings.creativeMediaCapMb);
      }
      catalogueCompleted = true;
      await this.db.query('UPDATE pulse.creative_jobs SET last_catalogue_at=$2 WHERE account_id=$1',[account,now]);
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
      const code = `${adErrorCode(error,'meta')} at ${step}${step === 'catalogue' ? ` after ${savedAds} ads` : ''}`;
      await this.db.query('UPDATE pulse.creative_jobs SET error_code=$2 WHERE account_id=$1',[account,code]).catch(()=>{});
      // The provider body and token are never persisted or passed to a logger.
      console.error(`Meta creatives read failed (${code}).`);
      if (step === 'catalogue') return;
    } finally {
      if (catalogueCompleted || savedAds > 0) {
        try { await recomputeMetaAttributes(this.db,'live',account,now); }
        catch { console.error('Meta creative attributes could not be refreshed.'); }
      }
      const count = await reducedDetailCount(this.db,account).catch(() => 0);
      if (count) console.info(`${count} creatives read at reduced detail`);
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
