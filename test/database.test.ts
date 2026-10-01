import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { migrate } from '../src/migrate.js';
import { createTestDatabase } from './helpers/database.js';

test('adapters report row counts for selects and writes with or without parameters', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  assert.equal((await db.query('SELECT 1 UNION ALL SELECT 2')).rowCount, 2);
  assert.equal((await db.query('SELECT $1::integer UNION ALL SELECT $2::integer', [1, 2])).rowCount, 2);
  assert.equal((await db.query('SELECT 1 WHERE false')).rowCount, 0);
  assert.equal((await db.query('SELECT $1::integer WHERE false', [1])).rowCount, 0);
  assert.equal((await db.query("INSERT INTO public.audit_log (event) VALUES ('first'), ('second')")).rowCount, 2);
  assert.equal((await db.query('INSERT INTO public.audit_log (event) VALUES ($1) RETURNING id', ['third'])).rowCount, 1);
  assert.equal((await db.query('UPDATE public.audit_log SET event = $1', ['updated'])).rowCount, 3);
  assert.equal((await db.query('DELETE FROM public.audit_log')).rowCount, 3);
});

test('migrations repeat without losing rows and reject changed migration history', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  await db.query("INSERT INTO public.audit_log (event) VALUES ('migration_check')");
  await Promise.all([migrate(db), migrate(db)]);
  assert.equal((await db.query('SELECT * FROM public.audit_log')).rows.length, 1);
  assert.equal((await db.query('SELECT * FROM pulse_private.schema_migrations')).rows.length, 1);
  await db.query("UPDATE pulse_private.schema_migrations SET checksum = 'changed'");
  await assert.rejects(migrate(db), /Migration history does not match/);
});

test('transactions roll back writes and nested savepoints isolate failed operations', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  await assert.rejects(db.transaction(async (transaction) => {
    await transaction.query("INSERT INTO public.audit_log (event) VALUES ('rolled_back')");
    throw new Error('Rollback requested');
  }), /Rollback requested/);
  assert.equal((await db.query('SELECT * FROM public.audit_log')).rows.length, 0);

  await db.transaction(async (transaction) => {
    await transaction.query("INSERT INTO public.audit_log (event) VALUES ('kept')");
    await assert.rejects(transaction.transaction(async (nested) => {
      await nested.query("INSERT INTO public.audit_log (event) VALUES ('rolled_back')");
      throw new Error('Savepoint rollback');
    }), /Savepoint rollback/);
  });
  assert.deepEqual((await db.query('SELECT event FROM public.audit_log')).rows, [{ event: 'kept' }]);
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
    'INSERT INTO public.source_health (source, mode, status) VALUES ($1, $2, $3)',
    ['shopify', 'invalid', 'waiting_for_keys'],
  ));
  await assert.rejects(db.query(
    'INSERT INTO public.source_health (source, mode, status) VALUES ($1, $2, $3)',
    ['shopify', 'sample', 'invalid'],
  ));
  await assert.rejects(db.query(`
    INSERT INTO public.source_health (source, mode, status, consecutive_failures)
    VALUES ('shopify', 'sample', 'waiting_for_keys', -1)
  `));
  const time = new Date('2026-10-01T09:00:00Z');
  await db.query(`
    INSERT INTO public.source_health
      (source, mode, status, last_success_at, last_attempt_at, consecutive_failures)
    VALUES ($1, $2, $3, $4, $4, $5)
  `, ['shopify', 'live', 'healthy', time, 0]);
  await db.query("UPDATE public.source_health SET status = 'error', consecutive_failures = 1 WHERE source = 'shopify'");
  const row = (await db.query('SELECT * FROM public.source_health')).rows[0]!;
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

  const injection = "test'); DROP TABLE public.audit_log; --";
  await db.query('INSERT INTO public.audit_log (event) VALUES ($1)', [injection]);
  assert.deepEqual((await db.query('SELECT event FROM public.audit_log')).rows, [{ event: injection }]);
});
