import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import test from 'node:test';
import { createApp } from '../src/app.js';
import type { Database } from '../src/db.js';
import { readRuntime } from '../src/runtime.js';
import { MORNING_DAY_COOKIE, opensMorning, readMorningFirst } from '../src/morning/entry.js';
import { createTestDatabase } from './helpers/database.js';

test('Morning entry uses the UK calendar day and any query string bypasses it', () => {
  const now = new Date('2032-04-07T08:00:00Z');
  assert.equal(opensMorning(false, undefined, '/', now), false);
  assert.equal(opensMorning(true, undefined, '/', now), true);
  assert.equal(opensMorning(true, '2032-04-07', '/', now), false);
  assert.equal(opensMorning(true, '2032-04-06', '/', now), true);
  for (const url of ['/?from=morning', '/?', '/?anything=1', '/morning'])
    assert.equal(opensMorning(true, undefined, url, now), false);
  for (const [before, after, marker] of [
    ['2032-06-10T22:59:00Z', '2032-06-10T23:01:00Z', '2032-06-10'],
    ['2032-12-10T23:59:00Z', '2032-12-11T00:01:00Z', '2032-12-10'],
  ]) {
    assert.equal(opensMorning(true, marker, '/', new Date(before!)), false);
    assert.equal(opensMorning(true, marker, '/', new Date(after!)), true);
  }
});

test('Morning first reads only its boolean and never seeds a missing Settings row', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  assert.equal(await readMorningFirst(db), false);
  assert.equal((await db.query('SELECT 1 FROM pulse.settings')).rows.length, 0);
  for (const [value, expected] of [[{}, false], [{morningOpensFirst: false}, false], [{morningOpensFirst: true}, true]]) {
    await db.query('INSERT INTO pulse.settings(values) VALUES($1) ON CONFLICT(singleton) DO UPDATE SET values=EXCLUDED.values', [JSON.stringify(value)]);
    assert.equal(await readMorningFirst(db), expected);
  }
});

test('signed-in Morning serves the eighth shell and the daily redirect is fast, temporary and loop-free', async t => {
  const db = await createTestDatabase(), queries: string[] = [];
  let capture = false, now = new Date('2032-06-10T22:59:00Z');
  const observed: Database = { ...db, query(sql, values) { if (capture) queries.push(sql); return db.query(sql, values); } };
  const config = readRuntime({ DATABASE_URL: 'postgresql://localhost/pulse_morning_entry', APP_ORIGIN: 'https://pulse.example.test' });
  const app = await createApp(observed, config, {}, {}, {}, {}, {}, {clock: () => now});
  t.after(async () => { await app.close(); await db.close(); });
  const secret = (await db.query<{value: Uint8Array}>("SELECT value FROM pulse_private.app_secrets WHERE name='session_hmac'")).rows[0]!;
  const token = randomBytes(32).toString('base64url'), credential = randomBytes(32).toString('base64url');
  await db.query('INSERT INTO pulse_private.credentials(id,public_key) VALUES($1,$2)', [credential, randomBytes(32)]);
  await db.query("INSERT INTO pulse_private.sessions(token_hash,credential_id,expires_at) VALUES($1,$2,now()+interval '30 days')",
    [createHmac('sha256', Buffer.from(secret.value)).update(token).digest('hex'), credential]);
  const cookie = `__Host-pulse_session=${token}`;
  const get = (url: string, marker?: string) => app.inject({url, headers: {cookie: `${cookie}${marker ? `; ${MORNING_DAY_COOKIE}=${marker}` : ''}`}});
  const setting = (enabled: boolean) => db.query("UPDATE pulse.settings SET values=values || $1::jsonb", [JSON.stringify({morningOpensFirst: enabled})]);
  const off = await get('/'); assert.equal(off.statusCode, 200);
  await setting(true);
  for (const url of ['/', '/morning']) {
    const unsigned = await app.inject({url}); assert.equal(unsigned.statusCode, 302);
    assert.equal(unsigned.headers.location, '/login'); assert.equal(unsigned.headers['set-cookie'], undefined);
  }
  capture = true;
  const redirect = await get('/'); capture = false;
  assert.equal(redirect.statusCode, 302); assert.equal(redirect.headers.location, '/morning');
  assert.equal(redirect.headers['cache-control'], 'no-store');
  assert.equal(queries.filter(sql => sql.includes('pulse.settings')).length, 1);
  assert.ok(queries.some(sql => sql.includes("values->'morningOpensFirst'")));
  assert.ok(queries.every(sql => sql.includes('pulse_private.sessions') || sql.includes('pulse.settings')), 'Redirect builds no source snapshot');
  const morning = await get('/morning'); assert.equal(morning.statusCode, 200);
  assert.match(morning.body, /\/assets\/morning\.js/); assert.match(morning.body, /\/assets\/morning\.css/);
  assert.match(morning.body, /id="tk-strip"/); assert.match(morning.body, /href="\/\?from=morning"/);
  assert.doesNotMatch(morning.body, /<script(?![^>]*\bsrc=)[^>]*>|<style[\s>]/);
  const marker = String(morning.headers['set-cookie']);
  for (const pattern of [/pulse_morning_day=2032-06-10/, /Max-Age=172800/, /Path=\//, /HttpOnly/, /Secure/, /SameSite=Strict/]) assert.match(marker, pattern);
  assert.equal((await get('/', '2032-06-10')).statusCode, 200);
  assert.equal((await get('/', '2032-06-09')).statusCode, 302);
  for (const url of ['/?from=morning', '/?anything=1']) assert.equal((await get(url)).statusCode, 200, url);
  now = new Date('2032-06-10T23:01:00Z');
  assert.equal((await get('/', '2032-06-10')).statusCode, 302);
  assert.match(String((await get('/morning')).headers['set-cookie']), /pulse_morning_day=2032-06-11/);
  now = new Date('2032-12-10T23:59:00Z');
  assert.equal((await get('/', '2032-12-10')).statusCode, 200);
  now = new Date('2032-12-11T00:01:00Z');
  assert.equal((await get('/', '2032-12-10')).statusCode, 302);
  await setting(false); assert.equal((await get('/')).statusCode, 200);
});
