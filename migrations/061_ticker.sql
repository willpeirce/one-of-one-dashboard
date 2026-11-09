-- Local planning state is separate for sample and live dates.
CREATE TABLE IF NOT EXISTS pulse.ticker_passed (
  mode text NOT NULL CHECK (mode IN ('sample', 'live')),
  event_key text NOT NULL CHECK (length(event_key) BETWEEN 1 AND 220),
  passed_at timestamptz NOT NULL,
  credential_id text NOT NULL,
  PRIMARY KEY (mode, event_key)
);
REVOKE ALL ON pulse.ticker_passed FROM PUBLIC;

-- Preserve the audited Settings allowlist and make replay a no-op for this key.
DO $$ DECLARE c record; BEGIN
  FOR c IN SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE conrelid='pulse.settings_changes'::regclass AND contype='c'
      AND pg_get_constraintdef(oid) LIKE '%goalOrdersPerDay%'
      AND pg_get_constraintdef(oid) NOT LIKE '%''keyDates''%'
  LOOP
    EXECUTE format('ALTER TABLE pulse.settings_changes DROP CONSTRAINT %I',c.conname);
    EXECUTE format('ALTER TABLE pulse.settings_changes ADD CONSTRAINT %I %s',c.conname,
      replace(c.definition,'''goalOrdersPerDay''','''keyDates'', ''goalOrdersPerDay'''));
  END LOOP;
END $$;
