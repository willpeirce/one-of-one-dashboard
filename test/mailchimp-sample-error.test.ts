import assert from 'node:assert/strict';
import test from 'node:test';
import { promises as fs } from 'node:fs';
import { createHmac, randomBytes } from 'node:crypto';
import { createApp } from '../src/app.js';
import { appConfig } from '../src/config.js';
import { ukToday } from '../src/hero-range.js';
import { readRuntime } from '../src/runtime.js';
import { readMailchimpFacts } from '../src/mailchimp/store.js';
import { createTestDatabase } from './helpers/database.js';

// A separate test process exercises the first sample read without resetting its process cache.
test('unreadable Mailchimp fixtures stay unavailable and Home, hero and Sources never return 500', async t => {
  const originalRead = fs.readFile, messages: string[] = [];
  let fixtureReads = 0;
  t.mock.method(fs, 'readFile', (path: unknown, ...args: unknown[]) => {
    if (path instanceof URL && path.pathname.includes('/fixtures/mailchimp/')) {
      fixtureReads++;
      return Promise.reject(new Error('Invented fixture read failure'));
    }
    return Reflect.apply(originalRead, fs, [path, ...args]);
  });
  t.mock.method(console, 'error', (message: string) => messages.push(message));
  const db = await createTestDatabase();
  const config = readRuntime({DATABASE_URL: 'postgresql://localhost/pulse_test', APP_ORIGIN: 'https://pulse.example.test'});
  const app = await createApp(db, config);
  t.after(async () => { await app.close(); await db.close(); });
  const secret = (await db.query<{value: Uint8Array}>("SELECT value FROM pulse_private.app_secrets WHERE name='session_hmac'")).rows[0]!;
  const token = randomBytes(32).toString('base64url'), credentialId = randomBytes(32).toString('base64url');
  const hash = createHmac('sha256', Buffer.from(secret.value)).update(token).digest('hex');
  await db.query('INSERT INTO pulse_private.credentials(id,public_key) VALUES($1,$2)', [credentialId, randomBytes(32)]);
  await db.query("INSERT INTO pulse_private.sessions(token_hash,credential_id,expires_at) VALUES($1,$2,now()+interval '30 days')", [hash, credentialId]);
  const headers = {cookie: `__Host-pulse_session=${token}`};
  const day = ukToday(new Date(appConfig.shopify.sampleNow));
  for (const url of ['/', `/api/hero?from=${day}&to=${day}`, '/sources', '/api/dashboard']) {
    const response = await app.inject({url, headers});
    assert.equal(response.statusCode, 200, url);
    assert.match(response.body, /Unavailable · Mailchimp sample data could not be read/);
    assert.doesNotMatch(response.body, /Invented fixture read failure/);
  }
  const unavailable = await readMailchimpFacts(db, 'sample', new Date());
  assert.deepEqual(unavailable, {mode: 'sample', status: 'unavailable', fetchedAt: null, audience: null,
    flowCoverage: 'unknown', campaigns: [], reports: [], orders: []});
  assert.equal(fixtureReads, 4, 'the failed first load is retained across every route and later read');
  assert.deepEqual(messages, ['Mailchimp sample data unavailable (code: fixture).']);
});
