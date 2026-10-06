import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import type { Database } from '../src/db.js';
import { MigrationError } from '../src/diagnostics.js';
import { migrate } from '../src/migrate.js';
import { createTestDatabase } from './helpers/database.js';

async function createFoundationDatabase(): Promise<Database> {
  const db = await createTestDatabase({ migrate: false });
  try {
    const sql = await readFile(new URL('../migrations/001_foundations.sql', import.meta.url), 'utf8');
    await db.transaction(async (transaction) => {
      await transaction.query(`
        CREATE SCHEMA pulse_private;
        REVOKE ALL ON SCHEMA pulse_private FROM PUBLIC;
        CREATE TABLE pulse_private.schema_migrations (
          name text PRIMARY KEY,
          checksum text NOT NULL,
          applied_at timestamptz NOT NULL DEFAULT now()
        );
      `);
      await transaction.query(sql);
      await transaction.query(
        'INSERT INTO pulse_private.schema_migrations (name, checksum) VALUES ($1, $2)',
        ['001_foundations.sql', createHash('sha256').update(sql).digest('hex')],
      );
    });
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}

async function assertPublicHasNoTables(db: Database): Promise<void> {
  assert.deepEqual((await db.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")).rows, []);
}

async function tableIdentity(db: Database, relation: string) {
  const table = (await db.query('SELECT to_regclass($1)::oid::text AS oid', [relation])).rows;
  const indexes = (await db.query(`
    SELECT indexrelid::text AS oid FROM pg_index WHERE indrelid = $1::regclass ORDER BY indexrelid
  `, [relation])).rows;
  const constraints = (await db.query(`
    SELECT oid::text, conname, contype, conrelid::text, confrelid::text
    FROM pg_constraint WHERE conrelid = $1::regclass ORDER BY oid
  `, [relation])).rows;
  return { table, indexes, constraints };
}

async function tableDefinition(db: Database, relation: string) {
  const columns = (await db.query(`
    SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull,
      pg_get_expr(d.adbin, d.adrelid) AS default_expression
    FROM pg_attribute a
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY a.attnum
  `, [relation])).rows;
  const constraints = (await db.query(`
    SELECT conname, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint WHERE conrelid = $1::regclass ORDER BY conname
  `, [relation])).rows;
  const indexes = (await db.query(`
    SELECT pg_get_indexdef(indexrelid) AS definition
    FROM pg_index WHERE indrelid = $1::regclass ORDER BY pg_get_indexdef(indexrelid)
  `, [relation])).rows;
  return JSON.stringify({ columns, constraints, indexes }).replaceAll('public.', '').replaceAll('pulse.', '');
}

test('adapters report row counts for selects and writes with or without parameters', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  assert.equal((await db.query('SELECT 1 UNION ALL SELECT 2')).rowCount, 2);
  assert.equal((await db.query('SELECT $1::integer UNION ALL SELECT $2::integer', [1, 2])).rowCount, 2);
  assert.equal((await db.query('SELECT 1 WHERE false')).rowCount, 0);
  assert.equal((await db.query('SELECT $1::integer WHERE false', [1])).rowCount, 0);
  assert.equal((await db.query("INSERT INTO pulse.audit_log (event) VALUES ('first'), ('second')")).rowCount, 2);
  assert.equal((await db.query('INSERT INTO pulse.audit_log (event) VALUES ($1) RETURNING id', ['third'])).rowCount, 1);
  assert.equal((await db.query('UPDATE pulse.audit_log SET event = $1', ['updated'])).rowCount, 3);
  assert.equal((await db.query('DELETE FROM pulse.audit_log')).rowCount, 3);
});

test('all migrations leave public empty, repeat without losing rows and reject changed history', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  await db.query("INSERT INTO pulse.audit_log (event) VALUES ('migration_check')");
  await Promise.all([migrate(db), migrate(db)]);
  await assertPublicHasNoTables(db);
  assert.equal((await db.query('SELECT * FROM pulse.audit_log')).rows.length, 1);
  assert.equal((await db.query('SELECT * FROM pulse_private.schema_migrations')).rows.length, 6);
  await db.query("UPDATE pulse_private.schema_migrations SET checksum = 'changed'");
  await assert.rejects(migrate(db), (error: unknown) => {
    assert.ok(error instanceof MigrationError);
    assert.equal(error.migration, '001_foundations.sql');
    assert.equal(error.code, 'UNKNOWN');
    return true;
  });
});

test('002 moves public data and preserves tables, indexes, constraints, sequences and foreign keys', async (t) => {
  const db = await createFoundationDatabase();
  t.after(() => db.close());
  const credentialId = randomUUID();
  await db.query('INSERT INTO pulse_private.credentials (id, public_key) VALUES ($1, $2)', [credentialId, randomBytes(32)]);
  await db.query(`
    INSERT INTO pulse_private.sessions (token_hash, credential_id, expires_at)
    VALUES ($1, $2, now() + interval '30 days')
  `, [randomUUID(), credentialId]);
  // Some deployed databases may have this extra relation; 001 itself does not.
  await db.query(`
    ALTER TABLE public.audit_log ADD CONSTRAINT deployed_audit_credential_fk
    FOREIGN KEY (credential_id) REFERENCES pulse_private.credentials (id)
  `);
  await db.query(`
    INSERT INTO public.source_health
      (source, mode, status, last_success_at, last_attempt_at, consecutive_failures)
    VALUES ('shopify', 'live', 'error', '2026-10-01T09:00:00Z', '2026-10-01T10:00:00Z', 2)
  `);
  await db.query('INSERT INTO public.audit_log (event, credential_id) VALUES ($1, $2), ($1, $2)', ['sign_in', credentialId]);
  const healthRows = (await db.query('SELECT * FROM public.source_health')).rows;
  const auditRows = (await db.query('SELECT * FROM public.audit_log ORDER BY id')).rows;
  const healthIdentity = await tableIdentity(db, 'public.source_health');
  const auditIdentity = await tableIdentity(db, 'public.audit_log');
  const sessionIdentity = await tableIdentity(db, 'pulse_private.sessions');
  const sequence = (await db.query("SELECT 'public.audit_log_id_seq'::regclass::oid::text AS oid")).rows;
  const foundationHistory = (await db.query('SELECT * FROM pulse_private.schema_migrations')).rows;

  await migrate(db);

  assert.deepEqual((await db.query('SELECT * FROM pulse.source_health')).rows, healthRows);
  assert.deepEqual((await db.query('SELECT * FROM pulse.audit_log ORDER BY id')).rows, auditRows);
  assert.deepEqual(await tableIdentity(db, 'pulse.source_health'), healthIdentity);
  assert.deepEqual(await tableIdentity(db, 'pulse.audit_log'), auditIdentity);
  assert.deepEqual(await tableIdentity(db, 'pulse_private.sessions'), sessionIdentity);
  assert.deepEqual((await db.query("SELECT 'pulse.audit_log_id_seq'::regclass::oid::text AS oid")).rows, sequence);
  assert.deepEqual((await db.query("SELECT * FROM pulse_private.schema_migrations WHERE name = '001_foundations.sql'")).rows, foundationHistory);
  const next = await db.query('INSERT INTO pulse.audit_log (event, credential_id) VALUES ($1, $2) RETURNING id', ['sign_in', credentialId]);
  assert.equal(Number(next.rows[0]!.id), 3);
  await assert.rejects(db.query('INSERT INTO pulse.audit_log (event, credential_id) VALUES ($1, $2)', ['sign_in', randomUUID()]));
  await assert.rejects(db.query(`
    INSERT INTO pulse_private.sessions (token_hash, credential_id, expires_at)
    VALUES ($1, $2, now() + interval '30 days')
  `, [randomUUID(), randomUUID()]));
  assert.equal((await db.query('SELECT * FROM pulse_private.sessions')).rowCount, 1);
  await db.query('DELETE FROM pulse.audit_log');
  await db.query('DELETE FROM pulse_private.credentials WHERE id = $1', [credentialId]);
  assert.equal((await db.query('SELECT * FROM pulse_private.sessions')).rowCount, 0);
  await assertPublicHasNoTables(db);
});

for (const missing of [['source_health'], ['audit_log'], ['source_health', 'audit_log']] as const) {
  test(`002 recreates missing ${missing.join(' and ')} independently with the exact 001 definitions`, async (t) => {
    const db = await createFoundationDatabase();
    t.after(() => db.close());
    const healthDefinition = await tableDefinition(db, 'public.source_health');
    const auditDefinition = await tableDefinition(db, 'public.audit_log');
    await db.query("INSERT INTO public.source_health (source, mode, status) VALUES ('shopify', 'sample', 'waiting_for_keys')");
    await db.query("INSERT INTO public.audit_log (event) VALUES ('sign_in')");
    const missingTables: readonly string[] = missing;
    for (const table of missing) await db.query(`DROP TABLE public.${table}`);

    await migrate(db);

    assert.equal(await tableDefinition(db, 'pulse.source_health'), healthDefinition);
    assert.equal(await tableDefinition(db, 'pulse.audit_log'), auditDefinition);
    assert.equal((await db.query('SELECT * FROM pulse.source_health')).rowCount, missingTables.includes('source_health') ? 0 : 1);
    assert.equal((await db.query('SELECT * FROM pulse.audit_log')).rowCount, missingTables.includes('audit_log') ? 0 : 1);
    assert.equal((await db.query("INSERT INTO pulse.audit_log (event) VALUES ('migration_check') RETURNING id")).rowCount, 1);
    await assertPublicHasNoTables(db);
  });
}

for (const moved of [['source_health'], ['audit_log'], ['source_health', 'audit_log']] as const) {
  test(`002 leaves existing pulse ${moved.join(' and ')} unchanged`, async (t) => {
    const db = await createFoundationDatabase();
    t.after(() => db.close());
    await db.query("INSERT INTO public.source_health (source, mode, status) VALUES ('shopify', 'sample', 'waiting_for_keys')");
    await db.query("INSERT INTO public.audit_log (event) VALUES ('sign_in')");
    const healthIdentity = await tableIdentity(db, 'public.source_health');
    const auditIdentity = await tableIdentity(db, 'public.audit_log');
    const healthRows = (await db.query('SELECT * FROM public.source_health')).rows;
    const auditRows = (await db.query('SELECT * FROM public.audit_log')).rows;
    await db.query('CREATE SCHEMA pulse');
    for (const table of moved) await db.query(`ALTER TABLE public.${table} SET SCHEMA pulse`);

    await migrate(db);

    assert.deepEqual(await tableIdentity(db, 'pulse.source_health'), healthIdentity);
    assert.deepEqual(await tableIdentity(db, 'pulse.audit_log'), auditIdentity);
    assert.deepEqual((await db.query('SELECT * FROM pulse.source_health')).rows, healthRows);
    assert.deepEqual((await db.query('SELECT * FROM pulse.audit_log')).rows, auditRows);
    await assertPublicHasNoTables(db);
  });
}

test('transactions roll back writes and nested savepoints isolate failed operations', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  await assert.rejects(db.transaction(async (transaction) => {
    await transaction.query("INSERT INTO pulse.audit_log (event) VALUES ('rolled_back')");
    throw new Error('Rollback requested');
  }), /Rollback requested/);
  assert.equal((await db.query('SELECT * FROM pulse.audit_log')).rows.length, 0);

  await db.transaction(async (transaction) => {
    await transaction.query("INSERT INTO pulse.audit_log (event) VALUES ('kept')");
    await assert.rejects(transaction.transaction(async (nested) => {
      await nested.query("INSERT INTO pulse.audit_log (event) VALUES ('rolled_back')");
      throw new Error('Savepoint rollback');
    }), /Savepoint rollback/);
  });
  assert.deepEqual((await db.query('SELECT event FROM pulse.audit_log')).rows, [{ event: 'kept' }]);
});

test('private schema and all its tables deny PUBLIC access', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  const schemaPermissions = await db.query(`
    SELECT acl.privilege_type FROM pg_namespace n,
      LATERAL aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) acl
    WHERE n.nspname = 'pulse_private' AND acl.grantee = 0
  `);
  assert.deepEqual(schemaPermissions.rows, []);
  const tablePermissions = await db.query(`
    SELECT c.relname, acl.privilege_type
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace,
      LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) acl
    WHERE n.nspname = 'pulse_private' AND c.relkind = 'r' AND acl.grantee = 0
  `);
  assert.deepEqual(tablePermissions.rows, []);
  const tables = await db.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'pulse_private' ORDER BY tablename",
  );
  assert.deepEqual(tables.rows.map((row) => row.tablename), [
    'app_secrets', 'challenges', 'credentials', 'owner', 'rate_limits', 'schema_migrations', 'sessions',
  ]);
});

test('source health constraints reject invalid modes, states, and failure counts', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  await assert.rejects(db.query(
    'INSERT INTO pulse.source_health (source, mode, status) VALUES ($1, $2, $3)',
    ['shopify', 'invalid', 'waiting_for_keys'],
  ));
  await assert.rejects(db.query(
    'INSERT INTO pulse.source_health (source, mode, status) VALUES ($1, $2, $3)',
    ['shopify', 'sample', 'invalid'],
  ));
  await assert.rejects(db.query(`
    INSERT INTO pulse.source_health (source, mode, status, consecutive_failures)
    VALUES ('shopify', 'sample', 'waiting_for_keys', -1)
  `));
  const time = new Date('2026-10-01T09:00:00Z');
  await db.query(`
    INSERT INTO pulse.source_health
      (source, mode, status, last_success_at, last_attempt_at, consecutive_failures)
    VALUES ($1, $2, $3, $4, $4, $5)
  `, ['shopify', 'live', 'healthy', time, 0]);
  await db.query("UPDATE pulse.source_health SET status = 'error', consecutive_failures = 1 WHERE source = 'shopify'");
  const row = (await db.query('SELECT * FROM pulse.source_health')).rows[0]!;
  assert.equal(new Date(row.last_success_at as string).toISOString(), time.toISOString());
  assert.equal(new Date(row.last_attempt_at as string).toISOString(), time.toISOString());
  assert.equal(row.consecutive_failures, 1);
});

test('owner is singleton, credential deletion revokes sessions, and SQL values remain data', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  await db.query('INSERT INTO pulse_private.owner (user_id) VALUES ($1)', [randomUUID()]);
  await assert.rejects(db.query('INSERT INTO pulse_private.owner (user_id) VALUES ($1)', [randomUUID()]));
  await assert.rejects(db.query('INSERT INTO pulse_private.owner (singleton, user_id) VALUES (false, $1)', [randomUUID()]));

  const credentialId = randomUUID();
  await db.query('INSERT INTO pulse_private.credentials (id, public_key) VALUES ($1, $2)', [credentialId, randomBytes(32)]);
  await db.query(`
    INSERT INTO pulse_private.sessions (token_hash, credential_id, expires_at)
    VALUES ($1, $2, now() + interval '30 days')
  `, [randomUUID(), credentialId]);
  assert.equal((await db.query('SELECT * FROM pulse_private.sessions')).rows.length, 1);
  await db.query('DELETE FROM pulse_private.credentials WHERE id = $1', [credentialId]);
  assert.equal((await db.query('SELECT * FROM pulse_private.sessions')).rows.length, 0);

  const injection = "test'); DROP TABLE pulse.audit_log; --";
  await db.query('INSERT INTO pulse.audit_log (event) VALUES ($1)', [injection]);
  assert.deepEqual((await db.query('SELECT event FROM pulse.audit_log')).rows, [{ event: injection }]);
});
