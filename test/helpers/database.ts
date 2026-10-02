import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { type Database, type QueryResult, openPostgres } from '../../src/db.js';
import { migrate } from '../../src/migrate.js';

type EmbeddedConnection = Pick<PGlite, 'query' | 'exec'>;

function embeddedConnection(connection: EmbeddedConnection): Database {
  let savepoint = 0;
  const db: Database = {
    async query<Row extends Record<string, unknown>>(
      text: string,
      values?: unknown[],
    ): Promise<QueryResult<Row>> {
      if (values) {
        const result = await connection.query<Row>(text, values);
        return { rows: result.rows, rowCount: result.affectedRows || result.rows.length };
      }
      const result = (await connection.exec(text)).at(-1);
      return {
        rows: (result?.rows ?? []) as Row[],
        rowCount: result?.affectedRows || result?.rows.length || 0,
      };
    },
    async transaction(fn) {
      const name = `pulse_savepoint_${++savepoint}`;
      await connection.exec(`SAVEPOINT ${name}`);
      try {
        const result = await fn(db);
        await connection.exec(`RELEASE SAVEPOINT ${name}`);
        return result;
      } catch (error) {
        await connection.exec(`ROLLBACK TO SAVEPOINT ${name}`);
        await connection.exec(`RELEASE SAVEPOINT ${name}`);
        throw error;
      }
    },
    async close() {},
  };
  return db;
}

async function createEmbeddedDatabase(): Promise<Database> {
  const embedded = new PGlite();
  const connection = embeddedConnection(embedded);
  const db: Database = {
    query: connection.query,
    transaction: (fn) => embedded.transaction(async (transaction) => fn(embeddedConnection(transaction))),
    close: () => embedded.close(),
  };
  try {
    await migrate(db);
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}

async function createPostgresDatabase(databaseUrl: string): Promise<Database> {
  // This must be a disposable test server: the test role needs CREATEDB.
  // A distinct database prevents parallel files or failed tests sharing state.
  const name = `pulse_test_${randomUUID().replaceAll('-', '')}`;
  const admin = openPostgres(databaseUrl);
  try {
    await admin.query(`CREATE DATABASE ${name}`);
  } catch (error) {
    await admin.close();
    throw error;
  }
  const url = new URL(databaseUrl);
  url.pathname = `/${name}`;
  const connection = openPostgres(url.toString());
  let closed = false;
  const db: Database = {
    query: connection.query,
    transaction: connection.transaction,
    async close() {
      if (closed) return;
      closed = true;
      try {
        await connection.close();
      } finally {
        try {
          await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
        } finally {
          await admin.close();
        }
      }
    },
  };
  try {
    await migrate(db);
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}

export function createTestDatabase(): Promise<Database> {
  return process.env.TEST_DATABASE_URL
    ? createPostgresDatabase(process.env.TEST_DATABASE_URL)
    : createEmbeddedDatabase();
}
