import {readInsightChunk} from './insight-backfill.js';
import {repairThruPlays} from './thruplay-repair.js';
import {refreshMediaFacts} from './media-facts.js';
import type { Database } from '../db.js';
import type { Settings } from '../settings.js';
import { addDays, ukToday } from '../hero-range.js';
import { adErrorCode } from '../ad-spend/model.js';
import type { CreativeReader, StoredCatalogueAd } from './model.js';
import { enforceMediaCap, readLiveCreativeData, reducedDetailCount, saveCatalogue } from './store.js';
import { refreshCreativeFrequencies } from './frequency.js';
import { recomputeMetaAttributes } from './attribute-store.js';
import { runCreativeScans, type ScanOptions } from './scan.js';
import { recomputeCreativeLifts } from './lifts.js';

/** Called by the existing 30-minute spend worker, with the same read-only Meta transport. */
export class CreativeWorker {
  constructor(private readonly db: Database, private readonly reader: CreativeReader,
    private readonly scanOptions: Pick<ScanOptions, 'fetch' | 'clock' | 'sleep'> = {}) {}
  async run(account: string, settings: Settings, now = new Date(), includeInsights = true): Promise<void> {
    await Promise.all([this.readCatalogue(account,settings,now),...(includeInsights?[this.runInsights(account,settings,now)]:[])]);
    // Model failures are independent of the Meta catalogue, insights and frequency reads.
    try {
      await runCreativeScans(this.db,settings,{ ...this.scanOptions, accountId: account, mode: 'live', reader: this.reader });
    } catch { console.error('Creative scan could not finish.'); }
    try {
      await recomputeCreativeLifts(this.db,account,{ mode: 'live' },settings,now);
    } catch { console.error('Creative lifts could not be refreshed.'); }
  }
  private async readCatalogue(account: string, settings: Settings, now: Date): Promise<void> {
    const step = 'catalogue';
    let savedAds = 0;
    let catalogueCompleted = false;
    try {
      await this.db.query('INSERT INTO pulse.creative_jobs(account_id) VALUES($1) ON CONFLICT DO NOTHING',[account]);
      try { await refreshMediaFacts(this.db,this.reader,account,now,settings.creativeDefaultWindow); }
      catch { console.error('Meta media facts progress could not be saved.'); }
      const retryGroups = await this.db.query<{id:string}>(`SELECT g.id FROM pulse.media_groups g WHERE mode='live' AND account_id=$1
        AND g.detail_reduced_at<=$2::timestamptz-interval '24 hours'
        AND (g.detail_retry_after IS NULL OR g.detail_retry_after<=$2)
        AND EXISTS(SELECT 1 FROM pulse.ads a WHERE a.mode=g.mode AND a.account_id=g.account_id AND a.media_group_id=g.id)
        ORDER BY g.fetched_at,g.id LIMIT 20`,[account,now]);
      const retryIds=retryGroups.rows.map(r=>r.id), due='g.id=ANY($2::text[])';
      if (this.reader.rememberStoredAds) {
        const known = await this.db.query<StoredCatalogueAd>(`SELECT a.ad_id AS id,a.creative_id AS "creativeId",a.media_group_id AS "mediaGroupId" FROM pulse.ads a JOIN pulse.media_groups g ON g.id=a.media_group_id AND g.mode=a.mode AND g.account_id=a.account_id WHERE a.mode='live' AND a.account_id=$1 AND NOT COALESCE((${due}),false)`,[account,retryIds]);
        this.reader.rememberStoredAds(known.rows);
      }
      if (this.reader.rememberDetailRetries) {
        const retries = await this.db.query<StoredCatalogueAd>(`SELECT a.ad_id AS id,a.creative_id AS "creativeId",a.media_group_id AS "mediaGroupId" FROM pulse.ads a JOIN pulse.media_groups g ON g.id=a.media_group_id AND g.mode=a.mode AND g.account_id=a.account_id WHERE a.mode='live' AND a.account_id=$1 AND (${due})`,[account,retryIds]);
        this.reader.rememberDetailRetries(retries.rows);
      }
      if (this.reader.rememberStoredMedia) {
        const known = await this.db.query<{ kind: string; media_key: string }>(`SELECT kind,media_key FROM pulse.media_groups g WHERE mode='live' AND account_id=$1 AND NOT COALESCE((${due}),false)`,[account,retryIds]);
        this.reader.rememberStoredMedia(known.rows.map(row => `${row.kind}:${row.media_key}`));
      }
      for await (const page of this.reader.readCatalogue(account,settings,now)) {
        await saveCatalogue(this.db,account,page,now);
        savedAds += page.length;
        await enforceMediaCap(this.db,account,settings.creativeMediaCapMb);
      }
      catalogueCompleted = true;
      await this.db.query('UPDATE pulse.creative_jobs SET last_catalogue_at=$2 WHERE account_id=$1',[account,now]);
      await this.db.query('UPDATE pulse.creative_jobs SET catalogue_error=NULL,error_code=insights_error WHERE account_id=$1',[account]);
    } catch(error) {
      const code = `${adErrorCode(error,'meta')} at ${step}${step === 'catalogue' ? ` after ${savedAds} ads` : ''}`;
      await this.db.query('UPDATE pulse.creative_jobs SET catalogue_error=$2,error_code=$2 WHERE account_id=$1',[account,code]).catch(()=>{});
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
  }
  async runThruPlayRepair(account:string,settings:Settings,now=new Date(),options:{onlyDue?:boolean}={}):Promise<void>{
    let filled=0;
    try { filled=(await repairThruPlays(this.db,this.reader,account,now,settings.creativeDefaultWindow,options))?.filled??0; }
    catch(error){ console.error(`Meta ThruPlay repair could not finish (${adErrorCode(error,'meta')} at backfill).`); }
    if(filled)try { await recomputeCreativeLifts(this.db,account,{mode:'live'},settings,now); }
    catch { console.error('Creative lifts could not be refreshed.'); }
  }
  async runInsights(account:string,settings:Settings,now=new Date(),includeThruPlayRepair=true):Promise<void>{
    const today=ukToday(now),yesterday=addDays(today,-1);
    await this.db.query('INSERT INTO pulse.creative_jobs(account_id) VALUES($1) ON CONFLICT DO NOTHING',[account]);
    const job=(await this.db.query<any>('SELECT *,backfill_next::text,nightly_day::text FROM pulse.creative_jobs WHERE account_id=$1',[account])).rows[0];
    let failure:string|null=null;
    const failed=(error:unknown,step:'insights'|'backfill')=>{
      const code=`${adErrorCode(error,'meta')} at ${step}`;
      failure??=code;
      console.error(`Meta creatives read failed (${code}).`);
    };
    try{
      await readInsightChunk(this.db,this.reader,account,yesterday,today,now);
      await this.db.query('UPDATE pulse.creative_jobs SET last_success_at=$2 WHERE account_id=$1',[account,now]);
      if (job.nightly_day !== today) {
        await readInsightChunk(this.db,this.reader,account,addDays(today,-7),yesterday,now);
        await this.db.query('UPDATE pulse.creative_jobs SET nightly_day=$2 WHERE account_id=$1',[account,today]);
      }
    }catch(error){failed(error,'insights');}
    // An unrelated recent-read failure must not prevent historical progress.
    try{
      let cursor = job.backfill_next, chunks = 0;
      for (; chunks<4 && !job.backfill_done && cursor<=yesterday; chunks++) {
        const end = [addDays(cursor,6),yesterday].sort()[0]!;
        await readInsightChunk(this.db,this.reader,account,cursor,end,now,{advance:true,markRefused:true});
        cursor=addDays(end,1);
      }
      // Refused days use any remaining slots after the initial forward pass.
      const due=(await this.db.query<{day:string}>(`SELECT day::text FROM pulse.creative_insight_days
        WHERE account_id=$1 AND NOT completed AND error_code IS NOT NULL AND retry_after<=$2
        ORDER BY day LIMIT $3`,[account,now,4-chunks])).rows;
      for(const {day} of due) await readInsightChunk(this.db,this.reader,account,day,day,now,{markRefused:true});
    }catch(error){failed(error,'backfill');}
    await this.db.query(`UPDATE pulse.creative_jobs SET backfill_done=backfill_done OR backfill_next>$2::date,
      insights_error=CASE WHEN $3::text IS NOT NULL THEN $3
        WHEN NOT backfill_done AND backfill_next<=$2::date AND insights_error LIKE '% at backfill' THEN insights_error END,
      error_code=COALESCE(catalogue_error,$3,CASE
        WHEN NOT backfill_done AND backfill_next<=$2::date AND insights_error LIKE '% at backfill' THEN insights_error END)
      WHERE account_id=$1`,[account,yesterday,failure]);
    if(includeThruPlayRepair) await this.runThruPlayRepair(account,settings,now);
    // Frequency is a separate exact-window read: failure cannot invalidate saved insights.
    if (this.reader.readFrequency) {
      try {
        await refreshCreativeFrequencies(this.db,this.reader,account,await readLiveCreativeData(this.db,settings),now);
      } catch(error) {
        console.error(`Meta creative frequency read failed (${adErrorCode(error,'meta')}).`);
      }
    }
    try { await recomputeCreativeLifts(this.db,account,{mode:'live'},settings,now); }
    catch { console.error('Creative lifts could not be refreshed.'); }
  }
}
