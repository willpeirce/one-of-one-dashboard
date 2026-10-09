import pg from 'pg';

export interface QueryResult<Row> {
  rows: Row[];
  rowCount: number;
}

export interface Database {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
  transaction<T>(fn: (db: Database) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

type Queryable = Pick<pg.Pool, 'query'> | Pick<pg.PoolClient, 'query'>;

async function query<Row extends Record<string, unknown>>(
  client: Queryable,
  text: string,
  values?: unknown[],
): Promise<QueryResult<Row>> {
  const result = await client.query<Row>(text, values);
  // A migration can contain several SQL statements; only its last result matters.
  const last = Array.isArray(result) ? result.at(-1) : result;
  return { rows: last?.rows ?? [], rowCount: last?.rowCount ?? 0 };
}

function transactionalConnection(client: pg.PoolClient): Database {
  let savepoint = 0;
  const db: Database = {
    query: (text, values) => query(client, text, values),
    async transaction(fn) {
      const name = `pulse_savepoint_${++savepoint}`;
      await client.query(`SAVEPOINT ${name}`);
      try {
        const result = await fn(db);
        await client.query(`RELEASE SAVEPOINT ${name}`);
        return result;
      } catch (error) {
        await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
        await client.query(`RELEASE SAVEPOINT ${name}`);
        throw error;
      }
    },
    async close() {},
  };
  return db;
}

export function openPostgres(databaseUrl: string): Database {
  const url = new URL(databaseUrl);
  // Keep local non-TLS databases working; pin TLS URLs to pg's current verification.
  if (url.searchParams.has('sslmode') && url.searchParams.get('sslmode') !== 'disable') url.searchParams.set('sslmode', 'verify-full');
  const pool = new pg.Pool({
    connectionString: url.toString(),
    application_name: 'one-of-one-pulse',
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 30_000,
    idle_in_transaction_session_timeout: 30_000,
    max: 10,
  });
  // The process-level handler can act on a failed request without logging credentials.
  pool.on('error', () => {});

  return {
    query: (text, values) => query(pool, text, values),
    async transaction(fn) {
      const client = await pool.connect();
      let discardClient = false;
      try {
        await client.query('BEGIN');
        const result = await fn(transactionalConnection(client));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // A connection with unknown transaction state must never return to the pool.
          discardClient = true;
        }
        throw error;
      } finally {
        client.release(discardClient);
      }
    },
    close: () => pool.end(),
  };
}
