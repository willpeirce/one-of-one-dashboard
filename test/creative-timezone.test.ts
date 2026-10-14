import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { MetaSpend, parseMeta } from '../src/ad-spend/clients.js';
import { AdError } from '../src/ad-spend/model.js';
import { MetaCreativeClient } from '../src/creatives/client.js';
import { defaultSettings } from '../src/settings.js';
import type { AdInsight, CatalogueRead } from '../src/creatives/model.js';

// Every identifier, date, number and API response in these tests is invented.
const accountId = 'invented-clock-account';
const dailyFields = ['ad_id', 'adset_id', 'date_start', 'reach', 'frequency', 'video_avg_time_watched_actions'];
const perHour = { spend: 1.25, impressions: 100, linkClicks: 5, threeSecondPlays: 7, plays: 11,
  thruPlays: 3, plays25: 9, plays50: 6, plays75: 4, plays100: 2, addsToCart: 4, purchases: .5, purchaseValue: 7.75 } as const;
const action = (value: number, actionType = 'video_view') => [{ action_type: actionType, value: String(value) }];
function hourly(day: string, hour: number, scale = 1, adId = 'invented-clock-ad'): Record<string, unknown> {
  const time = String(hour).padStart(2, '0');
  return { ad_id: adId, adset_id: `invented-set-${adId}`, date_start: day,
    hourly_stats_aggregated_by_advertiser_time_zone: `${time}:00:00 - ${time}:59:59`,
    spend: String(perHour.spend * scale), impressions: String(perHour.impressions * scale),
    inline_link_clicks: String(perHour.linkClicks * scale),
    actions: [...action(perHour.threeSecondPlays * scale), ...action(perHour.addsToCart * scale, 'omni_add_to_cart'), ...action(perHour.purchases * scale, 'omni_purchase')],
    action_values: action(perHour.purchaseValue * scale, 'omni_purchase'),
    video_play_actions: action(perHour.plays * scale), video_thruplay_watched_actions: action(perHour.thruPlays * scale),
    video_p25_watched_actions: action(perHour.plays25 * scale), video_p50_watched_actions: action(perHour.plays50 * scale),
    video_p75_watched_actions: action(perHour.plays75 * scale), video_p100_watched_actions: action(perHour.plays100 * scale),
    // Deliberate extra provider fields must never become summed hourly reach or means.
    reach: '98765', frequency: '77', video_avg_time_watched_actions: action(99) };
}
function daily(day: string, adId = 'invented-clock-ad'): Record<string, unknown> {
  return { ad_id: adId, adset_id: `invented-set-${adId}`, date_start: day, reach: '444', frequency: '2.25',
    video_avg_time_watched_actions: action(4.5),
    spend: '9999', impressions: '9999', actions: action(99, 'omni_purchase'), action_values: action(9999, 'omni_purchase') };
}
function mock(zone: string, dailyRows: Record<string, unknown>[], hourlyRows: Record<string, unknown>[], currency = 'GBP') {
  const requests: { url: URL; method: string | undefined; timeoutMs: number | undefined }[] = [], logs: unknown[] = [];
  const timeouts = new WeakMap<AbortSignal, number>();
  const token = `invented-${randomBytes(16).toString('hex')}`;
  const options = { sleep: async () => {}, log: (entry: unknown) => logs.push(entry),
    timeoutSignal: (ms: number) => { const signal = new AbortController().signal; timeouts.set(signal, ms); return signal; }, fetch: (async (input, init) => {
    const url = new URL(String(input)); requests.push({ url, method: init?.method, timeoutMs: init?.signal ? timeouts.get(init.signal) : undefined });
    let body: unknown;
    if (url.pathname.endsWith(`/act_${accountId}`)) body = { currency, timezone_name: zone };
    else if (url.pathname.endsWith('/ads')) body = { data: [] };
    else if (url.pathname.endsWith('/insights') && url.searchParams.get('level') === 'account') body = { data: [{ frequency: '3.1', impressions: '3100', reach: '1000' }] };
    else if (url.pathname.endsWith('/insights')) body = { data: url.searchParams.has('breakdowns') ? hourlyRows : dailyRows };
    else throw new Error('Unexpected invented endpoint');
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', 'x-fb-trace-id': token } });
  }) as typeof fetch };
  const client = new MetaCreativeClient(new MetaSpend(token, options), options);
  return { client, requests, token, logs };
}
function assertAdditive(row: AdInsight, hours: number) {
  for (const [key, amount] of Object.entries(perHour)) assert.equal(row[key as keyof typeof perHour], amount * hours, `${key} follows the UK hours only`);
}
function assertSpendAlignment(hourlyRows: Record<string, unknown>[], insights: AdInsight[], zone: string, from: string, to: string) {
  const spent = parseMeta({ data: hourlyRows.map(row => ({ ...row, campaign_id: 'invented-clock-campaign', campaign_name: 'Invented UK discovery', adset_name: 'Invented UK set' })) }, accountId, 'GBP', zone, defaultSettings());
  const adSets = new Map<string, number>(), ads = new Map<string, number>();
  for (const row of spent.filter(row => row.day >= from && row.day <= to)) {
    const key = `${row.adSetId}:${row.day}`;
    adSets.set(key, (adSets.get(key) ?? 0) + Number(row.amount));
  }
  for (const row of insights) {
    const key = `${row.adSetId}:${row.day}`;
    ads.set(key, (ads.get(key) ?? 0) + row.spend);
  }
  assert.deepEqual([...ads].sort(), [...adSets].sort(), 'Ad-day sums use the same UK boundaries as the hero’s Meta ad-set spend');
}
function assertClockRequests(requests: { url: URL; timeoutMs: number | undefined }[], from: string, to: string, paddedFrom: string, paddedTo: string) {
  const reports = requests.filter(request => request.url.pathname.endsWith('/insights'));
  assert.equal(reports.length, 2, 'One daily audience read and one hourly additive read');
  assert.ok(reports.every(request => request.timeoutMs === 60_000), 'Daily and hourly insights both get sixty seconds');
  assert.equal(requests.find(request => request.url.pathname.endsWith(`/act_${accountId}`))!.timeoutMs, 10_000);
  const hourlyRequest = reports.find(request => request.url.searchParams.has('breakdowns'))!.url;
  const dailyRequest = reports.find(request => !request.url.searchParams.has('breakdowns'))!.url;
  assert.equal(hourlyRequest.searchParams.get('breakdowns'), 'hourly_stats_aggregated_by_advertiser_time_zone');
  assert.equal(hourlyRequest.searchParams.get('level'), 'ad');
  assert.equal(hourlyRequest.searchParams.get('time_increment'), '1');
  assert.deepEqual(JSON.parse(hourlyRequest.searchParams.get('time_range')!), { since: paddedFrom, until: paddedTo });
  assert.deepEqual(JSON.parse(dailyRequest.searchParams.get('time_range')!), { since: from, until: to });
  assert.deepEqual(dailyRequest.searchParams.get('fields')!.split(',').sort(), [...dailyFields].sort());
  for (const field of ['reach', 'frequency', 'video_avg_time_watched_actions']) assert.ok(!hourlyRequest.searchParams.get('fields')!.split(',').includes(field), `${field} is never requested hourly`);
}

test('GMT creatives include all 25 UK hours at the autumn clock change and trim the padded dates', async () => {
  const rows = ['2026-10-24', '2026-10-25', '2026-10-26'].flatMap(day => Array.from({ length: 24 }, (_, hour) => hourly(day, hour)));
  const api = mock('GMT', [daily('2026-10-25')], rows);
  const result = await api.client.readInsights(accountId, '2026-10-25', '2026-10-25');
  assert.equal(result.length, 1); assert.equal(result[0]!.day, '2026-10-25');
  assertAdditive(result[0]!, 25);
  assertSpendAlignment(rows, result, 'GMT', '2026-10-25', '2026-10-25');
  assert.equal(result[0]!.reach, 444); assert.equal(result[0]!.frequency, 2.25); assert.equal(result[0]!.averagePlayTime, 4.5);
  assertClockRequests(api.requests, '2026-10-25', '2026-10-25', '2026-10-24', '2026-10-26');
  assert.ok(api.requests.every(request => request.method === 'GET'));
  assert.ok(!JSON.stringify([result, api.logs, api.requests.map(request => request.url.toString())]).includes(api.token));
});

test('GMT creatives include 23 UK hours at the spring clock change with no repeated or fabricated hour', async () => {
  const rows = ['2027-03-27', '2027-03-28', '2027-03-29'].flatMap(day => Array.from({ length: 24 }, (_, hour) => hourly(day, hour)));
  const api = mock('GMT', [daily('2027-03-28')], rows);
  const result = await api.client.readInsights(accountId, '2027-03-28', '2027-03-28');
  assert.equal(result.length, 1); assert.equal(result[0]!.day, '2027-03-28');
  assertAdditive(result[0]!, 23);
  assertSpendAlignment(rows, result, 'GMT', '2027-03-28', '2027-03-28');
  assert.equal(result[0]!.reach, 444); assert.equal(result[0]!.frequency, 2.25); assert.equal(result[0]!.averagePlayTime, 4.5);
  assertClockRequests(api.requests, '2027-03-28', '2027-03-28', '2027-03-27', '2027-03-29');
});

test('a non-UK IANA zone rebuckets the hours before midnight and keeps different ads separate', async () => {
  const api = mock('America/New_York', [daily('2026-09-30'), daily('2026-09-30', 'invented-other-ad')], [
    hourly('2026-09-29', 18, 100), // UK 23:00 on the previous date.
    hourly('2026-09-29', 19, 2),   // UK 00:00 on the requested date.
    hourly('2026-09-30', 18, 3),   // UK 23:00 on the requested date.
    hourly('2026-09-30', 19, 100), // UK 00:00 on the following date.
    hourly('2026-09-30', 12, 4, 'invented-other-ad'),
  ]);
  const result = await api.client.readInsights(accountId, '2026-09-30', '2026-09-30');
  assert.equal(result.length, 2);
  assertAdditive(result.find(row => row.adId === 'invented-clock-ad')!, 5);
  assertAdditive(result.find(row => row.adId === 'invented-other-ad')!, 4);
  assert.ok(result.every(row => row.day === '2026-09-30' && row.reach === 444 && row.frequency === 2.25 && row.averagePlayTime === 4.5));
  assertClockRequests(api.requests, '2026-09-30', '2026-09-30', '2026-09-29', '2026-10-01');
});

test('rebucketing preserves daily-only audience rows and hourly-only additive rows without inventing audience totals', async () => {
  const api = mock('GMT', [daily('2026-09-30', 'invented-daily-only')], [hourly('2026-09-29', 23, 2, 'invented-hourly-only')]);
  const result = await api.client.readInsights(accountId, '2026-09-30', '2026-09-30');
  assert.equal(result.length, 2);
  const audience = result.find(row => row.adId === 'invented-daily-only')!;
  assertAdditive(audience, 0); assert.equal(audience.reach, 444); assert.equal(audience.frequency, 2.25); assert.equal(audience.averagePlayTime, 4.5);
  const additive = result.find(row => row.adId === 'invented-hourly-only')!;
  assertAdditive(additive, 2); assert.equal(additive.reach, 0); assert.equal(additive.frequency, 0); assert.equal(additive.averagePlayTime, 0);
});

test('each UK ad day uses true three-second plays when any hour reports them and otherwise sums the two-second fallback', async () => {
  for (const example of [
    { label: 'One hour omits its zero video_view action', direct: 7, expected: 7, source: 'video_view' },
    { label: 'All hours omit video_view', direct: null, expected: 5, source: 'video_continuous_2_sec_watched_actions' },
    { label: 'An explicit zero video_view still takes precedence', direct: 0, expected: 0, source: 'video_view' },
  ]) {
    const first = hourly('2026-09-29', 23), second = hourly('2026-09-30', 0);
    const conversions = [...action(4, 'omni_add_to_cart'), ...action(.5, 'omni_purchase')];
    first.actions = [...conversions, ...(example.direct === null ? [] : action(example.direct))];
    first.video_continuous_2_sec_watched_actions = action(3);
    second.actions = conversions;
    second.video_continuous_2_sec_watched_actions = action(2);
    const api = mock('GMT', [daily('2026-09-30')], [first, second]);
    const result = await api.client.readInsights(accountId, '2026-09-30', '2026-09-30');
    assert.equal(result[0]!.threeSecondPlays, example.expected, example.label);
    assert.equal(result[0]!.threeSecondSource, example.source, example.label);
  }
});

test('Europe/London keeps the single daily-report path and account metadata is cached for subsequent reads', async () => {
  const source: Record<string, unknown> = { ...hourly('2026-10-25', 2), reach: '444', frequency: '2.25', video_avg_time_watched_actions: action(4.5) };
  delete source.hourly_stats_aggregated_by_advertiser_time_zone;
  const api = mock('Europe/London', [source], []);
  const result = await api.client.readInsights(accountId, '2026-10-25', '2026-10-25');
  assert.equal(result.length, 1); assertAdditive(result[0]!, 1);
  const report = api.requests.filter(request => request.url.pathname.endsWith('/insights'));
  assert.equal(report.length, 1); assert.equal(report[0]!.url.searchParams.has('breakdowns'), false);
  assert.equal(report[0]!.timeoutMs, 60_000);
  assert.equal(report[0]!.url.searchParams.get('time_increment'), '1');
  assert.equal(result[0]!.reach, 444); assert.equal(result[0]!.frequency, 2.25); assert.equal(result[0]!.averagePlayTime, 4.5);
  await api.client.readInsights(accountId, '2026-10-25', '2026-10-25');
  assert.equal(api.requests.filter(request => request.url.pathname.endsWith(`/act_${accountId}`)).length, 1);
});

test('GBP GMT catalogue and exact frequency reads are allowed, with frequency retaining account-day dates', async () => {
  const api = mock('GMT', [], []);
  const entries: CatalogueRead[] = [];
  for await (const page of api.client.readCatalogue(accountId, defaultSettings(), new Date('2026-10-13T12:00:00Z'))) entries.push(...page);
  assert.deepEqual(entries, []);
  assert.equal(await api.client.readFrequency(accountId, ['invented-clock-ad'], '2026-10-07', '2026-10-13'), 3.1);
  assert.equal(api.requests.find(request => request.url.pathname.endsWith('/insights'))!.timeoutMs, 60_000);
  const report = api.requests.find(request => request.url.pathname.endsWith('/insights'))!.url;
  assert.equal(report.searchParams.get('level'), 'account'); assert.equal(report.searchParams.has('breakdowns'), false);
  assert.equal(report.searchParams.has('time_increment'), false);
  assert.deepEqual(JSON.parse(report.searchParams.get('time_range')!), { since: '2026-10-07', until: '2026-10-13' });
  assert.equal(api.requests.filter(request => request.url.pathname.endsWith(`/act_${accountId}`)).length, 1);
});

test('foreign currency and invalid timezone metadata fail safely before an insight report', async () => {
  for (const [zone, currency] of [['GMT', 'USD'], ['Europe/London', 'EUR'], ['Invented/Not_A_Zone', 'GBP']]) {
    const api = mock(zone!, [], [], currency!);
    await assert.rejects(api.client.readInsights(accountId, '2026-10-12', '2026-10-13'), error => error instanceof AdError && !error.message.includes(api.token));
    assert.equal(api.requests.filter(request => request.url.pathname.endsWith('/insights')).length, 0);
  }
});
