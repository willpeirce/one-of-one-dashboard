CREATE TABLE pulse.mailchimp_records (
  mode text NOT NULL CHECK (mode IN ('sample', 'live')),
  kind text NOT NULL CHECK (kind = 'audience'),
  source_id text NOT NULL,
  data jsonb NOT NULL,
  source text NOT NULL DEFAULT 'mailchimp' CHECK (source = 'mailchimp'),
  fetched_at timestamptz NOT NULL,
  brand text NOT NULL DEFAULT 'one-of-one' CHECK (brand = 'one-of-one'),
  PRIMARY KEY (mode, kind, source_id)
);
CREATE TABLE pulse.mailchimp_sync (
  mode text PRIMARY KEY CHECK (mode IN ('sample', 'live')),
  next_run_at timestamptz NOT NULL,
  last_success_at timestamptz,
  last_attempt_at timestamptz NOT NULL,
  last_error text,
  failures integer NOT NULL DEFAULT 0 CHECK (failures >= 0)
);
