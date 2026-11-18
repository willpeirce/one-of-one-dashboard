-- Only these two main-branch files join the existing fixed HQ read targets.
DO $$ DECLARE c record; BEGIN
  FOR c IN SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE conrelid='pulse.github_hq_reads'::regclass AND contype='c'
      AND pg_get_constraintdef(oid) LIKE '%ops/tests/register.md%'
      AND pg_get_constraintdef(oid) LIKE '%ops/ads-daily/%'
      AND pg_get_constraintdef(oid) NOT LIKE '%ops/kit-board/kits.json%'
  LOOP
    EXECUTE format('ALTER TABLE pulse.github_hq_reads DROP CONSTRAINT %I',c.conname);
    EXECUTE format('ALTER TABLE pulse.github_hq_reads ADD CONSTRAINT %I %s',c.conname,
      replace(c.definition,'''ops/tests/register.md''','''ops/kit-board/kits.json'' OR path = ''ops/kit-board/orders.json'' OR path = ''ops/tests/register.md'''));
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='pulse.github_hq_reads'::regclass
    AND conname='github_hq_reads_kits_main') THEN
    ALTER TABLE pulse.github_hq_reads ADD CONSTRAINT github_hq_reads_kits_main
      CHECK (path NOT IN ('ops/kit-board/kits.json','ops/kit-board/orders.json') OR ref = 'main');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS pulse.kit_board_files (
  kind text PRIMARY KEY CHECK (kind IN ('kits','kit-orders')),
  status text NOT NULL CHECK (status IN ('ready','missing')),
  updated_at timestamptz,
  read_at timestamptz NOT NULL,
  skipped_rows integer NOT NULL DEFAULT 0 CHECK (skipped_rows>=0),
  capped_rows integer NOT NULL DEFAULT 0 CHECK (capped_rows>=0)
);
REVOKE ALL ON pulse.kit_board_files FROM PUBLIC;

CREATE TABLE IF NOT EXISTS pulse.kit_board_kits (
  id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 40 AND id ~ '^[a-zA-Z0-9][a-zA-Z0-9_-]*$'),
  row_order integer NOT NULL CHECK (row_order BETWEEN 0 AND 39),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  series text NOT NULL CHECK (length(series)<=80),
  status text NOT NULL CHECK (length(status)<=30),
  gate integer NOT NULL CHECK (gate BETWEEN 0 AND 6),
  launch_target date,
  launch_label text CHECK (length(launch_label)<=60),
  brief_due date,
  milestone text CHECK (length(milestone)<=120),
  next_action text NOT NULL CHECK (length(next_action)<=200),
  owner text NOT NULL CHECK (length(owner)<=20),
  waiting_with text NOT NULL CHECK (length(waiting_with)<=120),
  waiting_since date,
  note text NOT NULL CHECK (length(note)<=300)
);
REVOKE ALL ON pulse.kit_board_kits FROM PUBLIC;

CREATE TABLE IF NOT EXISTS pulse.kit_board_orders (
  id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 40 AND id ~ '^[a-zA-Z0-9][a-zA-Z0-9_-]*$'),
  row_order integer NOT NULL CHECK (row_order BETWEEN 0 AND 199),
  kit text NOT NULL CHECK (length(kit) BETWEEN 1 AND 40),
  supplier text NOT NULL CHECK (length(supplier)<=80),
  item text NOT NULL CHECK (length(item)<=160),
  qty integer CHECK (qty BETWEEN 0 AND 10000000),
  ordered_date date,
  eta date,
  status text NOT NULL CHECK (length(status)<=160)
);
REVOKE ALL ON pulse.kit_board_orders FROM PUBLIC;
