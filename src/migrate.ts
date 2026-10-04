import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { type Database, openPostgres } from './db.js';
import { failureMessage, MigrationError } from './diagnostics.js';
import { ConfigError } from './runtime.js';

const migrationsDirectory = fileURLToPath(new URL('../migrations/', import.meta.url));

export async function migrate(db: Database): Promise<void> {
  const files = (await readdir(migrationsDirectory)).filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name)).sort();
  const migrations = await Promise.all(files.map(async (name) => {
    try {
      const sql = await readFile(resolve(migrationsDirectory, name), 'utf8');
      return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
    } catch (error) { throw new MigrationError(name, error); }
  }));

  await db.transaction(async (transaction) => {
    // Serialize concurrent startups, including creation of the migration ledger.
    await transaction.query('SELECT pg_advisory_xact_lock(1668244581, 1886743667)');
    await transaction.query(`
      CREATE SCHEMA IF NOT EXISTS pulse_private;
      REVOKE ALL ON SCHEMA pulse_private FROM PUBLIC;
      CREATE TABLE IF NOT EXISTS pulse_private.schema_migrations (
        name text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
      REVOKE ALL ON TABLE pulse_private.schema_migrations FROM PUBLIC;
    `);
    const applied = await transaction.query<{ name: string; checksum: string }>(
      'SELECT name, checksum FROM pulse_private.schema_migrations ORDER BY name',
    );
    for (const row of applied.rows) {
      const migration = migrations.find((candidate) => candidate.name === row.name);
      if (!migration || migration.checksum !== row.checksum) {
        throw new MigrationError(row.name, new Error('Migration history does not match'));
      }
    }
    for (const migration of migrations) {
      if (applied.rows.some((row) => row.name === migration.name)) continue;
      try {
        await transaction.query(migration.sql);
        await transaction.query(
          'INSERT INTO pulse_private.schema_migrations (name, checksum) VALUES ($1, $2)',
          [migration.name, migration.checksum],
        );
      } catch (error) { throw new MigrationError(migration.name, error); }
    }
  });
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new ConfigError('DATABASE_URL is required');
  const db = openPostgres(databaseUrl);
  try {
    await migrate(db);
  } catch (error) {
    await db.close().catch(() => {});
    throw error;
  }
  await db.close();
  console.info('Database migrations complete.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(failureMessage('migration', error));
    process.exitCode = 1;
  });
}
