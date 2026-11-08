import { addDays } from '../hero-range.js';
import { formatUkTime } from '../uk-time.js';
import { googleJobKinds, type GoogleFacts, type GoogleSyncState } from './model.js';

export interface GoogleAuditRow {
  day: string;
  hoursMicros: string | null;
  dailyMicros: string | null;
  hoursCurrency: string | null;
  dailyCurrency: string | null;
  differenceMicros: string | null;
  status: 'match' | 'difference' | 'missing' | 'currency_mismatch';
}
export interface GoogleSpendReconciliation { from: string; to: string; days: GoogleAuditRow[]; total: GoogleAuditRow }
export interface GoogleHealthView {
  mode: GoogleFacts['mode'];
  line: string;
  jobs: string[];
  quota: string;
  audit: string[];
  reconciliation: GoogleSpendReconciliation;
}

const knownCurrency = (value: string | null | undefined): string | null => value && /^[A-Z]{3}$/.test(value) ? value : null;
function covered(job: GoogleSyncState | undefined, day: string): boolean {
  return !!job?.lastSuccessAt && Number.isFinite(Date.parse(job.lastSuccessAt)) && job.coverage?.basis === 'gmt'
    && job.coverage.from <= day && day <= job.coverage.to
    && day <= (job.coverage.completeGmtTo ?? job.coverage.to)
    // A report can include today's partial hours. Midnight cannot certify those hours as a full day.
    && day < new Date(job.lastSuccessAt).toISOString().slice(0, 10);
}
function comparison(day: string, hours: bigint | null, daily: bigint | null, hoursCurrency: string | null, dailyCurrency: string | null): GoogleAuditRow {
  const missing = hours === null || daily === null;
  const sameCurrency = hoursCurrency !== null && hoursCurrency === dailyCurrency;
  const difference = !missing && sameCurrency ? hours - daily : null;
  return { day, hoursMicros: hours?.toString() ?? null, dailyMicros: daily?.toString() ?? null, hoursCurrency, dailyCurrency,
    differenceMicros: difference?.toString() ?? null,
    status: missing ? 'missing' : !sameCurrency ? 'currency_mismatch' : difference === 0n ? 'match' : 'difference' };
}

/** Raw GMT buckets only. Missing coverage never turns an absent API row into zero. */
export function reconcileGoogleSpend(facts: GoogleFacts, now: Date): GoogleSpendReconciliation {
  const to = addDays(now.toISOString().slice(0, 10), -1), from = addDays(to, -6);
  const hoursJob = facts.jobs.find(job => job.kind === 'conversions'), dailyJob = facts.jobs.find(job => job.kind === 'daily');
  const hoursCurrency = knownCurrency(hoursJob?.currency), dailyCurrency = knownCurrency(dailyJob?.currency);
  const hourly = new Map<string, bigint>(), daily = new Map<string, bigint>();
  for (const row of facts.hours) if (row.day >= from && row.day <= to) hourly.set(row.day, (hourly.get(row.day) ?? 0n) + BigInt(row.spendMicros));
  for (const row of facts.daily) if (row.day >= from && row.day <= to) daily.set(row.day, (daily.get(row.day) ?? 0n) + BigInt(row.spendMicros));
  const days: GoogleAuditRow[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(comparison(day,
    covered(hoursJob, day) ? hourly.get(day) ?? 0n : null, covered(dailyJob, day) ? daily.get(day) ?? 0n : null, hoursCurrency, dailyCurrency));
  const total = (field: 'hoursMicros' | 'dailyMicros') => days.every(day => day[field] !== null)
    ? days.reduce((sum, day) => sum + BigInt(day[field]!), 0n) : null;
  return { from, to, days, total: comparison(`${from}–${to}`, total('hoursMicros'), total('dailyMicros'), hoursCurrency, dailyCurrency) };
}

/** Round integer micros only at display time; even large totals keep their pennies. */
function amount(micros: string, currency: string | null, exact = false): string {
  const value = BigInt(micros), absolute = value < 0n ? -value : value;
  const minor = exact ? absolute : (absolute + 5_000n) / 10_000n;
  const base = exact ? 1_000_000n : 100n;
  const decimal = `${minor / base}.${(minor % base).toString().padStart(exact ? 6 : 2, '0')}`;
  return `${value < 0n ? '−' : ''}${currency ?? 'currency unknown'} ${decimal}`;
}
function auditLine(row: GoogleAuditRow, total = false): string {
  const hours = row.hoursMicros === null ? 'not read' : amount(row.hoursMicros, row.hoursCurrency);
  const daily = row.dailyMicros === null ? 'not read' : amount(row.dailyMicros, row.dailyCurrency);
  const difference = row.status === 'missing' ? 'hours minus Google daily: unavailable; missing successful GMT coverage'
    : row.status === 'currency_mismatch' ? `hours minus Google daily: not compared; ${row.hoursCurrency && row.dailyCurrency ? 'currencies differ' : 'currency unavailable'}`
    : `hours minus Google daily: ${BigInt(row.differenceMicros!) > 0n ? '+' : ''}${amount(row.differenceMicros!, row.hoursCurrency, row.status === 'difference')}${row.status === 'match' ? ' · match' : ' · difference'}`;
  return `${total ? '7 GMT days' : 'GMT'} ${row.day} · hours summed ${hours} · Google daily ${daily} · ${difference}`;
}

export function googleHealth(facts: GoogleFacts, now: Date): GoogleHealthView {
  const reconciliation = reconcileGoogleSpend(facts, now);
  const names = { campaigns: 'Campaigns and locations', networks: 'Network split', conversions: 'Conversions and GMT hours', changes: 'Changes', daily: 'GMT daily figures' };
  const jobs = googleJobKinds.map(kind => {
    const job = facts.jobs.find(row => row.kind === kind);
    return `${names[kind]}: ${job?.lastSuccessAt ? `last read ${formatUkTime(job.lastSuccessAt)}` : 'waiting for first read'}${job?.error ? ` · read failed (${job.error}); stored data retained` : ''}`;
  });
  const quota = `${facts.quota.operations} of ${facts.quota.limit} operations used on ${facts.quota.day ?? now.toISOString().slice(0,10)} UTC · ${facts.quota.historyOperations} history attempts${facts.quota.error ? ` · paused (${facts.quota.error})` : ''}`;
  const line = facts.mode === 'sample' ? 'Google Ads: sample data · waiting for keys'
    : facts.quota.error === 'daily_cap' ? 'Google Ads: reads paused by the operation budget; stored data retained'
    : facts.jobs.some(job => job.error) ? 'Google Ads: a read needs attention; other scheduled reads run independently'
    : googleJobKinds.some(kind => !facts.jobs.find(job => job.kind === kind)?.lastSuccessAt) ? 'Google Ads: waiting for scheduled reads'
    : facts.quota.error ? 'Google Ads: extra attempts paused to protect scheduled reads; stored data retained'
    : 'Google Ads: scheduled reads running · figures can lag about 3 hours';
  return { mode:facts.mode,line,jobs,quota,audit:[...reconciliation.days.map(row=>auditLine(row)),auditLine(reconciliation.total,true)],reconciliation };
}
