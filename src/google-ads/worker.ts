import type { Database } from '../db.js';
import { readSettings, type Settings } from '../settings.js';
import { getSourceStates } from '../sources.js';
import { ukToday } from '../hero-range.js';
import { adErrorCode } from '../ad-spend/model.js';
import { GOOGLE_CHANGE_INTERVAL_MS, GOOGLE_REPORT_INTERVAL_MS, GoogleQuotaError, googleJobKinds, googleWindow, type GoogleCoverage, type GoogleReader } from './model.js';
import { beginGoogleRead, failGoogleRead, googleSync, saveGoogleRead } from './store.js';
export interface GoogleWorkerOptions { clock?: () => Date }
export class GoogleWorker {
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private closing = false;
  private readonly live: boolean;
  constructor(private readonly db: Database, env: NodeJS.ProcessEnv,
    private readonly readerFor: (settings: Settings) => Promise<GoogleReader | null>,
    private readonly options: GoogleWorkerOptions = {}) {
    this.live = getSourceStates(env).find(s => s.source === 'google-ads')!.mode === 'live';
  }
  start(): void {
    if (!this.live || this.timer || this.closing) return;
    void this.tick();
    this.timer = setInterval(() => { void this.tick(); }, 30_000);
    this.timer.unref();
  }
  tick(): Promise<void> {
    if (!this.live || this.closing) return Promise.resolve();
    if (!this.running) this.running = this.run().catch(error => {
      console.error(`Google reports worker failed (${adErrorCode(error, 'google-ads')}).`);
    }).finally(() => { this.running = undefined; });
    return this.running;
  }
  async stop(): Promise<void> { this.closing = true; if (this.timer) clearInterval(this.timer); await this.running; }
  private async run(): Promise<void> {
    const settings = (await readSettings(this.db)).values;
    if (!settings.googleCustomerId) return;
    const reader = await this.readerFor(settings);
    if (!reader) return;
    const now = this.options.clock?.() ?? new Date(), account = settings.googleCustomerId,
      jobs = await googleSync(this.db, account), window = googleWindow(now);
    for (const kind of googleJobKinds) {
      if (this.closing) return;
      const job = jobs.find(j => j.kind === kind), interval = kind === 'changes' ? GOOGLE_CHANGE_INTERVAL_MS : GOOGLE_REPORT_INTERVAL_MS;
      if (job?.lastAttemptAt && now.getTime() - Date.parse(job.lastAttemptAt) < interval) continue;
      try {
        await beginGoogleRead(this.db, account, kind, now);
        let coverage: GoogleCoverage | null = null;
        const result = await (async () => {
          if (kind === 'campaigns') return reader.readGoogleCampaigns(account, settings);
          if (kind === 'networks') {
            coverage = { from: window.ukFrom, to: window.ukTo, basis: 'uk' };
            return reader.readGoogleNetworks(account, window.ukFrom, window.ukTo, settings);
          }
          if (kind === 'conversions') {
            coverage = { from: window.hoursFrom, to: window.hoursTo, basis: 'gmt', ukFrom: window.ukFrom, ukTo: ukToday(now), completeUkTo: window.ukTo, completeGmtTo: window.gmtTo };
            return reader.readGoogleConversions(account, window.hoursFrom, window.hoursTo, settings);
          }
          if (kind === 'daily') {
            coverage = { from: window.gmtFrom, to: window.gmtTo, basis: 'gmt' };
            return reader.readGoogleDaily(account, window.gmtFrom, window.gmtTo, settings);
          }
          const from = new Date(now.getTime() - 2 * 86400000).toISOString(), to = now.toISOString();
          coverage = { from, to, basis: 'instant' };
          return reader.readGoogleChanges(account, from, to, settings);
        })();
        await saveGoogleRead(this.db, account, kind, result.rows, result.currency, coverage, now);
      } catch (error) {
        const code = error instanceof GoogleQuotaError ? error.reason : adErrorCode(error, 'google-ads');
        await failGoogleRead(this.db, account, kind, code).catch(() => {});
        console.error(`Google ${kind} read failed (${code}).`);
      }
    }
  }
}
