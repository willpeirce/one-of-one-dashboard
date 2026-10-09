import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { MetaSpend } from '../src/ad-spend/clients.js';
import { AdError, type MetaCampaign, type SpendRow } from '../src/ad-spend/model.js';
import { readMetaCampaigns, sampleSpend, saveMetaCampaigns, saveSpend, spendFacts } from '../src/ad-spend/store.js';
import { SpendWorker } from '../src/ad-spend/worker.js';
import { defaultSettings, readSettings, saveSettings } from '../src/settings.js';
import { syncSourceHealth } from '../src/sources.js';
import { createTestDatabase } from './helpers/database.js';

const now = new Date('2026-10-09T12:00:00Z');
const fixture = async () => JSON.parse(await readFile(new URL('fixtures/meta/campaigns.json', import.meta.url), 'utf8'));
const env = () => ({ META_ACCESS_TOKEN: randomBytes(16).toString('hex') });
const settings = () => ({ ...defaultSettings(), metaAdAccountId: '9000000000' });
const response = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const campaigns = async (): Promise<MetaCampaign[]> => (await fixture()).data.map((row: any) => ({
  id: row.id, name: row.name, status: row.effective_status, createdAt: new Date(row.created_time).toISOString(),
}));

test('Meta campaign reads follow every cursor on the fixed read-only edge, including campaigns with no spend', async () => {
  const data = (await fixture()).data, seen: URL[] = [];
  const client = new MetaSpend(randomBytes(16).toString('hex'), {
    sleep: async () => {},
    fetch: async (url, init) => {
      const request = new URL(String(url));
      seen.push(request);
      assert.equal(init?.method, 'GET');
      assert.equal(request.hostname, 'graph.facebook.com');
      assert.equal(request.pathname, '/v25.0/act_9000000000/campaigns');
      assert.equal(request.searchParams.get('fields'), 'id,name,effective_status,created_time');
      assert.equal(request.searchParams.has('access_token'), false);
      // Meta's Campaign.EffectiveStatus is narrower than the ad/ad-set status enums.
      assert.deepEqual(JSON.parse(request.searchParams.get('effective_status')!).sort(), [
        'ACTIVE', 'ARCHIVED', 'DELETED', 'IN_PROCESS', 'PAUSED', 'WITH_ISSUES',
      ]);
      return response(seen.length === 1
        ? { data: data.slice(0, 2), paging: { next: 'https://untrusted.example.test/ignored', cursors: { after: 'sample-next' } } }
        : { data: data.slice(2) });
    },
  });
  assert.deepEqual(await client.readCampaigns('9000000000'), await campaigns());
  assert.equal(seen.length, 2);
  assert.equal(seen[1]!.searchParams.get('after'), 'sample-next');
  const invalid = new MetaSpend(randomBytes(16).toString('hex'), {
    sleep: async () => {},
    fetch: async () => response({ data: [], paging: { next: 'ignored', cursors: { after: 'repeated' } } }),
  });
  await assert.rejects(invalid.readCampaigns('9000000000'), AdError);
});

test('campaign upserts preserve first seen and missing rows, scope the account and confirm default Ours through audited Settings', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  const s = settings(), e = env(), initial = await campaigns();
  await saveMetaCampaigns(db, s.metaAdAccountId, initial, now);
  const first = await readMetaCampaigns(db, s, e);
  assert.deepEqual(first.map((row) => row.id), ['900000000603', '900000000602', '900000000601']);
  assert.ok(first.every((row) => row.owner === 'ours' && !row.confirmed && row.mode === 'live'));
  assert.equal((await db.query('SELECT * FROM pulse.ad_spend')).rowCount, 0, 'campaign visibility does not depend on spend');
  const later = new Date('2026-10-09T12:30:00Z');
  const changed = { ...initial[0]!, name: 'Invented Aurora renamed', status: 'ARCHIVED' };
  await saveMetaCampaigns(db, s.metaAdAccountId, [changed, changed], later);
  const next = await readMetaCampaigns(db, s, e);
  assert.equal(next.length, 3);
  const updated = next.find((row) => row.id === changed.id)!;
  assert.equal(updated.name, changed.name);
  assert.equal(updated.status, 'ARCHIVED');
  assert.equal(updated.firstSeen, now.toISOString());
  assert.equal(updated.lastSeen, later.toISOString());
  assert.equal(next.find((row) => row.id === initial[1]!.id)!.lastSeen, now.toISOString());
  await saveMetaCampaigns(db, s.metaAdAccountId, [], later);
  assert.equal((await readMetaCampaigns(db, s, e)).length, 3);
  assert.deepEqual(await readMetaCampaigns(db, { ...s, metaAdAccountId: '9000000001' }, e), []);

  const current = await readSettings(db);
  const saved = await saveSettings(db, {
    version: current.version,
    values: { ...s, metaOwners: [{ campaignId: initial[0]!.id, owner: 'ours' }] },
  }, randomUUID());
  const confirmed = await readMetaCampaigns(db, saved.values, e);
  assert.equal(confirmed.find((row) => row.id === initial[0]!.id)!.confirmed, true);
  assert.equal(confirmed.filter((row) => !row.confirmed).length, 2);
  assert.ok(saved.changedFields.includes('metaOwners.0.owner'));
  assert.ok((await db.query<{ field: string }>('SELECT field FROM pulse.settings_changes')).rows.some((row) => row.field === 'metaOwners.0.owner'));
});

test('one read-time owner rule moves every stored day both ways and preserves rules for campaigns no longer returned', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  const s = settings(), e = env(), credential = randomUUID(), campaign = (await campaigns())[0]!;
  await saveMetaCampaigns(db, s.metaAdAccountId, [campaign], now);
  const rows: SpendRow[] = ['2026-09-28', '2026-09-29', '2026-09-30'].map((day) => ({
    source: 'meta', accountId: s.metaAdAccountId, campaignId: campaign.id, campaignName: campaign.name,
    adSetId: '900000000701', adSetName: 'Invented Aurora audience', owner: 'freelancer', market: 'uk',
    day, amount: '2.500000', currency: 'GBP',
  }));
  await saveSpend(db, 'meta', s.metaAdAccountId, '2026-09-28', '2026-09-30', rows, now);
  const initial = await readSettings(db);
  let saved = await saveSettings(db, { version: initial.version, values: s }, credential);
  const history = async () => (await spendFacts(db, (await readSettings(db)).values, e, 'live', '2026-09-28', '2026-09-30')).rows;
  assert.deepEqual((await history()).map((row) => row.owner), ['ours', 'ours', 'ours']);
  for (const owner of ['freelancer', 'ours'] as const) {
    saved = await saveSettings(db, {
      version: saved.version,
      values: { ...saved.values, metaOwners: [{ campaignId: campaign.id, owner }] },
    }, credential);
    assert.equal((await history()).length, 3);
    assert.ok((await history()).every((row) => row.owner === owner));
    assert.ok(saved.changedFields.includes('metaOwners.0.owner'));
  }
  assert.ok((await db.query<{ owner: string }>('SELECT owner FROM pulse.ad_spend')).rows.every((row) => row.owner === 'freelancer'), 'fetch-time labels are never rewritten or used as effective ownership');
  await saveMetaCampaigns(db, s.metaAdAccountId, [], new Date(now.getTime() + 30 * 60_000));
  assert.deepEqual((await readSettings(db)).values.metaOwners, [{ campaignId: campaign.id, owner: 'ours' }]);
  assert.equal((await readMetaCampaigns(db, saved.values, e))[0]!.confirmed, true);
});

test('Meta worker refreshes the catalogue once per actual poll, outside backfill chunks, and keeps no-spend campaigns', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  const s = settings(), e = env(), body = await fixture();
  await syncSourceHealth(db, e);
  await db.query('INSERT INTO pulse.settings(values) VALUES($1)', [JSON.stringify(s)]);
  let clock = now, catalogueReads = 0, spendReads = 0;
  const worker = new SpendWorker(db, e, {
    clock: () => clock,
    sleep: async () => {},
    log: () => {},
    fetch: async (url, init) => {
      const request = new URL(String(url));
      assert.equal(init?.method, 'GET');
      if (request.pathname.endsWith('/campaigns')) { catalogueReads++; return response(body); }
      if (request.pathname.endsWith('/insights')) { spendReads++; return response({ data: [] }); }
      return response({ currency: 'GBP', timezone_name: 'Europe/London' });
    },
  });
  t.after(() => worker.stop());
  const first = worker.tick('meta');
  assert.equal(worker.tick('meta'), first);
  await first;
  assert.equal(catalogueReads, 1);
  assert.equal(spendReads, 5, 'current range plus four bounded backfill chunks');
  assert.equal((await readMetaCampaigns(db, s, e)).length, 3);
  assert.equal((await db.query('SELECT * FROM pulse.ad_spend')).rowCount, 0);
  await worker.tick('meta');
  assert.equal(catalogueReads, 1, 'timer ticks inside the poll window make no source calls');
  clock = new Date(now.getTime() + 30 * 60_000);
  await worker.tick('meta');
  assert.equal(catalogueReads, 2);
});

test('sample campaigns are three invented rows with one unconfirmed and no unrelated saved data', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  const s = { ...defaultSettings(), metaOwners: [{ campaignId: '900000000999', owner: 'freelancer' as const }] };
  const initial = await readMetaCampaigns(db, s, {});
  assert.equal(initial.length, 3);
  assert.equal(initial.filter((row) => !row.confirmed).length, 1);
  assert.ok(initial.every((row) => row.mode === 'sample' && row.name.startsWith('Invented ')));
  assert.equal(JSON.stringify(initial).includes('900000000999'), false);
  const spend = sampleSpend('2026-09-30', '2026-09-30').rows.filter((row) => row.source === 'meta');
  assert.ok(spend.every((row) => initial.some((campaign) => campaign.id === row.campaignId)));
  assert.equal(spend.some((row) => row.campaignId === '900000000603'), false);
  const saved = await saveSettings(db, {
    version: (await readSettings(db)).version,
    values: { ...s, metaOwners: [...s.metaOwners, { campaignId: '900000000603', owner: 'ours' }] },
  }, randomUUID());
  assert.equal((await readMetaCampaigns(db, saved.values, {})).filter((row) => !row.confirmed).length, 0);
  const changedOwner = {
    ...saved.values,
    metaOwners: [...saved.values.metaOwners, { campaignId: '900000000601', owner: 'freelancer' as const }],
  };
  const history = await spendFacts(db, changedOwner, {}, 'sample', '2026-09-28', '2026-09-30');
  assert.ok(history.rows.filter((row) => row.campaignId === '900000000601').every((row) => row.owner === 'freelancer'));
  assert.equal(history.rows.filter((row) => row.campaignId === '900000000601').length, 6);
});
