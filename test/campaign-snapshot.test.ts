import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac, randomBytes } from 'node:crypto';
import type { Database } from '../src/db.js';
import { createApp } from '../src/app.js';
import { readRuntime } from '../src/runtime.js';
import { readSettings, saveSettings } from '../src/settings.js';
import { saveMetaCampaigns } from '../src/ad-spend/store.js';
import { createTestDatabase } from './helpers/database.js';

test('dashboard snapshots reuse campaign rows and refresh after catalogue and owner saves', async t => {
  const db = await createTestDatabase();
  let reads = 0, rejectCampaigns = false;
  const observed: Database = { ...db, query: (sql, values) => {
    if (/SELECT[\s\S]*FROM pulse\.meta_campaigns/i.test(sql)) {
      reads++;
      if (rejectCampaigns) throw Object.assign(new Error('Invented private database detail'), { code: 'XX000' });
    }
    return db.query(sql, values);
  } };
  const config = readRuntime({ DATABASE_URL: 'postgresql://localhost/pulse_test', APP_ORIGIN: 'https://pulse.example.test' });
  const app = await createApp(observed, config, { META_ACCESS_TOKEN: randomBytes(24).toString('hex') });
  t.after(async () => { await app.close(); await db.close(); });
  const secret = (await db.query<{ value: Uint8Array }>('SELECT value FROM pulse_private.app_secrets WHERE name = $1', ['session_hmac'])).rows[0]!;
  const token = randomBytes(32).toString('base64url'), credential = randomBytes(32).toString('base64url');
  const hash = createHmac('sha256', Buffer.from(secret.value)).update(token).digest('hex');
  await db.query('INSERT INTO pulse_private.credentials(id, public_key) VALUES ($1, $2)', [credential, randomBytes(32)]);
  await db.query("INSERT INTO pulse_private.sessions(token_hash, credential_id, expires_at) VALUES ($1, $2, now() + interval '30 days')", [hash, credential]);
  const initial = await readSettings(observed), account = '900000000701';
  await saveSettings(observed, { ...initial, values: { ...initial.values, metaAdAccountId: account } }, credential);
  const campaign = { id: '900000000702', name: 'Invented sample discovery', status: 'ACTIVE', createdAt: '2026-10-01T10:00:00Z' };
  await saveMetaCampaigns(observed, account, [campaign], new Date('2026-10-10T11:00:00Z'));
  const headers = { cookie: `__Host-pulse_session=${token}`, origin: config.origin };
  const snapshot = async () => {
    const response = await app.inject({ url: '/api/dashboard', headers });
    assert.equal(response.statusCode, 200);
    return response.json();
  };
  const before = await snapshot();
  await snapshot(); await snapshot();
  assert.equal(reads, 1);
  assert.equal(before.metaCampaigns.unconfirmedCount, 1);
  const current = await readSettings(observed);
  const saved = await app.inject({ method: 'POST', url: '/api/settings', headers, payload: { ...current, values: { ...current.values, metaOwners: [{ campaignId: campaign.id, owner: 'ours' }] } } });
  assert.equal(saved.statusCode, 200);
  assert.equal((await snapshot()).metaCampaigns.unconfirmedCount, 0);
  assert.equal(reads, 2);
  await saveMetaCampaigns(observed, account, [{ ...campaign, name: 'Invented renamed discovery' }], new Date('2026-10-10T11:30:00Z'));
  await snapshot();
  assert.equal(reads, 3);
  await saveMetaCampaigns(observed, account, [], new Date('2026-10-10T12:00:00Z'));
  const logs: string[] = [];
  t.mock.method(console, 'error', (message: string) => logs.push(message));
  rejectCampaigns = true;
  const after = await snapshot();
  assert.deepEqual(after.hero, before.hero);
  assert.equal(after.metaCampaigns.unconfirmedCount, 0);
  assert.deepEqual(logs, ['Meta campaign summary failed (code: XX000).']);
  const latest = await readSettings(observed);
  await saveSettings(observed, { ...latest, values: { ...latest.values, metaAdAccountId: '900000000703' } }, credential);
  assert.equal((await snapshot()).metaCampaigns, undefined, 'a failed lookup on a new account cannot reuse the old account badge');
});
