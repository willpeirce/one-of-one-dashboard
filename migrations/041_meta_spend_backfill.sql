ALTER TABLE pulse.ad_spend_jobs
  ADD COLUMN backfill_first date,
  ADD COLUMN backfill_window_days integer NOT NULL DEFAULT 14 CHECK (backfill_window_days BETWEEN 1 AND 14),
  ADD COLUMN backfill_next_run_at timestamptz,
  ADD COLUMN backfill_error text;
UPDATE pulse.ad_spend_jobs SET
  backfill_first=(CURRENT_TIMESTAMP AT TIME ZONE 'Europe/London')::date-400,
  backfill_next=(CURRENT_TIMESTAMP AT TIME ZONE 'Europe/London')::date-400,
  backfill_done=false, backfill_next_run_at=CURRENT_TIMESTAMP
WHERE source='meta';
ALTER TABLE pulse.ad_spend ADD COLUMN day_basis text NOT NULL DEFAULT 'uk' CHECK (day_basis IN ('uk','gmt'));
