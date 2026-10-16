-- Existing spend coverage predates action metrics; certify it only after a fresh read.
ALTER TABLE pulse.ad_spend_jobs ADD COLUMN actions_backfilled_at timestamptz;
ALTER TABLE pulse.ad_spend_days ADD COLUMN actions_complete boolean NOT NULL DEFAULT false;
