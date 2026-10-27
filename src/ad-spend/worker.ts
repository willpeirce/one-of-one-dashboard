import { syncActivity } from '../meta-adsets/activity.js';
import { backfillMetaSpend } from './backfill.js';
import { readAdSets, saveAdSets } from '../meta-adsets/catalogue.js';
import type { Database } from '../db.js';
import { addDays, ukToday } from '../hero-range.js';
import { readSettings, type Settings } from '../settings.js';
import { getSourceStates } from '../sources.js';
import { AdError, adErrorCode, accountFor, adSources, type AdSource } from './model.js';
import { liveReader, MetaSpend, type SpendReader } from './clients.js';
import { MetaCreativeClient } from '../creatives/client.js';
import { CreativeWorker } from '../creatives/worker.js';
import type { CreativeReader } from '../creatives/model.js';
import type { ScanOptions } from '../creatives/scan.js';
import { adRequestLogLine, type AdTransportOptions } from './http.js';
import { readJobs, recordCampaignSync, saveMetaCampaigns, saveSpend } from './store.js';
export const SPEND_POLL_INTERVAL_MS = 30 * 60_000;
export const SPEND_STALE_AFTER_MS = 3 * SPEND_POLL_INTERVAL_MS;
export interface SpendWorkerOptions extends AdTransportOptions {
  clock?: () => Date;
  readers?: Partial<Record<AdSource, SpendReader>>;
  creativeReader?: CreativeReader;
  creativeScan?: Pick<ScanOptions, 'fetch' | 'clock' | 'sleep'>;
}
export class SpendWorker {
  private timer?: ReturnType<typeof setInterval>;
  private closing = false;
  private readonly runs = new Map<AdSource, Promise<void>>();
  private readonly readers = new Map<string, SpendReader>();
  private readonly creativeReaders = new Map<string, CreativeReader>();
  private creativeRunning = false;
  private creativePass?: Promise<void>;
  private creativeInsightPass?: Promise<void>;
  private thruPlayPass?: Promise<void>;
  private readonly backfills = new Map<string, Promise<void>>();
  waitForSpendBackfill(): Promise<void> { return Promise.all(this.backfills.values()).then(() => {}); }
  private startMetaBackfill(reader: SpendReader, account: string, settings: Settings, now: Date): void {
    if (this.backfills.has(account) || this.closing) return;
    const pass = backfillMetaSpend(this.db, reader, account, settings, now, SPEND_POLL_INTERVAL_MS,
      () => this.options.clock?.() ?? new Date(), () => this.closing)
      .catch(error => console.error(`Meta spend backfill failed (${adErrorCode(error, 'meta')}).`))
      .finally(() => { this.backfills.delete(account); });
    this.backfills.set(account, pass);
  }
  constructor(
    private readonly db: Database,
    private readonly env: NodeJS.ProcessEnv,
    private readonly options: SpendWorkerOptions = {},
  ) {}
  start(): void {
    if (this.timer || this.closing) return;
    for (const source of adSources) void this.tick(source);
    this.timer = setInterval(() => {
      for (const source of adSources) void this.tick(source);
    }, 30_000);
    this.timer.unref();
  }
  async stop(): Promise<void> {
    this.closing = true;
    if (this.timer) clearInterval(this.timer);
    await Promise.all(this.runs.values());
    await this.waitForSpendBackfill();
    await this.waitForCreatives();
  }
  waitForCreativeInsights(): Promise<void> {
    return Promise.all([this.creativeInsightPass,this.thruPlayPass]).then(()=>{});
  }
  waitForThruPlayRepair(): Promise<void> {
    return this.thruPlayPass ?? Promise.resolve();
  }
  waitForCreatives(): Promise<void> {
    return Promise.all([this.creativePass,this.creativeInsightPass,this.thruPlayPass]).then(()=>{});
  }
  private startThruPlayRepair(reader:SpendReader,scope:string,account:string,settings:Settings,now:Date,onlyDue=false):void {
    if(this.thruPlayPass||!(reader instanceof MetaSpend||this.options.creativeReader))return;
    const source=this.options.creativeReader??this.creativeReaders.get(scope)??new MetaCreativeClient(reader as MetaSpend,this.options);
    this.creativeReaders.set(scope,source);
    if(!source.readThruPlays)return;
    this.thruPlayPass=(async()=>{
      const last=(await this.db.query<{thruplay_last_run_at:Date|string|null}>(
        'SELECT thruplay_last_run_at FROM pulse.creative_jobs WHERE account_id=$1',[account])).rows[0]?.thruplay_last_run_at;
      if(!onlyDue&&last&&now.getTime()-new Date(last).getTime()<SPEND_POLL_INTERVAL_MS)return;
      await new CreativeWorker(this.db,source,this.options.creativeScan).runThruPlayRepair(account,settings,now,{onlyDue});
    })().catch(error=>console.error(`Meta ThruPlay repair could not finish (${adErrorCode(error,'meta')} at backfill).`))
      .finally(()=>{this.thruPlayPass=undefined;});
  }
  tick(source: AdSource): Promise<void> {
    const current = this.runs.get(source);
    if (current) return current;
    if (this.closing) return Promise.resolve();
    const run = this.run(source)
      .catch((error) => {
        const code = adErrorCode(error, source);
        console.error(`Ad spend ${source} failed (${code}).`);
      })
      .finally(() => {
        this.runs.delete(source);
      });
    this.runs.set(source, run);
    return run;
  }
  private async run(source: AdSource): Promise<void> {
    // Spend runs first and alone sets source health and spend rows.
    // Every later read (campaigns or future extras) needs its own try/catch:
    // it can never change source state or the committed spend rows.
    const now = this.options.clock?.() ?? new Date(),
      today = ukToday(now),
      settings = (await readSettings(this.db)).values,
      account = accountFor(source, settings);
    const configured =
      !!account && getSourceStates(this.env).find((s) => s.source === source)!.mode === 'live';
    if (!configured) {
      await this.db.query(
        "UPDATE pulse.source_health SET mode='sample',status=$2,consecutive_failures=0 WHERE source=$1",
        [source, 'waiting_for_keys'],
      );
      return;
    }
    await this.db.query(
      `INSERT INTO pulse.ad_spend_jobs(source,account_id,backfill_next,backfill_first)
       VALUES ($1,$2,CASE WHEN $1='meta' THEN $3::date ELSE '2026-08-07'::date END,CASE WHEN $1='meta' THEN $3::date ELSE NULL END) ON CONFLICT DO NOTHING`,
      [source, account, addDays(today, -400)],
    );
    const job = (await readJobs(this.db)).find(
      (j) => j.source === source && j.account_id === account,
    )!;
    const readerScope = JSON.stringify([source, account, settings.googleLoginCustomerId]);
    const reader =
      this.options.readers?.[source] ??
      this.readers.get(readerScope) ??
      liveReader(source, this.env, {
        ...this.options,
        log:
          this.options.log ??
          ((entry) => console.info(adRequestLogLine(entry))),
        beforeGoogleRead: async () => {
          const quota = await this.db.query<{ operations: number }>(
            `UPDATE pulse.ad_spend_jobs SET operations=CASE WHEN operations_day=$3::date THEN operations+1 ELSE 1 END,operations_day=$3 WHERE source=$1 AND account_id=$2 AND (operations_day IS DISTINCT FROM $3::date OR operations<200) RETURNING operations`,
            [source, account, (this.options.clock?.() ?? new Date()).toISOString().slice(0, 10)],
          );
          if (!quota.rows.length) throw new AdError('rate_limit');
        },
      });
    this.readers.set(readerScope, reader);
    if (reader instanceof MetaSpend) reader.setTargetCountries(await readAdSets(this.db,account,settings));
    if (job.last_poll_at && now.getTime() - new Date(job.last_poll_at).getTime() < SPEND_POLL_INTERVAL_MS) {
      // A fresh migration can leave repair work due even when spend polled just before restart.
      if(source==='meta')this.startThruPlayRepair(reader,readerScope,account,settings,now);
      return;
    }
    await this.db.query(
      "UPDATE pulse.source_health SET mode='live',status=CASE WHEN last_success_at IS NULL THEN 'not_implemented' ELSE status END,last_attempt_at=$2 WHERE source=$1",
      [source, now],
    );
    await this.db.query(
      'UPDATE pulse.ad_spend_jobs SET last_poll_at=$3 WHERE source=$1 AND account_id=$2',
      [source, account, now],
    );
    let spendFailure: { error: unknown } | undefined;
    try {
      // Re-read the last 14 full UK days once, including rows written before actions existed.
      const repairActions = source === 'meta' && !job.actions_backfilled_at;
      const from = addDays(today, repairActions ? -14 : -2),
        rows = await reader.read(account, from, today, settings, now);
      await saveSpend(this.db, source, account, from, today, rows, now);
      await this.db.query(
        'UPDATE pulse.ad_spend_jobs SET last_success_at=$3,actions_backfilled_at=CASE WHEN $4 THEN $3 ELSE actions_backfilled_at END WHERE source=$1 AND account_id=$2',
        [source, account, now, repairActions],
      );
      // At most four fortnight chunks per poll; progress commits only with its rows.
      let cursor = job.backfill_next;
      for (
        let chunk = 0;
        chunk < 4 && source !== 'meta' && !job.backfill_done && cursor <= addDays(today, -2) && !this.closing;
        chunk++
      ) {
        const end = [addDays(cursor, 13), addDays(today, -2)].sort()[0]!;
        await saveSpend(
          this.db,
          source,
          account,
          cursor,
          end,
          await reader.read(account, cursor, end, settings, now),
          now,
          addDays(end, 1),
        );
        cursor = addDays(end, 1);
      }
      await this.db.query(
        'UPDATE pulse.ad_spend_jobs SET backfill_done=backfill_done OR backfill_next>$4::date,last_success_at=$3,failures=0 WHERE source=$1 AND account_id=$2',
        [source, account, now, addDays(today, -2)],
      );
      await this.db.query(
        "UPDATE pulse.source_health SET mode='live',status='healthy',last_success_at=$2,consecutive_failures=0,updated_at=$2 WHERE source=$1",
        [source, now],
      );
    } catch (error) {
      await this.db
        .query(
          'UPDATE pulse.ad_spend_jobs SET failures=failures+1 WHERE source=$1 AND account_id=$2',
          [source, account],
        )
        .catch(() => {});
      await this.db
        .query(
          "UPDATE pulse.source_health SET mode='live',status='error',consecutive_failures=consecutive_failures+1,updated_at=$2 WHERE source=$1",
          [source, now],
        )
        .catch(() => {});
      spendFailure = { error };
    }
    // Secondary Settings reads run after money is committed and cannot change its health.
    if (source === 'meta' && reader.readCampaigns) {
      try {
        await saveMetaCampaigns(this.db, account, await reader.readCampaigns(account), now);
        await recordCampaignSync(this.db, account, { state: 'success', at: now.toISOString() });
      } catch (error) {
        const code = adErrorCode(error, 'meta');
        await recordCampaignSync(this.db, account, { state: 'error', at: now.toISOString(), code }).catch(() => {});
        console.error(`Meta campaigns read failed (${code}).`);
      }
    }
    if (source === 'meta' && reader.readActivities) await syncActivity(this.db,account,since=>reader.readActivities!(account,since),now);
    if (source === 'meta' && reader.readAdSets) {
      try {
        const sets=await reader.readAdSets(account,settings);
        await saveAdSets(this.db,account,sets,settings,now);
        if(reader instanceof MetaSpend)reader.setTargetCountries(sets);
      }
      catch (error) { console.error(`Meta ad sets read failed (${adErrorCode(error, 'meta')}).`); }
    }
    if (source === 'meta' && !spendFailure && !job.backfill_done) this.startMetaBackfill(reader, account, settings, now);
    if (source === 'meta' && (reader instanceof MetaSpend || this.options.creativeReader)) {
      this.startThruPlayRepair(reader,readerScope,account,settings,now);
      const insightReader=this.options.creativeReader??this.creativeReaders.get(readerScope)??new MetaCreativeClient(reader as MetaSpend,this.options);
      this.creativeReaders.set(readerScope,insightReader);
      if(!this.creativeInsightPass)this.creativeInsightPass=(async()=>{
        try { await new CreativeWorker(this.db,insightReader,this.options.creativeScan).runInsights(account,settings,now,false); }
        finally {
          // Full imports can introduce missing video fields after the earlier repair.
          await this.thruPlayPass;
          this.startThruPlayRepair(reader,readerScope,account,settings,now,true);
          await this.thruPlayPass;
        }
      })()
        .catch(error=>console.error(`Meta creatives read failed (${adErrorCode(error,'meta')} at insights).`))
        .finally(()=>{this.creativeInsightPass=undefined;});
      if (this.creativeRunning) {
        console.info('Meta creatives tick skipped: pass still running.');
      } else {
        // A long catalogue pass must not hold up the next spend or campaigns poll.
        const creativeReader = this.options.creativeReader ?? this.creativeReaders.get(readerScope) ?? new MetaCreativeClient(reader as MetaSpend, this.options);
        this.creativeReaders.set(readerScope, creativeReader);
        this.creativeRunning = true;
        this.creativePass = new CreativeWorker(this.db, creativeReader, this.options.creativeScan).run(account, settings, now, false)
          .catch(error => {
            console.error(`Meta creatives read failed (${adErrorCode(error, 'meta')} at catalogue after 0 ads).`);
          })
          .finally(() => {
            this.creativeRunning = false;
            this.creativePass = undefined;
          });
      }
    }
    if (spendFailure) throw spendFailure.error;
  }
}
