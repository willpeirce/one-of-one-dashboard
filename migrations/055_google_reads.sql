-- Small additive Google read caches. Existing spend remains independently committed.
CREATE TABLE pulse.google_rows (
  brand text NOT NULL DEFAULT 'one-of-one' CHECK (brand='one-of-one'),
  source text NOT NULL DEFAULT 'google-ads' CHECK (source='google-ads'),
  mode text NOT NULL CHECK (mode IN ('sample','live')),
  account_id text NOT NULL, kind text NOT NULL CHECK (kind IN ('campaigns','networks','conversions','changes','daily')),
  source_id text NOT NULL, day date, data jsonb NOT NULL, fetched_at timestamptz NOT NULL,
  PRIMARY KEY (mode,account_id,kind,source_id)
);
CREATE INDEX google_rows_window ON pulse.google_rows(mode,account_id,kind,day);
CREATE TABLE pulse.google_sync (
  brand text NOT NULL DEFAULT 'one-of-one' CHECK (brand='one-of-one'),
  source text NOT NULL DEFAULT 'google-ads' CHECK (source='google-ads'),
  mode text NOT NULL CHECK (mode IN ('sample','live')),
  account_id text NOT NULL, kind text NOT NULL CHECK (kind IN ('campaigns','networks','conversions','changes','daily')),
  last_attempt_at timestamptz, last_success_at timestamptz, failures integer NOT NULL DEFAULT 0,
  error text, currency text, coverage jsonb,
  PRIMARY KEY (mode,account_id,kind)
);
ALTER TABLE pulse.ad_spend_jobs ADD COLUMN google_history_operations integer NOT NULL DEFAULT 0;
ALTER TABLE pulse.ad_spend_jobs ADD COLUMN google_quota_error text;
REVOKE ALL ON pulse.google_rows, pulse.google_sync FROM PUBLIC;
