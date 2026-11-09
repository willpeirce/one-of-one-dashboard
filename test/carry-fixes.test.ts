import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createTestDatabase } from './helpers/database.js';

test('Mailchimp privilege repair removes existing PUBLIC grants and is safe to repeat', async t => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  const publicAccess = async () => (await db.query<{ allowed: boolean }>(`SELECT COALESCE(bool_or(a.grantee=0),false) AS allowed
    FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
    WHERE c.oid IN ('pulse.mailchimp_records'::regclass,'pulse.mailchimp_sync'::regclass)`)).rows[0]!.allowed;
  assert.equal(await publicAccess(), false);
  await db.query('GRANT SELECT, UPDATE ON pulse.mailchimp_records, pulse.mailchimp_sync TO PUBLIC');
  assert.equal(await publicAccess(), true);
  const migration = await readFile(new URL('../migrations/060_carry_fixes.sql', import.meta.url), 'utf8');
  await db.query(migration);
  assert.equal(await publicAccess(), false);
  await db.query(migration);
  assert.equal(await publicAccess(), false);
});
