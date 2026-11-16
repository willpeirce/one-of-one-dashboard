-- A fixed read target only: arbitrary paths and non-main waiting files remain disallowed.
DO $$ DECLARE c record; BEGIN
  FOR c IN SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE conrelid='pulse.github_hq_reads'::regclass AND contype='c'
      AND pg_get_constraintdef(oid) LIKE '%ops/tests/register.md%'
      AND pg_get_constraintdef(oid) LIKE '%ops/ads-daily/%'
      AND pg_get_constraintdef(oid) NOT LIKE '%ops/waiting-on/latest.md%'
  LOOP
    EXECUTE format('ALTER TABLE pulse.github_hq_reads DROP CONSTRAINT %I',c.conname);
    EXECUTE format('ALTER TABLE pulse.github_hq_reads ADD CONSTRAINT %I %s',c.conname,
      replace(c.definition,'''ops/tests/register.md''','''ops/waiting-on/latest.md'' OR path = ''ops/tests/register.md'''));
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='pulse.github_hq_reads'::regclass
    AND conname='github_hq_reads_waiting_main') THEN
    ALTER TABLE pulse.github_hq_reads ADD CONSTRAINT github_hq_reads_waiting_main
      CHECK (path <> 'ops/waiting-on/latest.md' OR ref = 'main');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS pulse.waiting_on_items (
  id text PRIMARY KEY CHECK (id ~ '^(hq|manual):[a-f0-9]{64}$'),
  source text NOT NULL CHECK (source IN ('hq','manual')),
  contact text NOT NULL CHECK (length(contact) BETWEEN 1 AND 80),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 240),
  since date NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
REVOKE ALL ON pulse.waiting_on_items FROM PUBLIC;

-- Done survives a partial file that cannot certify a row's removal.
CREATE TABLE IF NOT EXISTS pulse.waiting_on_done (
  item_id text PRIMARY KEY CHECK (item_id ~ '^(hq|manual):[a-f0-9]{64}$'),
  done_at timestamptz NOT NULL
);
REVOKE ALL ON pulse.waiting_on_done FROM PUBLIC;

CREATE TABLE IF NOT EXISTS pulse.waiting_on_file (
  singleton boolean PRIMARY KEY CHECK (singleton),
  status text NOT NULL CHECK (status IN ('ready','missing')),
  updated_label text CHECK (updated_label IS NULL OR length(updated_label)=19),
  read_at timestamptz NOT NULL,
  skipped_rows integer NOT NULL DEFAULT 0 CHECK (skipped_rows>=0),
  capped_rows integer NOT NULL DEFAULT 0 CHECK (capped_rows>=0)
);
REVOKE ALL ON pulse.waiting_on_file FROM PUBLIC;

DO $$ DECLARE c record; BEGIN
  FOR c IN SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE conrelid='pulse.settings_changes'::regclass AND contype='c'
      AND pg_get_constraintdef(oid) LIKE '%goalOrdersPerDay%'
      AND pg_get_constraintdef(oid) NOT LIKE '%''waitingOnDays''%'
  LOOP
    EXECUTE format('ALTER TABLE pulse.settings_changes DROP CONSTRAINT %I',c.conname);
    EXECUTE format('ALTER TABLE pulse.settings_changes ADD CONSTRAINT %I %s',c.conname,
      replace(c.definition,'''goalOrdersPerDay''','''waitingOnDays'', ''goalOrdersPerDay'''));
  END LOOP;
END $$;
