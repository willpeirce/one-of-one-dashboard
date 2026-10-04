import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Database } from '../src/db.js';
import { errorCode, failureMessage, MigrationError } from '../src/diagnostics.js';
import { migrate } from '../src/migrate.js';
import { logNodeVersion } from '../src/runtime.js';

const migrationName = '002_application_schema.sql';
const contexts = [
  ['startup', 'Pulse could not start'],
  ['migration', 'Database migration failed'],
] as const;

function privateError(code?: unknown) {
  const marker = randomUUID();
  const hostname = `${marker}.invalid`;
  const url = new URL(`postgresql://${hostname}/diagnostics_test`);
  url.username = 'synthetic-user';
  url.password = marker;
  const error = Object.assign(new Error(`Connection failed at ${url.href}; environment ${marker}`), {
    code, hostname, connectionString: url.href, detail: marker,
  });
  return { error, marker, hostname, url: url.href };
}

test('database diagnostics retain safe codes and a migration filename without private error details', () => {
  for (const code of ['42P07', 'ENOTFOUND', 'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED']) {
    const { error, marker, hostname, url } = privateError(code);
    assert.equal(errorCode(error), code);
    const wrapped = new MigrationError(migrationName, error);
    assert.equal(wrapped.cause, undefined);
    assert.ok(!JSON.stringify(wrapped).includes(marker));
    for (const [context, prefix] of contexts) {
      const ordinary = failureMessage(context, error);
      const migrated = failureMessage(context, wrapped);
      assert.equal(ordinary, `${prefix} (code: ${code}).`);
      assert.equal(migrated, `${prefix} (code: ${code}; migration: ${migrationName}).`);
      for (const output of [ordinary, migrated]) {
        for (const privateValue of [error.message, marker, hostname, url]) {
          assert.ok(!output.includes(privateValue), 'Diagnostics must omit private error details');
        }
      }
    }
  }
});

test('invalid error codes and injected filenames cannot enter diagnostics', () => {
  const marker = randomUUID();
  for (const code of [`42P07\n${marker}`, `EUNKNOWN_${marker}`, '42p07', 42_707, { value: marker }]) {
    const { error } = privateError(code);
    assert.equal(errorCode(error), 'UNKNOWN');
    for (const filename of [`../../${marker}.sql`, `${migrationName}\n${marker}`, `${marker}.sql`]) {
      const wrapped = new MigrationError(filename, error);
      for (const [context, prefix] of contexts) {
        const output = failureMessage(context, wrapped);
        assert.equal(output, `${prefix} (code: UNKNOWN).`);
        assert.ok(!JSON.stringify(wrapped).includes(marker));
      }
    }
  }
});

test('missing error codes use UNKNOWN without stringifying thrown values', () => {
  const marker = randomUUID();
  for (const error of [undefined, null, new Error(marker), marker, { message: marker }, {}]) {
    assert.equal(errorCode(error), 'UNKNOWN');
    for (const [context, prefix] of contexts) {
      assert.equal(failureMessage(context, error), `${prefix} (code: UNKNOWN).`);
    }
  }
});

test('the migration runner preserves the failing migration filename and SQLSTATE', async () => {
  const failingSql = await readFile(new URL(`../migrations/${migrationName}`, import.meta.url), 'utf8');
  const { error, marker } = privateError('42P07');
  let reachedMigration = false;
  const db: Database = {
    async query(sql) {
      if (sql === failingSql) {
        reachedMigration = true;
        throw error;
      }
      return { rows: [], rowCount: 0 };
    },
    async transaction(run) { return await run(db); },
    async close() {},
  };
  await assert.rejects(migrate(db), (caught: unknown) => {
    assert.ok(caught instanceof MigrationError);
    assert.equal(failureMessage('startup', caught), `Pulse could not start (code: 42P07; migration: ${migrationName}).`);
    assert.equal(failureMessage('migration', caught), `Database migration failed (code: 42P07; migration: ${migrationName}).`);
    assert.ok(!JSON.stringify(caught).includes(marker));
    return true;
  });
  assert.equal(reachedMigration, true);
});

test('Node 24 reports its actual major without a warning', (t) => {
  const info = t.mock.method(console, 'info', () => {});
  const warn = t.mock.method(console, 'warn', () => {});
  const error = t.mock.method(console, 'error', () => {});
  logNodeVersion(24);
  assert.deepEqual(info.mock.calls.map((call) => call.arguments), [['Pulse Node major: 24']]);
  assert.equal(warn.mock.callCount(), 0);
  assert.equal(error.mock.callCount(), 0);
});

test('Node 20 reports its major and warns without stopping startup', (t) => {
  const info = t.mock.method(console, 'info', () => {});
  const warn = t.mock.method(console, 'warn', () => {});
  assert.doesNotThrow(() => logNodeVersion(20));
  assert.deepEqual(info.mock.calls.map((call) => call.arguments), [['Pulse Node major: 20']]);
  assert.deepEqual(warn.mock.calls.map((call) => call.arguments), [
    ['Warning: Pulse expects Node 24; continuing on Node 20.'],
  ]);
});

async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  assert.ok(address && typeof address === 'object');
  return address.port;
}

async function runCommand(entry: 'server' | 'migrate', env: NodeJS.ProcessEnv): Promise<{ code: number | null; output: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', `src/${entry}.ts`], {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 20_000,
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, output }));
  });
}

test('commands report fixed configuration messages for a bad APP_ORIGIN and missing DATABASE_URL', async () => {
  const marker = randomUUID();
  const badOrigin = `invalid-origin-${marker}`;
  const databaseUrl = `postgresql://${marker}.invalid/diagnostics_test`;
  const startup = await runCommand('server', {
    NODE_ENV: 'production', DATABASE_URL: databaseUrl, APP_ORIGIN: badOrigin,
  });
  const migration = await runCommand('migrate', { NODE_ENV: 'test' });
  for (const [result, expected] of [
    [startup, 'Pulse could not start: Invalid APP_ORIGIN'],
    [migration, 'Database migration failed: DATABASE_URL is required'],
  ] as const) {
    assert.equal(result.code, 1);
    assert.ok(result.output.includes(`${expected}\n`));
    for (const privateValue of [marker, badOrigin, databaseUrl]) {
      assert.ok(!result.output.includes(privateValue), 'Configuration diagnostics must omit environment values');
    }
    assert.ok(!result.output.includes('Database migrations complete.'));
  }
});

test('startup and migration commands expose connection codes without exposing the URL or environment', async () => {
  const port = await closedPort();
  const marker = randomUUID();
  const url = new URL(`postgresql://127.0.0.1:${port}/diagnostics_test`);
  url.username = 'synthetic-user';
  url.password = marker;
  for (const [entry, prefix] of [['server', 'Pulse could not start'], ['migrate', 'Database migration failed']] as const) {
    const result = await runCommand(entry, {
      NODE_ENV: 'test', DATABASE_URL: url.href, APP_ORIGIN: 'http://localhost:3000',
      PULSE_TEST_PRIVATE_MARKER: marker,
    });
    assert.equal(result.code, 1);
    assert.ok(result.output.includes(`${prefix} (code: ECONNREFUSED).`));
    if (entry === 'server') {
      assert.ok(result.output.includes(`Pulse Node major: ${process.versions.node.split('.')[0]}`));
    }
    for (const privateValue of [url.href, marker, 'synthetic-user', `127.0.0.1:${port}`]) {
      assert.ok(!result.output.includes(privateValue), 'Command output must omit private connection details');
    }
  }
});
