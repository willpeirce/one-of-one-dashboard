import assert from 'node:assert/strict';
import {createHmac, randomBytes} from 'node:crypto';
import test from 'node:test';
import {createApp} from '../src/app.js';
import type {DashboardSnapshot} from '../src/dashboard-types.js';
import {readRuntime} from '../src/runtime.js';
import {SnapshotCache} from '../src/snapshot-cache.js';
import {sampleIssuesView} from '../src/issues/model.js';
import {sampleKitFacts} from '../src/kits/sample.js';
import {createTestDatabase} from './helpers/database.js';

test('fresh sample dashboard builds differ only in generatedAt within the same UK hour', async t => {
  const start = new Date('2032-04-07T08:07:11Z');
  t.mock.timers.enable({apis: ['Date'], now: start});
  const read = SnapshotCache.prototype.read;
  let builds = 0;
  t.mock.method(SnapshotCache.prototype, 'read', async function(this: SnapshotCache<unknown>) {
    // Exercise the real complete builder every time, rather than compare one cached object with itself.
    await this.invalidate(); builds++;
    return read.call(this);
  });
  const db = await createTestDatabase();
  const app = await createApp(db, readRuntime({DATABASE_URL: 'postgresql://localhost/invented_stability', APP_ORIGIN: 'https://pulse.example.test'}));
  t.after(async () => {await app.close(); await db.close();});
  const key = (await db.query<{value: Uint8Array}>("SELECT value FROM pulse_private.app_secrets WHERE name='session_hmac'")).rows[0]!;
  const token = randomBytes(32).toString('base64url'), credential = randomBytes(32).toString('base64url');
  await db.query('INSERT INTO pulse_private.credentials(id,public_key) VALUES($1,$2)', [credential, randomBytes(32)]);
  await db.query("INSERT INTO pulse_private.sessions(token_hash,credential_id,expires_at) VALUES($1,$2,now()+interval '30 days')",
    [createHmac('sha256', Buffer.from(key.value)).update(token).digest('hex'), credential]);
  const snapshots: Omit<DashboardSnapshot, 'generatedAt'>[] = [];
  for (const elapsed of [0, 3_000, 4 * 60_000, 40 * 60_000]) {
    t.mock.timers.setTime(+start + elapsed);
    const response = await app.inject({url: '/api/dashboard', headers: {cookie: `__Host-pulse_session=${token}`}});
    assert.equal(response.statusCode, 200);
    const {generatedAt, ...snapshot} = response.json<DashboardSnapshot>();
    assert.equal(generatedAt, new Date(+start + elapsed).toISOString());
    assert.ok(snapshot.kits?.cards.length);
    assert.ok(snapshot.issuesRead?.checkedAt);
    snapshots.push(snapshot);
    assert.deepEqual(snapshot, snapshots[0], `Every snapshot field stays stable after ${elapsed} ms`);
  }
  assert.equal(builds, snapshots.length);
});

test('sample Kits and Issues keep hourly stamps and UK daily dates through clock changes', () => {
  for (const instant of ['2032-03-28T00:06:00Z', '2032-03-28T01:06:00Z', '2032-10-31T00:06:00Z', '2032-10-31T01:06:00Z']) {
    const now = new Date(instant), later = new Date(+now + 45 * 60_000);
    assert.deepEqual(sampleKitFacts(later), sampleKitFacts(now));
    assert.deepEqual(sampleIssuesView(later), sampleIssuesView(now));
    const nextHour = new Date(+now + 60 * 60_000);
    assert.notEqual(sampleKitFacts(nextHour).kits.readAt, sampleKitFacts(now).kits.readAt);
    assert.notEqual(sampleIssuesView(nextHour).checkedAt, sampleIssuesView(now).checkedAt);
    assert.deepEqual(sampleKitFacts(nextHour).kits.rows, sampleKitFacts(now).kits.rows, 'Relative kit dates move only with the UK day');
  }
  const beforeMidnight = sampleKitFacts(new Date('2032-04-07T22:59:59Z'));
  const afterMidnight = sampleKitFacts(new Date('2032-04-07T23:00:00Z'));
  assert.equal(beforeMidnight.kits.rows[1]!.launchTarget, '2032-06-30');
  assert.equal(afterMidnight.kits.rows[1]!.launchTarget, '2032-07-01');
  assert.equal(beforeMidnight.kits.rows[0]!.selloutTarget, '2032-05-26');
  assert.equal(afterMidnight.kits.rows[0]!.selloutTarget, '2032-05-27');
  assert.equal(beforeMidnight.kits.rows[0]!.moveNote, 'Next check 14 Apr');
  assert.equal(afterMidnight.kits.rows[0]!.moveNote, 'Next check 15 Apr');
  assert.deepEqual(beforeMidnight.kits.rows.slice(0, 3).map(row => row.nextDate), ['Stock count 14 Apr', 'Sample due 14 Apr', 'Proof due 21 Apr']);
  assert.deepEqual(afterMidnight.kits.rows.slice(0, 3).map(row => row.nextDate), ['Stock count 15 Apr', 'Sample due 15 Apr', 'Proof due 22 Apr']);
});
