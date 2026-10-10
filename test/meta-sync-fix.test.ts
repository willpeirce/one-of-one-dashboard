import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { MetaSpend } from '../src/ad-spend/clients.js';
import { AdTransport } from '../src/ad-spend/http.js';
import { AdError, adErrorCode } from '../src/ad-spend/model.js';
import { readMetaCampaigns, saveMetaCampaigns, spendFacts } from '../src/ad-spend/store.js';
import { SpendWorker } from '../src/ad-spend/worker.js';
import { defaultSettings } from '../src/settings.js';
import { syncSourceHealth } from '../src/sources.js';
import { createTestDatabase } from './helpers/database.js';

const now = new Date('2026-10-10T12:00:00Z');
const settings = () => ({ ...defaultSettings(), metaAdAccountId: '9000000000' });
const env = () => ({ META_ACCESS_TOKEN: randomBytes(16).toString('hex') });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
});
const campaign = {
  id: '900000000801', name: 'Invented Birch campaign', effective_status: 'ACTIVE',
  created_time: '2026-10-01T10:00:00+0000',
};
const failure = {
  error: {
    code: 100, error_subcode: 1487694,
    message: 'invented-private-message https://example.test/private 9000000000',
  },
};

test('campaign failure follows committed spend, preserves the list and leaves Meta live with a fresh fetch', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  const s = settings(), e = env(), requests: string[] = [], logs: string[] = [];
  t.mock.method(console, 'error', (line: string) => logs.push(line));
  await syncSourceHealth(db, e);
  await db.query('INSERT INTO pulse.settings(values) VALUES($1)', [JSON.stringify(s)]);
  await db.query('INSERT INTO pulse.ad_spend_jobs(source,account_id,backfill_done) VALUES ($1,$2,true)', ['meta', s.metaAdAccountId]);
  await saveMetaCampaigns(db, s.metaAdAccountId, [{
    id: campaign.id, name: campaign.name, status: campaign.effective_status,
    createdAt: '2026-10-01T10:00:00.000Z',
  }], new Date('2026-10-09T12:00:00Z'));
  const before = await readMetaCampaigns(db, s, e);
  const worker = new SpendWorker(db, e, {
    clock: () => now, sleep: async () => {}, log: () => {},
    fetch: async (url) => {
      const path = new URL(String(url)).pathname;
      requests.push(path.split('/').at(-1)!);
      if (path.endsWith('/campaigns')) {
        const health = (await db.query<{ status: string }>("SELECT status FROM pulse.source_health WHERE source='meta'")).rows[0]!;
        assert.equal(health.status, 'healthy', 'money state is committed before the secondary read');
        assert.equal((await db.query('SELECT * FROM pulse.ad_spend')).rowCount, 1);
        return response(failure, 400);
      }
      if (path.endsWith('/insights')) return response({ data: [{
        campaign_id: campaign.id, campaign_name: 'Invented Birch UK',
        adset_id: '900000000802', adset_name: 'Invented Birch audience',
        date_start: '2026-10-10', spend: '12.500000',
      }] });
      return response({ currency: 'GBP', timezone_name: 'Europe/London' });
    },
  });
  t.after(() => worker.stop());
  await worker.tick('meta');
  assert.deepEqual(requests, ['act_9000000000', 'insights', 'campaigns']);
  const health = (await db.query<{ mode: string; status: string; last_success_at: Date | string; consecutive_failures: number }>(
    "SELECT mode,status,last_success_at,consecutive_failures FROM pulse.source_health WHERE source='meta'",
  )).rows[0]!;
  assert.equal(health.mode, 'live');
  assert.equal(health.status, 'healthy');
  assert.equal(new Date(health.last_success_at).toISOString(), now.toISOString());
  assert.equal(health.consecutive_failures, 0);
  const facts = await spendFacts(db, s, e, 'live', '2026-10-10', '2026-10-10');
  assert.equal(facts.sources.find((source) => source.source === 'meta')!.status, 'live');
  assert.equal(facts.rows[0]!.amount, '12.500000');
  assert.deepEqual(await readMetaCampaigns(db, s, e), before);
  assert.deepEqual(logs, ['Meta campaigns read failed (http 400, meta 100/1487694).']);
  assert.ok(!logs.join('').includes('private') && !logs.join('').includes('https://') && !logs.join('').includes(s.metaAdAccountId));
});

test('spend failure stays unavailable even when the independent campaign read succeeds', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  const s = settings(), e = env(), logs: string[] = [], requests: string[] = [];
  t.mock.method(console, 'error', (line: string) => logs.push(line));
  await syncSourceHealth(db, e);
  await db.query('INSERT INTO pulse.settings(values) VALUES($1)', [JSON.stringify(s)]);
  const worker = new SpendWorker(db, e, {
    clock: () => now, sleep: async () => {}, log: () => {},
    fetch: async (url) => {
      const path = new URL(String(url)).pathname;
      requests.push(path.split('/').at(-1)!);
      return path.endsWith('/campaigns') ? response({ data: [campaign] }) : response(failure, 400);
    },
  });
  t.after(() => worker.stop());
  await worker.tick('meta');
  assert.deepEqual(requests, ['act_9000000000', 'campaigns']);
  const health = (await db.query<{ status: string; last_success_at: null; consecutive_failures: number }>(
    "SELECT status,last_success_at,consecutive_failures FROM pulse.source_health WHERE source='meta'",
  )).rows[0]!;
  assert.equal(health.status, 'error');
  assert.equal(health.last_success_at, null);
  assert.equal(health.consecutive_failures, 1);
  assert.equal((await spendFacts(db, s, e, 'live', '2026-10-10', '2026-10-10')).sources[0]!.status, 'source unavailable');
  assert.equal((await readMetaCampaigns(db, s, e))[0]!.name, campaign.name);
  assert.deepEqual(logs, ['Ad spend meta failed (http 400, meta 100/1487694).']);
});

test('one malformed campaign is counted and skipped while good rows are saved', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  const logs: string[] = [];
  t.mock.method(console, 'info', (line: string) => logs.push(line));
  const client = new MetaSpend(randomBytes(16).toString('hex'), {
    sleep: async () => {},
    fetch: async () => response({ data: [campaign, { ...campaign, name: 'x'.repeat(301) }] }),
  });
  const rows = await client.readCampaigns(settings().metaAdAccountId);
  await saveMetaCampaigns(db, settings().metaAdAccountId, rows, now);
  assert.deepEqual((await readMetaCampaigns(db, settings(), env())).map((row) => row.name), [campaign.name]);
  assert.deepEqual(logs, ['Meta campaigns skipped 1 invalid rows.']);
});

test('campaign validation skips bad identifiers, names, unknown statuses and invalid calendar timestamps', async (t) => {
  const logs: string[] = [];
  t.mock.method(console, 'info', (line: string) => logs.push(line));
  const invalid = [
    { ...campaign, id: 'bad/id' }, { ...campaign, id: '' },
    { ...campaign, name: '' }, { ...campaign, name: '   ' },
    { ...campaign, effective_status: 'UNRECOGNISED' },
    { ...campaign, created_time: 'not-a-date' },
    { ...campaign, created_time: '2026-02-30T10:00:00+0000' },
    { ...campaign, created_time: '2026-10-01T24:00:00+0000' }, null,
  ];
  const client = new MetaSpend(randomBytes(16).toString('hex'), {
    sleep: async () => {}, fetch: async () => response({ data: [campaign, ...invalid] }),
  });
  assert.equal((await client.readCampaigns(settings().metaAdAccountId)).length, 1);
  assert.deepEqual(logs, [`Meta campaigns skipped ${invalid.length} invalid rows.`]);
});

test('provider errors retain only safe numeric HTTP/provider codes, including Google and TikTok', async () => {
  const cases = [
    { source: 'meta' as const, status: 400, body: failure, expected: 'http 400, meta 100/1487694' },
    { source: 'google-ads' as const, status: 403, body: { error: { code: 403, message: failure.error.message } }, expected: 'unauthorized, http 403, google 403' },
    { source: 'tiktok' as const, status: 400, body: { code: 40002, message: failure.error.message }, expected: 'http 400, tiktok 40002' },
    { source: 'meta' as const, status: 400, body: { error: { code: 'private-code', error_subcode: 'private-subcode', message: failure.error.message } }, expected: 'http 400' },
  ];
  for (const entry of cases) {
    const transport = new AdTransport(entry.source, {
      sleep: async () => {}, fetch: async () => response(entry.body, entry.status),
    });
    await assert.rejects(transport.request('https://example.test/invented-source'), (error: unknown) => {
      assert.ok(error instanceof AdError);
      assert.equal(adErrorCode(error, entry.source), entry.expected);
      assert.ok(!JSON.stringify(error).includes('private'));
      assert.ok(!error.message.includes('private'));
      return true;
    });
  }
  assert.equal(adErrorCode(new Error(failure.error.message), 'meta'), 'unknown');
  assert.equal(adErrorCode(new AdError('http', 400, NaN, Infinity), 'meta'), 'http 400');
});

test('Meta rate limiting keeps the actual HTTP code while preserving retries', async () => {
  let requests = 0;
  const transport = new AdTransport('meta', {
    sleep: async () => {},
    fetch: async () => { requests++; return response({ error: { code: 4, error_subcode: 99 } }, 400); },
  });
  await assert.rejects(transport.request('https://example.test/invented-source'), (error: unknown) => {
    assert.equal(adErrorCode(error, 'meta'), 'rate_limit, http 400, meta 4/99');
    return true;
  });
  assert.equal(requests, 4);
});
