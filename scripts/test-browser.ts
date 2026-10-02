import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { readRuntime } from '../src/runtime.js';
import { createTestDatabase } from '../test/helpers/database.js';

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const address = probe.address();
  await new Promise<void>((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  if (typeof address !== 'object' || address === null) throw new Error('No test port available');
  return address.port;
}

async function run(): Promise<void> {
  const db = await createTestDatabase();
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    const port = await freePort();
    const origin = `http://localhost:${port}`;
    const setupPhrase = randomBytes(32).toString('base64url');
    const config = readRuntime({
      NODE_ENV: 'test', APP_ORIGIN: origin, PORT: String(port),
      DATABASE_URL: 'postgresql://localhost/pulse_browser_test',
      DASHBOARD_SETUP_CODE: setupPhrase,
    });
    app = await createApp(db, config, {});
    await app.listen({ host: '127.0.0.1', port });
    const exitCode = await new Promise<number>((resolve, reject) => {
      const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/browser-smoke.ts'], {
        cwd: fileURLToPath(new URL('../', import.meta.url)),
        env: { ...process.env, APP_ORIGIN: origin, DASHBOARD_SETUP_CODE: setupPhrase },
        stdio: 'inherit',
      });
      child.once('error', reject);
      child.once('exit', (code) => resolve(code ?? 1));
    });
    process.exitCode = exitCode;
    if (exitCode === 0) {
      const sessions = await db.query<{ lifetime: string }>(
        'SELECT extract(epoch FROM expires_at - created_at) AS lifetime FROM pulse_private.sessions',
      );
      assert.equal(sessions.rows.length, 1);
      assert.equal(Number(sessions.rows[0]?.lifetime), 30 * 24 * 60 * 60);
      console.log('Database check passed: one valid session remains, with a persisted lifetime of 30 days.');
    }
  } finally {
    try { await app?.close(); }
    finally { await db.close(); }
  }
}

run().catch(() => {
  console.error('Could not run browser checks. Check the test database and browser installation.');
  process.exitCode = 1;
});
