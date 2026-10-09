import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { defaultSettings } from '../src/settings.js';
import { appConfig } from '../src/config.js';
import { getSourceStates, readSourceHealth, sourceDefinitions, syncSourceHealth } from '../src/sources.js';
import { createTestDatabase } from './helpers/database.js';

test('every planned source is registered once, using only its section 1 key names', () => {
  assert.deepEqual(Object.fromEntries(sourceDefinitions.map((source) => [source.id, [...source.requiredKeys]])), {
    shopify: ['SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET'],
    meta: ['META_ACCESS_TOKEN'],
    'google-ads': ['GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_REFRESH_TOKEN'],
    tiktok: ['TIKTOK_ACCESS_TOKEN'],
    mailchimp: ['MAILCHIMP_API_KEY'],
    'github-hq': ['GITHUB_HQ_TOKEN'],
    gorgias: ['GORGIAS_DOMAIN', 'GORGIAS_EMAIL', 'GORGIAS_API_KEY'],
    judgeme: ['JUDGEME_API_TOKEN'],
    discord: ['DISCORD_BOT_TOKEN'],
    ugc: ['UGC_FEED_TOKEN'],
    anthropic: ['ANTHROPIC_API_KEY'],
  });
  assert.equal(new Set(sourceDefinitions.map(({ id }) => id)).size, sourceDefinitions.length);
});

test('each source needs all of its own nonblank keys; another source stays independent', () => {
  for (const source of sourceDefinitions) {
    const env: NodeJS.ProcessEnv = {};
    const generatedValues: string[] = [];
    for (const key of source.requiredKeys) {
      const value = randomUUID();
      generatedValues.push(value);
      env[key] = value;
    }
    const states = getSourceStates(env);
    const state = states.find(({ source: id }) => id === source.id)!;
    assert.equal(state.mode, 'live');
    assert.equal(state.status, 'not_implemented');
    assert.deepEqual(state.missingKeys, []);
    assert.ok(states.filter(({ source: id }) => id !== source.id).every(({ mode, status }) =>
      mode === 'sample' && status === 'waiting_for_keys'));
    for (const value of generatedValues) assert.equal(JSON.stringify(states).includes(value), false);

    for (const key of source.requiredKeys) {
      for (const absent of [undefined, '', ' \n\t ']) {
        const incomplete = getSourceStates({ ...env, [key]: absent }).find(({ source: id }) => id === source.id)!;
        assert.equal(incomplete.mode, 'sample');
        assert.equal(incomplete.status, 'waiting_for_keys');
        assert.deepEqual(incomplete.missingKeys, [key]);
      }
    }
  }
});

test('infrastructure credentials do not activate a source', () => {
  const states = getSourceStates({ DATABASE_URL: randomUUID(), DASHBOARD_SETUP_CODE: randomUUID() });
  assert.ok(states.every(({ mode, status }) => mode === 'sample' && status === 'waiting_for_keys'));
});

test('.env.example contains every required name and no values', async () => {
  const example = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
  const entries = example.trim().split('\n');
  assert.ok(entries.every((line) => /^[A-Z][A-Z0-9_]*=$/.test(line)));
  const names = new Set(entries.map((line) => line.slice(0, -1)));
  for (const source of sourceDefinitions) {
    for (const key of source.requiredKeys) assert.ok(names.has(key), `Missing key name: ${key}`);
  }
  for (const key of ['DATABASE_URL', 'TEST_DATABASE_URL', 'DASHBOARD_SETUP_CODE', 'APP_ORIGIN', 'HOST', 'PORT', 'NODE_ENV']) {
    assert.ok(names.has(key), `Missing infrastructure name: ${key}`);
  }
});

test('public config keeps the stock exclusions, owner split and unresolved mappings explicit', () => {
  const stockIds: readonly string[] = appConfig.shopify.stockProducts.map(({ id }) => id);
  assert.ok(appConfig.shopify.tiktokOrderOnlyProductIds.every((id) => !stockIds.includes(id)));
  const defaults=defaultSettings();
  assert.equal(defaults.metaAdAccountId,'');assert.equal(defaults.googleCustomerId,'');assert.equal(defaults.googleLoginCustomerId,'');assert.equal(defaults.tiktokAdvertiserId,'');
  assert.deepEqual(defaults.metaOwners,[]);assert.deepEqual(defaults.expectedGoogleCampaigns,[]);
  assert.equal(appConfig.mailchimp.unresolvedUtmEmails.length, 2);
  assert.ok(appConfig.mailchimp.unresolvedUtmEmails.every(({ flowId }) => flowId === '3354'));
  assert.equal(appConfig.judgeme.publishEnabled, false);
  assert.equal(appConfig.dashboard.hostnameConfirmed, false);
});

test('source health persists rows without credentials and resets freshness only on a mode change', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  await syncSourceHealth(db, {});
  const initial = await readSourceHealth(db);
  assert.equal(initial.length, sourceDefinitions.length);
  assert.ok(initial.every((row) => row.mode === 'sample' && row.status === 'waiting_for_keys'));
  assert.ok(initial.every((row) => row.lastSuccessAt === null && row.lastAttemptAt === null));

  const env: NodeJS.ProcessEnv = { SHOPIFY_CLIENT_ID: randomUUID(), SHOPIFY_CLIENT_SECRET: randomUUID() };
  await syncSourceHealth(db, env);
  const live = (await readSourceHealth(db)).find(({ source }) => source === 'shopify')!;
  assert.equal(live.mode, 'live');
  assert.equal(live.status, 'not_implemented');
  assert.equal(live.lastSuccessAt, null);
  assert.equal((await readSourceHealth(db)).filter(({ mode }) => mode === 'sample').length, sourceDefinitions.length-1);

  await db.query(`UPDATE pulse.source_health
    SET last_success_at = '2026-09-30T12:00:00Z', last_attempt_at = '2026-09-30T13:00:00Z',
        status = 'error', consecutive_failures = 2 WHERE source = 'shopify'`);
  await syncSourceHealth(db, env);
  const restarted = (await readSourceHealth(db)).find(({ source }) => source === 'shopify')!;
  assert.equal(restarted.status, 'not_implemented');
  assert.equal(restarted.lastSuccessAt?.toISOString(), '2026-09-30T12:00:00.000Z');
  assert.equal(restarted.lastAttemptAt?.toISOString(), '2026-09-30T13:00:00.000Z');
  assert.equal(restarted.consecutiveFailures, 2);
  const stored = await db.query('SELECT * FROM pulse.source_health');
  for (const value of Object.values(env)) assert.equal(JSON.stringify(stored.rows).includes(value!), false);

  await syncSourceHealth(db, {});
  const removed = (await readSourceHealth(db)).find(({ source }) => source === 'shopify')!;
  assert.equal(removed.mode, 'sample');
  assert.equal(removed.status, 'waiting_for_keys');
  assert.equal(removed.lastSuccessAt, null);
  assert.equal(removed.lastAttemptAt, null);
  assert.equal(removed.consecutiveFailures, 0);
  assert.equal((await readSourceHealth(db)).length, sourceDefinitions.length);
});
