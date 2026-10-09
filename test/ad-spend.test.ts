import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import {
  defaultSettings,
  validateSettings,
  SettingsValidationError,
  readSettings,
} from '../src/settings.js';
import {
  AdError,
  aggregateHours,
  decimalMicros,
  microsDecimal,
  hourDay,
  marketFor,
  ownerFor,
  adSources,
  type SpendRow,
} from '../src/ad-spend/model.js';
import {
  parseMeta,
  parseGoogle,
  parseTikTok,
  MetaSpend,
  GoogleSpend,
  TikTokSpend,
  type SpendReader,
} from '../src/ad-spend/clients.js';
import { AdTransport } from '../src/ad-spend/http.js';
import { saveSpend, spendFacts, sampleSpend, readJobs } from '../src/ad-spend/store.js';
import { applySpend, spendNeeds } from '../src/ad-spend/metrics.js';
import { SpendWorker } from '../src/ad-spend/worker.js';
import { createTestDatabase } from './helpers/database.js';
import { syncSourceHealth } from '../src/sources.js';
import { buildHeroRange } from '../src/hero-range.js';
import { fixture as shopifyFixture } from '../src/shopify/sample.js';
import { cleanOrder, type Order } from '../src/shopify/model.js';
import { createApp } from '../src/app.js';
import { readRuntime } from '../src/runtime.js';
import { ShopifyWorker } from '../src/shopify/worker.js';
const fixture = async (source: string, name: string) =>
  JSON.parse(await readFile(new URL(`fixtures/${source}/${name}.json`, import.meta.url), 'utf8'));
const settings = () => ({
  ...defaultSettings(),
  metaAdAccountId: '9000000000',
  googleCustomerId: '9000000000',
  tiktokAdvertiserId: '9000000000',
  metaOwners: [{ campaignId: '900000000001', owner: 'ours' as const }],
});
const env = () =>
  Object.fromEntries(
    [
      'META_ACCESS_TOKEN',
      'GOOGLE_ADS_CLIENT_ID',
      'GOOGLE_ADS_CLIENT_SECRET',
      'GOOGLE_ADS_REFRESH_TOKEN',
      'TIKTOK_ACCESS_TOKEN',
    ].map((k) => [k, randomBytes(16).toString('hex')]),
  );
const now = new Date('2026-10-09T12:00:00Z');
const response = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

test('API-shaped invented fixtures parse exact spend, owners and market names/targets', async () => {
  const s = settings(),
    meta = parseMeta(
      await fixture('meta', 'insights'),
      s.metaAdAccountId,
      'GBP',
      'Europe/London',
      s,
      { '900000000102': ['US'] },
    );
  assert.equal(meta[0]!.amount, '48.200000');
  assert.equal(meta[0]!.owner, 'ours');
  assert.equal(meta[1]!.owner, 'unassigned');
  assert.equal(meta[1]!.market, 'us');
  const google = parseGoogle(await fixture('google-ads', 'spend'), s.googleCustomerId, 'GBP', s, {
    '900000000202': ['US'],
  });
  assert.equal(google[0]!.day, '2026-09-30');
  assert.equal(google[0]!.amount, '70.000001');
  assert.equal(google[1]!.owner, 'freelancer');
  assert.equal(google[1]!.market, 'us');
  const tiktok = parseTikTok(await fixture('tiktok', 'spend'), s.tiktokAdvertiserId, 'GBP', s);
  assert.equal(tiktok[0]!.market, 'uk');
  assert.equal(tiktok[0]!.amount, '12.400000');
  assert.equal(microsDecimal(decimalMicros('999999999999.990001')), '999999999999.990001');
  for (const value of ['nan', '1e4', '-1', '1.1234567'])
    assert.throws(() => decimalMicros(value), AdError);
  assert.equal(marketFor(['Invented US']), 'us');
  assert.equal(marketFor(['Invented UK']), 'uk');
  assert.equal(marketFor(['RUSSELL']), 'unknown');
  assert.equal(marketFor(['Invented'], ['GB']), 'uk');
  assert.equal(marketFor(['Invented'], ['US']), 'us');
  assert.equal(marketFor(['Invented'], ['US', 'GB']), 'unknown');
  assert.equal(ownerFor('meta', 'invented-missing', s), 'unassigned');
  assert.equal(ownerFor('google-ads', 'invented-missing', s), 'freelancer');
});

test('GMT hour rebucketing preserves repeated/skipped UK hours and both adjacent dates', () => {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    hourCycle: 'h23',
  });
  assert.equal(formatter.format(new Date('2026-10-25T00:00:00Z')), '01');
  assert.equal(formatter.format(new Date('2026-10-25T01:00:00Z')), '01');
  assert.equal(formatter.format(new Date('2027-03-28T00:00:00Z')), '00');
  assert.equal(formatter.format(new Date('2027-03-28T01:00:00Z')), '02');
  const row = (day: string, hour: number): SpendRow => ({
    source: 'google-ads',
    accountId: 'sample-account',
    campaignId: 'sample-campaign',
    campaignName: 'Invented UK',
    adSetId: null,
    adSetName: null,
    market: 'uk',
    owner: 'freelancer',
    day: hourDay(day, hour),
    amount: '1.000000',
    currency: 'GBP',
  });
  const fall = [
    row('2026-10-24', 23),
    ...Array.from({ length: 24 }, (_, hour) => row('2026-10-25', hour)),
  ];
  assert.equal(aggregateHours(fall, '2026-10-25', '2026-10-25')[0]!.amount, '25.000000');
  const spring = Array.from({ length: 24 }, (_, hour) => row('2027-03-28', hour));
  const days = aggregateHours(spring, '2027-03-28', '2027-03-29');
  assert.equal(days.find((r) => r.day === '2027-03-28')!.amount, '23.000000');
  assert.equal(days.find((r) => r.day === '2027-03-29')!.amount, '1.000000');
  assert.equal(hourDay('2027-03-29', 23), '2027-03-30');
  assert.equal(hourDay('2026-09-30', 17, 'America/New_York'), '2026-09-30');
  assert.equal(hourDay('2026-09-30', 18, 'America/New_York'), '2026-09-30');
  assert.equal(hourDay('2026-09-30', 19, 'America/New_York'), '2026-10-01');
  assert.throws(() => hourDay('2026-02-30', 1), AdError);
});

test('Settings start blank, strip Google dashes, validate identifiers and never accept key values', () => {
  const defaults = defaultSettings();
  assert.equal(defaults.metaAdAccountId, '');
  assert.deepEqual(defaults.metaOwners, []);
  assert.deepEqual(defaults.expectedGoogleCampaigns, []);
  const saved = validateSettings({
    ...defaults,
    googleCustomerId: '900-000-0000',
    googleLoginCustomerId: '900-000-0001',
    metaAdAccountId: '9000000000',
    tiktokAdvertiserId: '9000000000',
    expectedGoogleCampaigns: [{ campaignId: '900000000201' }],
  });
  assert.equal(saved.googleCustomerId, '9000000000');
  assert.equal(saved.googleLoginCustomerId, '9000000001');
  for (const field of [
    'metaAdAccountId',
    'googleCustomerId',
    'googleLoginCustomerId',
    'tiktokAdvertiserId',
  ])
    assert.throws(
      () => validateSettings({ ...defaults, [field]: 'private-invalid-value' }),
      SettingsValidationError,
    );
  assert.throws(
    () =>
      validateSettings({
        ...defaults,
        expectedGoogleCampaigns: [{ campaignId: '900001' }, { campaignId: '900001' }],
      }),
    SettingsValidationError,
  );
});

test('Meta and TikTok clients GET only, safely paginate and Meta targeting resolves unnamed campaigns', async () => {
  const s = settings(),
    seen: { url: URL; method: string }[] = [],
    metaBody = await fixture('meta', 'insights');
  let insightPage = 0;
  const meta = new MetaSpend(randomBytes(16).toString('hex'), {
    sleep: async () => {},
    fetch: async (url, init) => {
      const u = new URL(String(url));
      seen.push({ url: u, method: init?.method ?? 'GET' });
      if (u.pathname.endsWith('/insights'))
        return response(
          ++insightPage === 1
            ? {
                ...metaBody,
                paging: {
                  next: 'https://untrusted.example.test/ignore',
                  cursors: { after: 'sample-cursor' },
                },
              }
            : { data: [] },
        );
      if (u.searchParams.get('fields') === 'targeting')
        return response(await fixture('meta', 'targeting'));
      return response(await fixture('meta', 'account'));
    },
  });
  const rows = await meta.read(s.metaAdAccountId, '2026-09-30', '2026-09-30', s);
  assert.equal(rows.length, 2);
  assert.equal(rows[1]!.market, 'us');
  assert.equal(insightPage, 2);
  assert.ok(
    seen.every(
      (r) =>
        r.method === 'GET' &&
        r.url.hostname === 'graph.facebook.com' &&
        !r.url.searchParams.has('access_token'),
    ),
  );
  let pages = 0;
  const tik = new TikTokSpend(randomBytes(16).toString('hex'), {
    sleep: async () => {},
    fetch: async (url, init) => {
      assert.equal(init?.method, 'GET');
      const u = new URL(String(url));
      assert.equal(u.hostname, 'business-api.tiktok.com');
      if (u.pathname.includes('/advertiser/info/'))
        return response(await fixture('tiktok', 'advertiser'));
      assert.deepEqual(JSON.parse(u.searchParams.get('dimensions')!), [
        'campaign_id',
        'stat_time_hour',
      ]);
      const body = await fixture('tiktok', 'spend');
      pages++;
      return response({
        ...body,
        data: {
          ...body.data,
          list: pages === 1 ? body.data.list : [],
          page_info: { total_page: 2 },
        },
      });
    },
  });
  assert.equal(
    (await tik.read(s.tiktokAdvertiserId, '2026-09-30', '2026-09-30', s))[0]!.amount,
    '12.400000',
  );
  assert.equal(pages, 2);
});

test('Google uses OAuth and fixed searchStream reads without a developer token; preserves micros', async () => {
  const s = { ...settings(), googleLoginCustomerId: '9000000001' },
    e = env(),
    requests: string[] = [];
  const google = new GoogleSpend(e, {
    sleep: async () => {},
    fetch: async (url, init) => {
      const u = new URL(String(url));
      requests.push(u.pathname);
      assert.equal(init?.method, 'POST');
      if (u.hostname === 'oauth2.googleapis.com')
        return response({ access_token: randomBytes(16).toString('hex'), expires_in: 3600 });
      assert.ok(u.pathname.endsWith('/googleAds:searchStream'));
      const headers = new Headers(init?.headers);
      assert.equal(headers.has('developer-token'), false);
      assert.equal(headers.get('login-customer-id'), s.googleLoginCustomerId);
      const { query } = JSON.parse(String(init?.body));
      assert.ok(!/mutate/i.test(query));
      return response(
        await fixture(
          'google-ads',
          query.includes('FROM customer')
            ? 'customer'
            : query.includes('FROM campaign_criterion')
              ? 'locations'
              : query.includes('FROM geo_target_constant')
                ? 'geo'
                : 'spend',
        ),
      );
    },
  });
  const rows = await google.read(s.googleCustomerId, '2026-09-30', '2026-09-30', s);
  assert.equal(rows[0]!.amount, '70.000001');
  assert.equal(rows[1]!.market, 'us');
  assert.equal(requests.length, 5);
  await google.read(s.googleCustomerId, '2026-09-30', '2026-09-30', s);
  assert.equal(requests.length, 6, 'metadata and access token are reused');
});

test('transport retries throttles and reports only request ids/status; rejected developer-token requirement stays safe', async () => {
  let calls = 0;
  const delays: number[] = [],
    logs: unknown[] = [];
  const http = new AdTransport('tiktok', {
    sleep: async (ms) => {
      delays.push(ms);
    },
    log: (entry) => logs.push(entry),
    fetch: async () =>
      ++calls < 3 ? response({ code: 40100 }, 429, { 'retry-after': '1' }) : response({ code: 0 }),
  });
  await http.request('https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/');
  assert.equal(calls, 3);
  assert.ok(delays.some((d) => d >= 1000));
  assert.ok(!JSON.stringify(logs).includes('token'));
  const rejected = new GoogleSpend(env(), {
    sleep: async () => {},
    fetch: async (url) =>
      String(url).includes('/token')
        ? response({ access_token: randomBytes(16).toString('hex'), expires_in: 3600 })
        : response(
            {
              error: {
                details: [
                  {
                    errors: [
                      {
                        errorCode: { authenticationError: 'DEVELOPER_TOKEN_REQUIRED' },
                        message: 'invented-private-error',
                      },
                    ],
                  },
                ],
              },
            },
            403,
          ),
  });
  await assert.rejects(
    rejected.read('9000000000', '2026-09-30', '2026-09-30', settings()),
    (error) =>
      error instanceof AdError &&
      error.code === 'developer_token_required' &&
      !error.message.includes('private'),
  );
});

test('replace fetches are idempotent, clear restated rows, isolate accounts and retain exact decimals', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  const s = settings(),
    e = env();
  await syncSourceHealth(db, e);
  await db.query(
    'INSERT INTO pulse.ad_spend_jobs(source,account_id,last_success_at) VALUES ($1,$2,$3)',
    ['google-ads', s.googleCustomerId, now],
  );
  const rows = aggregateHours(
    parseGoogle(await fixture('google-ads', 'spend'), s.googleCustomerId, 'GBP', s),
    '2026-09-30',
    '2026-09-30',
  );
  for (let i = 0; i < 2; i++)
    await saveSpend(db, 'google-ads', s.googleCustomerId, '2026-09-30', '2026-09-30', rows, now);
  assert.equal((await db.query('SELECT * FROM pulse.ad_spend')).rowCount, 2);
  const facts = await spendFacts(db, s, e, 'live', '2026-09-30', '2026-09-30');
  assert.equal(facts.rows[0]!.amount, '70.000001');
  await saveSpend(
    db,
    'google-ads',
    s.googleCustomerId,
    '2026-09-30',
    '2026-09-30',
    rows.slice(0, 1),
    now,
  );
  assert.equal((await db.query('SELECT * FROM pulse.ad_spend')).rowCount, 1);
  assert.equal(
    (
      await spendFacts(
        db,
        { ...s, googleCustomerId: '9000000001' },
        e,
        'live',
        '2026-09-30',
        '2026-09-30',
      )
    ).rows.length,
    0,
  );
  await saveSpend(
    db,
    'google-ads',
    s.googleCustomerId,
    '2026-09-30',
    '2026-09-30',
    rows.map((r) => ({ ...r, currency: 'USD' })),
    now,
  );
  assert.ok(
    (
      await db.query<{ spend_gbp: string | null }>('SELECT spend_gbp FROM pulse.ad_spend')
    ).rows.every((r) => r.spend_gbp === null),
  );
  assert.equal((await spendFacts(db, s, {}, 'live', '2026-09-30', '2026-09-30')).rows.length, 0);
  assert.ok(
    (await spendFacts(db, s, e, 'sample', '2026-09-30', '2026-09-30')).rows.every(
      (r) => r.accountId.startsWith('sample-') && r.currency === 'GBP',
    ),
  );
});

test('poll and bounded backfill resume from the committed chunk after failure, without concurrent source runs', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  const s = settings(),
    e = env();
  await syncSourceHealth(db, e);
  await db.query('INSERT INTO pulse.settings(values) VALUES($1)', [JSON.stringify(s)]);
  const ranges: string[] = [],
    logs: string[] = [];
  let fail = true;
  const reader: SpendReader = {
    read: async (_account, from, to) => {
      ranges.push(`${from}:${to}`);
      if (from === '2026-08-21' && fail) throw new AdError('http');
      return [];
    },
  };
  t.mock.method(console, 'error', (line: string) => logs.push(line));
  let clock = now;
  const worker = new SpendWorker(db, e, { clock: () => clock, readers: { meta: reader } });
  t.after(() => worker.stop());
  const first = worker.tick('meta');
  assert.equal(worker.tick('meta'), first);
  await first;
  assert.equal((await readJobs(db))[0]!.backfill_next, '2026-08-21');
  assert.equal((await readJobs(db))[0]!.failures, 1);
  assert.ok(logs.length);
  fail = false;
  clock = new Date(now.getTime() + 30 * 60_000);
  await worker.tick('meta');
  assert.equal(ranges.filter((r) => r.startsWith('2026-08-07:')).length, 1);
  assert.equal((await readJobs(db))[0]!.backfill_done, true);
  const calls = ranges.length;
  await worker.tick('meta');
  assert.equal(ranges.length, calls);
});

function hero() {
  return buildHeroRange(
    [
      {
        date: '2026-09-30',
        net: 100,
        o: 2,
        uk: 1,
        us: 1,
        sess: 10,
        ukS: 5,
        ukM: 0,
        usM: 0,
        g: 0,
        ours: 0,
      },
    ],
    '2026-09-30',
    '2026-09-30',
    { today: '2026-10-09', blendedMetaTripwireGbp: 28 },
  );
}

test('totals reconcile owners, partial sources label honestly, foreign and unknown markets stay separate, ratios stay finite', async () => {
  const s = settings(),
    spend = sampleSpend('2026-09-30', '2026-09-30');
  spend.mode = 'live';
  spend.sources = spend.sources.map((source) => ({
    ...source,
    live: source.source === 'meta',
    ready: source.source === 'meta',
    status: source.source === 'meta' ? 'live' : 'waiting for keys',
  }));
  spend.rows = spend.rows.filter((r) => r.source === 'meta');
  spend.rows.push({
    ...spend.rows[0]!,
    campaignId: 'sample-unassigned',
    owner: 'unassigned',
    market: 'unknown',
    amount: '10.000000',
  });
  spend.rows.push({
    ...spend.rows[0]!,
    campaignId: 'sample-usd',
    currency: 'USD',
    amount: '1000.000000',
  });
  const o = cleanOrder((await shopifyFixture('order')).data.order) as Order;
  o.day = '2026-09-30';
  o.market = 'UK';
  const h = hero();
  h.orders.n = 1;
  applySpend(h, [o], s, '2026-10-09', { spend, costs: [], estimates: [] });
  assert.equal(h.spend.n, 550.2);
  assert.match(h.spend.ss, /Meta only; Google and TikTok waiting for keys/);
  assert.equal(h.ukcpo.t, '£300.20');
  assert.match(h.ukcpo.d.why, /10.00.*not split/);
  const splits = h.spend.d
    .extra!.slice(0, 3)
    .reduce((total, [, value]) => total + Number(value.slice(1)), 0);
  assert.equal(splits, h.spend.n);
  assert.equal(h.roas.n, 100 / 550.2);
  assert.match(h.margin.ss, /left out/);
  assert.equal(
    spendNeeds(spend, s, '2026-10-09').filter((n) => n.id.startsWith('ad-owner')).length,
    1,
  );
  assert.equal(
    spendNeeds(spend, s, '2026-10-09').filter((n) => n.id.startsWith('ad-currency')).length,
    1,
  );
  const partialHistory = hero();
  applySpend(partialHistory, [o], s, '2026-10-09', { spend, costs: [], estimates: [] });
  assert.equal(partialHistory.ukcpo.t, '—');
  assert.match(partialHistory.ukcpo.d.why, /no denominator is guessed/);
  assert.match(partialHistory.margin.ss, /older order cost detail/);
  const empty = hero();
  empty.net.n = 0;
  applySpend(empty, [], s, '2026-10-09', { spend, costs: [], estimates: [] });
  assert.equal(empty.roas.unavailable, true);
  assert.equal(empty.margin.unavailable, true);
  assert.ok(Number.isFinite(empty.roas.n) && Number.isFinite(empty.margin.n));
  const zero = hero();
  const zeroSpend = { ...spend, rows: [] };
  applySpend(zero, [], s, '2026-10-09', { spend: zeroSpend, costs: [], estimates: [] });
  assert.equal(zero.roas.unavailable, true);
  assert.ok(Number.isFinite(zero.margin.n));
  assert.equal(zero.margin.unavailable, true);
  assert.equal(zero.margin.unavailableLabel, '—');
});

test('known costs feed margin, discounts are not subtracted twice and missing expected campaigns only flag fetched complete days', async () => {
  const s = {
      ...settings(),
      paymentFeePercent: 2,
      startingCogs: [{ sku: 'sample-margin', unitCostGbp: 10 }],
      expectedGoogleCampaigns: [{ campaignId: '900000000201' }],
    },
    o = cleanOrder((await shopifyFixture('order')).data.order) as Order;
  o.day = '2026-09-30';
  o.lines = [{ ...o.lines[0]!, sku: 'sample-margin', quantity: 1, variantId: null }];
  const spend = sampleSpend('2026-09-30', '2026-09-30');
  spend.rows = [{ ...spend.rows[0]!, amount: '20.000000' }];
  const h = hero();
  applySpend(h, [o], s, '2026-10-09', {
    spend,
    costs: [],
    estimates: [{ orderId: o.id, costPence: 500, source: 'exact' }],
  });
  assert.equal(h.margin.n, 63);
  assert.match(h.margin.d.rule, /not subtracted twice/);
  spend.mode = 'live';
  const needs = spendNeeds(spend, s, '2026-10-09');
  assert.equal(needs.filter((n) => n.id.startsWith('ad-expected')).length, 1);
  assert.equal(
    spendNeeds(
      { ...spend, days: [{ source: 'google-ads', day: '2026-10-08' }] },
      s,
      '2026-10-09',
    ).filter((n) => n.id.startsWith('ad-expected')).length,
    0,
  );
});

test('ad polling starts after listen; a throwing source cannot delay startup or fail health', async (t) => {
  const db = await createTestDatabase(),
    s = settings(),
    e = env();
  await db.query('INSERT INTO pulse.settings(values) VALUES($1)', [JSON.stringify(s)]);
  t.mock.method(ShopifyWorker.prototype, 'start', () => {});
  const logs: string[] = [];
  t.mock.method(console, 'error', (line: string) => logs.push(line));
  let calls = 0;
  const reader: SpendReader = {
    read: async () => {
      calls++;
      throw new AdError('http');
    },
  };
  const config = readRuntime({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://localhost/pulse_test',
    APP_ORIGIN: 'http://localhost:3000',
  });
  const app = await createApp(
    db,
    config,
    e,
    {},
    { clock: () => now, readers: { meta: reader, 'google-ads': reader, tiktok: reader } },
  );
  t.after(async () => {
    await app.close();
    await db.close();
  });
  // These env values only determine readiness, and no real network call is made.
  assert.equal(calls, 0);
  await app.listen({ host: '127.0.0.1', port: 0 });
  assert.equal(calls, 0);
  await app.startBackgroundWork();
  assert.equal((await app.inject('/health')).statusCode, 200);
  await app.close();
  assert.equal(calls, 3);
  assert.equal(logs.filter((line) => line.startsWith('Ad spend')).length, 3);
  const health = (
    await db.query<{ status: string }>(
      'SELECT status FROM pulse.source_health WHERE source=ANY($1::text[])',
      [[...adSources]],
    )
  ).rows;
  assert.ok(health.every((row) => row.status === 'error'));
});

test('Google quota counts actual attempts, survives restart and resets on the next UTC day with a cached reader', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  const s = settings(),
    e = env();
  await syncSourceHealth(db, e);
  await db.query('INSERT INTO pulse.settings(values) VALUES($1)', [JSON.stringify(s)]);
  await db.query(
    "INSERT INTO pulse.ad_spend_jobs(source,account_id,operations_day,operations) VALUES ('google-ads',$1,'2026-10-09',199)",
    [s.googleCustomerId],
  );
  let clock = now,
    queries = 0;
  t.mock.method(console, 'error', () => {});
  const fetcher: typeof fetch = async (input, init) => {
    if (String(input).includes('oauth2'))
      return response({ access_token: randomBytes(16).toString('hex'), expires_in: 3600 });
    queries++;
    const query = JSON.parse(String(init?.body)).query as string;
    return query.includes('FROM customer')
      ? response(await fixture('google-ads', 'customer'))
      : response([{ results: [] }]);
  };
  const options = {
    clock: () => clock,
    now: () => clock.getTime(),
    fetch: fetcher,
    sleep: async () => {},
    log: () => {},
  };
  const worker = new SpendWorker(db, e, options);
  t.after(() => worker.stop());
  await worker.tick('google-ads');
  assert.equal(queries, 1);
  clock = new Date(now.getTime() + 30 * 60_000);
  const restarted = new SpendWorker(db, e, options);
  await restarted.tick('google-ads');
  await restarted.stop();
  assert.equal(queries, 1);
  clock = new Date('2026-10-10T12:00:00Z');
  await worker.tick('google-ads');
  assert.ok(queries > 1);
  const quota = (
    await db.query<{ day: string; operations: number }>(
      'SELECT operations_day::text AS day,operations FROM pulse.ad_spend_jobs',
    )
  ).rows[0]!;
  assert.equal(quota.day, '2026-10-10');
  assert.ok(quota.operations < 20);
});

test('non-London Meta hourly rows and omitted Google protobuf zero fields are valid', async () => {
  const s = settings(),
    body = await fixture('meta', 'insights');
  body.data = [
    {
      ...body.data[0],
      date_start: '2026-09-29',
      hourly_stats_aggregated_by_advertiser_time_zone: '19:00:00 - 19:59:59',
    },
  ];
  assert.equal(
    parseMeta(body, s.metaAdAccountId, 'GBP', 'America/New_York', s)[0]!.day,
    '2026-09-30',
  );
  const google = await fixture('google-ads', 'spend');
  delete google[0].results[0].segments.hour;
  google[0].results[0].metrics = {};
  assert.equal(parseGoogle(google, s.googleCustomerId, 'GBP', s)[0]!.amount, '0.000000');
});
