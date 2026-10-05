import { appConfig } from '../config.js';
import type { Database } from '../db.js';
import type { Settings } from '../settings.js';
import type { SourceHealth, SourceMode } from '../sources.js';
import { addDays, ukToday } from '../hero-range.js';
import { dataset, orderNet, ratio, type Facts } from './metrics.js';
import type { Order, Sessions } from './model.js';

export interface Check { id: string; name: string; status: 'pass' | 'tripped' | 'unknown'; why: string; link: string }
export interface Observation {
  day?: string; fetched?: string; us?: number; carts?: number; checkouts?: number; completed?: number; initialized?: boolean;
  cartless: number; checkoutSince: string | null; lastObserved?: string;
}
export const blankObservation = (): Observation => ({ cartless: 0, checkoutSince: null });
export function observe(previous: Observation, session: Sessions | undefined, fetched: Date | undefined, now: Date): Observation {
  if (!session || !fetched || previous.fetched === fetched.toISOString()) return previous;
  const initial = !previous.day;
  const same = previous.day === session.day;
  const diff = (key: 'us' | 'usCarts' | 'checkouts' | 'completed', prior: number | undefined): number => Math.max(0, Number(session[key] ?? 0) - (same ? prior ?? 0 : 0));
  const us = initial ? 0 : diff('us', previous.us), carts = initial ? 0 : diff('usCarts', previous.carts);
  const checkouts = initial ? 0 : diff('checkouts', previous.checkouts), completed = initial ? 0 : diff('completed', previous.completed);
  const revisedDown = same && (session.us < (previous.us ?? 0) || session.checkouts < (previous.checkouts ?? 0));
  return { day: session.day, fetched: fetched.toISOString(), us: session.us, carts: session.usCarts,
    checkouts: session.checkouts, completed: session.completed,
    cartless: !session.marketReliable || revisedDown || carts > 0 ? 0 : previous.cartless + us,
    checkoutSince: revisedDown || completed > 0 ? null : previous.checkoutSince ?? (checkouts > 0 ? now.toISOString() : null),
    initialized: !initial, lastObserved: now.toISOString() };
}
function zonedParts(now: Date, zone: string): { day: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const p = (key: string) => parts.find(p => p.type === key)!.value;
  return { day: `${p('year')}-${p('month')}-${p('day')}`, time: `${p('hour')}:${p('minute')}` };
}
export function usDaytime(now: Date): boolean { const { time } = zonedParts(now, 'America/New_York'); return time >= '09:00' && time < '23:00'; }
const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();
export function dispatchLate(order: Order, now: Date, settings: Settings, holidays: { warehouse: string; day: string }[]): boolean | null {
  if (!order.paidAt || !['UK', 'US', 'EU'].includes(order.market)) return null;
  if (order.fulfillmentStatus === 'FULFILLED') return false;
  if (order.fulfillmentStatus === 'unknown') return null;
  // Shipping allocation is absent until fulfilment. Use the destination warehouse and say so.
  const warehouse = order.market === 'US' ? 'us' : 'uk';
  const zone = warehouse === 'us' ? 'America/New_York' : 'Europe/London';
  const cutoff = warehouse === 'us' ? settings.dispatchCutoffUs : settings.dispatchCutoffUk;
  const paid = zonedParts(new Date(order.paidAt), zone), current = zonedParts(now, zone);
  if (paid.day < '2026-01-01' || current.day > '2027-12-31') return null;
  const working = (day: string) => ![0, 6].includes(weekday(day)) && !holidays.some(h => h.warehouse === warehouse && h.day === day);
  let due = paid.day;
  if (!working(due) || paid.time >= cutoff) do { due = addDays(due, 1); } while (!working(due));
  // A full working day after its dispatch cut-off, including bank holidays.
  do { due = addDays(due, 1); } while (!working(due));
  return current.day > due || current.day === due && current.time >= cutoff;
}
export function evaluateWatchdogs(facts: Facts, now: Date, settings: Settings, observation: Observation,
  holidays: { warehouse: string; day: string }[], health: SourceHealth[]): Check[] {
  const day = ukToday(now), data = dataset(facts, day), checks: Check[] = [];
  const link = `https://admin.shopify.com/store/${appConfig.shopify.storeDomain.split('.')[0]}`;
  const add = (id: string, name: string, status: Check['status'], why: string, path = '/orders') => checks.push({ id, name, status, why, link: `${link}${path}` });
  const sessionRow = facts.records.find(r => r.kind === 'sessions' && r.data.day === day);
  const s = sessionRow?.data as Sessions | undefined;
  const lastGood = facts.jobs.find(j => j.name === 'poll')?.last_success_at;
  const freshOrders = !!lastGood && now.getTime() - new Date(lastGood).getTime() <= 900_000;
  const freshSessions = !!sessionRow && now.getTime() - new Date(sessionRow.fetched_at).getTime() <= 900_000 && s?.provenance !== 'routine_daily';
  const hours = usDaytime(now) ? 2 : 3;
  const paidTimes = data.orders.filter(o => o.paidAt).map(o => Date.parse(o.paidAt!));
  const threshold = now.getTime() - hours * 3_600_000;
  const baselineStart = threshold - 7 * 86_400_000;
  // Compare the same local UK time last week across DST, rather than subtracting 168 UTC hours.
  const wallNow = zonedParts(now, 'Europe/London');
  const weekAgoDay = addDays(wallNow.day, -7);
  const localEpoch = (d: string, time: string): number => {
    let n = Date.parse(`${d}T${time}:00Z`);
    if (zonedParts(new Date(n), 'Europe/London').time !== time) n -= 3_600_000;
    return n;
  };
  const wallBaselineEnd = localEpoch(weekAgoDay, wallNow.time);
  const sameHourLastWeek = paidTimes.filter(t => t >= wallBaselineEnd - hours * 3_600_000 && t <= wallBaselineEnd).length;
  const silence = paidTimes.every(time => time < threshold);
  const paidCoverage = data.ready && data.from <= ukToday(new Date(baselineStart)) && data.orders.every(o => o.paidAt);
  add('orders', 'Orders flowing', !freshOrders || !paidCoverage ? 'unknown' : silence && sameHourLastWeek > 0 ? 'tripped' : 'pass',
    !freshOrders || !paidCoverage ? 'Paid times or complete fresh history unavailable; no silence verdict.' : `No paid order in ${hours} hours: ${silence ? 'yes' : 'no'}; same UK hours last week ${sameHourLastWeek} paid orders.`);
  const cartLimit = usDaytime(now) ? 40 : 75;
  add('us_cart', 'US add to cart', !freshSessions || typeof s?.usCarts !== 'number' || !s?.marketReliable || !observation.lastObserved || !observation.initialized ? 'unknown' : observation.cartless >= cartLimit ? 'tripped' : 'pass',
    `Monitoring changes between clean report snapshots: ${observation.cartless} US sessions without a cart; bar ${cartLimit}. A poll with carts resets the streak; exact visitor order is unavailable in ShopifyQL.`, '/analytics');
  add('checkout', 'Checkout', !freshSessions || !observation.lastObserved || !observation.initialized ? 'unknown' : observation.checkoutSince && now.getTime() - Date.parse(observation.checkoutSince) >= 90 * 60_000 ? 'tripped' : 'pass',
    observation.checkoutSince ? `Checkouts started without a completion since ${observation.checkoutSince}; bar 90 minutes.` : 'No outstanding checkout silence observed between report snapshots.', '/analytics');
  const dispatch = data.orders.map(o => dispatchLate(o, now, settings, holidays));
  const late = dispatch.filter(x => x === true).length;
  add('dispatch', 'Dispatch', !freshOrders || !data.ready ? 'unknown' : late ? 'tripped' : dispatch.some(x => x === null) ? 'unknown' : 'pass',
    `${late} orders unfulfilled a working day after cut-off. Destination warehouse; Northampton ${settings.dispatchCutoffUk} UK, Ohio ${settings.dispatchCutoffUs} ET. Unknown paid times/fulfilment states stay unknown. Holiday calendar covers 2026–27.`);
  const from = addDays(day, -6);
  const net = data.orders.reduce((n, o) => n + orderNet(o, from, day), 0);
  const refunds = data.orders.reduce((n, o) => n + o.refunds.filter(r => { const d = ukToday(new Date(r.createdAt)); return d >= from && d <= day; }).reduce((sum, r) => sum + r.itemsPence, 0), 0);
  const rate = ratio(refunds, net);
  add('refunds', 'Refunds', !freshOrders || !data.ready || data.from > from || rate === null ? 'unknown' : rate > .03 ? 'tripped' : 'pass',
    `Rolling 7 UK dates, today so far: ${rate === null ? 'rate unknown' : (rate * 100).toFixed(1) + '%'} net item refunds / net sales; bar 3%. Shipping/tax excluded.`);
  const subscriptions = facts.jobs.find(j => j.name === 'subscriptions');
  const webhookNotices = facts.noticeDetails.filter(n => n.kind === 'webhook_recreated');
  add('webhooks', 'Shopify webhooks', facts.mode === 'sample' ? 'unknown' : webhookNotices.length ? 'tripped' : !subscriptions?.last_success_at || subscriptions.failures || now.getTime() - new Date(subscriptions.last_success_at).getTime() > 3 * 3_600_000 ? 'unknown' : 'pass',
    facts.mode === 'sample' ? 'Sample mode never subscribes.' : webhookNotices.length ? `${webhookNotices.length} subscriptions repaired; notices clear when the next hourly check finds them present.` : 'Owned subscriptions checked hourly; initial creation is quiet.');
  add('geo', 'Session geo', !s || !freshSessions ? 'unknown' : !s.marketReliable ? 'tripped' : 'pass',
    s ? `Missouri ${s.us ? (100 * s.missouri / s.us).toFixed(1) + '%' : 'unknown'} of US sessions. Bar over 10%; 22–23 Sep 2026 market conversion is unknown.` : 'Today’s session report is unavailable.', '/analytics');
  const intervals: Record<string, number> = { poll: 300_000, inventory: 300_000, sessions: 300_000, reconcile: 86_400_000, subscriptions: 3_600_000 };
  const failed = facts.jobs.filter(j => j.failures >= 2 || j.name in intervals && j.last_success_at && now.getTime() - new Date(j.last_success_at).getTime() > 3 * (j.name === 'sessions' && j.state.cadence === 'daily' ? 86_400_000 : intervals[j.name]!));
  const otherFailures = health.filter(h => h.mode === 'live' && h.status === 'error' && h.consecutiveFailures >= 2);
  const expiry = settings.keyExpiryDates.filter(k => k.expiresOn <= addDays(day, 14));
  add('self', 'Self-check', failed.length || otherFailures.length || expiry.length ? 'tripped' : facts.jobs.some(j => j.name in intervals && !j.last_success_at && !(facts.mode === 'sample' && j.name === 'subscriptions')) ? 'unknown' : 'pass',
    [...failed.map(j => `${j.name}: failed ${j.failures} times; last worked at ${j.last_success_at ? new Date(j.last_success_at).toISOString() : 'never'}`), ...otherFailures.map(h => `${h.name}: last worked at ${h.lastSuccessAt ?? 'never'}`), ...expiry.map(k => `${k.keyName}: expires ${k.expiresOn}`)].join(' · ') || 'No repeated failures, stale feeds or keys within 14 days of expiry.', '');
  for (const notice of facts.noticeDetails) if (notice.kind === 'channel_short') add(notice.source_id, 'Orders by channel', 'tripped', `${notice.detail.channel}: stored ${notice.detail.stored}, ShopifyQL ${notice.detail.reported}, ${notice.detail.from}–${notice.detail.to}. Check app access in Shopify Dev Dashboard; marketplace scope is decided by the live check.`);
  return checks;
}
export async function updateObservation(db: Database, mode: SourceMode, facts: Facts, now: Date): Promise<Observation> {
  const previous = await db.query<{ data: Observation }>('SELECT data FROM pulse.shopify_watchdog_state WHERE mode = $1', [mode]);
  const day = ukToday(now);
  const row = facts.records.find(r => r.kind === 'sessions' && r.data.day === day);
  const next = observe(previous.rows[0]?.data ?? blankObservation(), row?.data, row?.fetched_at, now);
  await db.query(`INSERT INTO pulse.shopify_watchdog_state (mode, fetched_at, data) VALUES ($1, $2, $3)
    ON CONFLICT (mode) DO UPDATE SET fetched_at = EXCLUDED.fetched_at, data = EXCLUDED.data`, [mode, now, JSON.stringify(next)]);
  return next;
}
