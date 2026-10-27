CREATE TABLE pulse.meta_activity (
 brand text NOT NULL DEFAULT 'one-of-one', source text NOT NULL DEFAULT 'meta',
 account_id text NOT NULL, event_id text NOT NULL, event_time timestamptz NOT NULL,
 data jsonb NOT NULL, fetched_at timestamptz NOT NULL,
 PRIMARY KEY(account_id,event_id)
);
CREATE INDEX meta_activity_time ON pulse.meta_activity(account_id,event_time DESC);
CREATE TABLE pulse.meta_activity_sync (
 account_id text PRIMARY KEY, last_attempt timestamptz NOT NULL,
 last_success timestamptz, error text
);
REVOKE ALL ON pulse.meta_activity,pulse.meta_activity_sync FROM PUBLIC;
-- Retain the existing allowlist, including retired historical fields, and add this group.
DO $$ DECLARE c record; BEGIN
  FOR c IN SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE conrelid='pulse.settings_changes'::regclass AND contype='c'
      AND pg_get_constraintdef(oid) LIKE '%goalOrdersPerDay%'
  LOOP
    EXECUTE format('ALTER TABLE pulse.settings_changes DROP CONSTRAINT %I',c.conname);
    EXECUTE format('ALTER TABLE pulse.settings_changes ADD CONSTRAINT %I %s',c.conname,
      replace(c.definition,'''goalOrdersPerDay''','''ourActors'', ''goalOrdersPerDay'''));
  END LOOP;
END $$;
