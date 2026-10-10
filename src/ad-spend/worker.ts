import type { Database } from '../db.js';
import { addDays, ukToday } from '../hero-range.js';
import { readSettings } from '../settings.js';
import { getSourceStates } from '../sources.js';
import { AdError, adErrorCode, accountFor, adSources, type AdSource } from './model.js';
import { liveReader, type SpendReader } from './clients.js';
import type { AdTransportOptions } from './http.js';
import { readJobs, recordCampaignSync, saveMetaCampaigns, saveSpend } from './store.js';
export interface SpendWorkerOptions extends AdTransportOptions {
  clock?: () => Date;
  readers?: Partial<Record<AdSource, SpendReader>>;
}
export class SpendWorker {
  private timer?: ReturnType<typeof setInterval>;
  private closing = false;
  private readonly runs = new Map<AdSource, Promise<void>>();
  private readonly readers = new Map<string, SpendReader>();
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
      'INSERT INTO pulse.ad_spend_jobs(source,account_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [source, account],
    );
    const job = (await readJobs(this.db)).find(
      (j) => j.source === source && j.account_id === account,
    )!;
    if (job.last_poll_at && now.getTime() - new Date(job.last_poll_at).getTime() < 30 * 60_000)
      return;
    await this.db.query(
      "UPDATE pulse.source_health SET mode='live',status=CASE WHEN last_success_at IS NULL THEN 'not_implemented' ELSE status END,last_attempt_at=$2 WHERE source=$1",
      [source, now],
    );
    await this.db.query(
      'UPDATE pulse.ad_spend_jobs SET last_poll_at=$3 WHERE source=$1 AND account_id=$2',
      [source, account, now],
    );
    const readerScope = JSON.stringify([source, account, settings.googleLoginCustomerId]);
    const reader =
      this.options.readers?.[source] ??
      this.readers.get(readerScope) ??
      liveReader(source, this.env, {
        ...this.options,
        log:
          this.options.log ??
          ((entry) =>
            console.info(
              `Ad spend ${entry.source} request ${entry.status} (${entry.requestId ?? 'no request id'}).`,
            )),
        beforeGoogleRead: async () => {
          const quota = await this.db.query<{ operations: number }>(
            `UPDATE pulse.ad_spend_jobs SET operations=CASE WHEN operations_day=$3::date THEN operations+1 ELSE 1 END,operations_day=$3 WHERE source=$1 AND account_id=$2 AND (operations_day IS DISTINCT FROM $3::date OR operations<200) RETURNING operations`,
            [source, account, (this.options.clock?.() ?? new Date()).toISOString().slice(0, 10)],
          );
          if (!quota.rows.length) throw new AdError('rate_limit');
        },
      });
    this.readers.set(readerScope, reader);
    let spendFailure: { error: unknown } | undefined;
    try {
      const from = addDays(today, -2),
        rows = await reader.read(account, from, today, settings);
      await saveSpend(this.db, source, account, from, today, rows, now);
      await this.db.query(
        'UPDATE pulse.ad_spend_jobs SET last_success_at=$3 WHERE source=$1 AND account_id=$2',
        [source, account, now],
      );
      // At most four fortnight chunks per poll; progress commits only with its rows.
      let cursor = job.backfill_next;
      for (
        let chunk = 0;
        chunk < 4 && !job.backfill_done && cursor <= addDays(today, -2) && !this.closing;
        chunk++
      ) {
        const end = [addDays(cursor, 13), addDays(today, -2)].sort()[0]!;
        await saveSpend(
          this.db,
          source,
          account,
          cursor,
          end,
          await reader.read(account, cursor, end, settings),
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
        recordCampaignSync(this.db, account, { state: 'success', at: now.toISOString() });
      } catch (error) {
        const code = adErrorCode(error, 'meta');
        recordCampaignSync(this.db, account, { state: 'error', at: now.toISOString(), code });
        console.error(`Meta campaigns read failed (${code}).`);
      }
    }
    if (spendFailure) throw spendFailure.error;
  }
}
