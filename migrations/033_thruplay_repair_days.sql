CREATE TABLE pulse.creative_thruplay_days (
  account_id text NOT NULL,
  day date NOT NULL,
  completed boolean NOT NULL DEFAULT false,
  error_code text,
  retry_after timestamptz,
  fetched_at timestamptz,
  PRIMARY KEY(account_id,day)
);
REVOKE ALL ON pulse.creative_thruplay_days FROM PUBLIC;
-- Replace the old all-or-nothing repair with a fresh bounded window and durable day outcomes.
UPDATE pulse.creative_jobs SET thruplays_backfilled_at=NULL;
