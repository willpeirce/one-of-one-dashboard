import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import { openPostgres } from '../src/db.js';

test('Postgres TLS URLs explicitly verify certificates and hostnames; local plaintext remains available',async t=>{
  const configs:pg.PoolConfig[]=[];
  t.mock.method(pg,'Pool',function(config:pg.PoolConfig) {
    configs.push(config);
    return {on(){},async end(){}};
  });
  for (const sslmode of ['require','prefer','verify-ca','verify-full']) {
    await openPostgres(`postgresql://db.example.test/pulse?sslmode=${sslmode}`).close();
    assert.equal(new URL(configs.at(-1)!.connectionString!).searchParams.get('sslmode'),'verify-full');
  }
  for (const suffix of ['', '?sslmode=disable']) {
    await openPostgres(`postgresql://localhost/pulse_test${suffix}`).close();
    assert.equal(new URL(configs.at(-1)!.connectionString!).searchParams.get('sslmode'),suffix?'disable':null);
  }
});
