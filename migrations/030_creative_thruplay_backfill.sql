-- Missing provider data is different from a measured zero.
ALTER TABLE pulse.ad_insights_daily ALTER COLUMN thru_plays DROP NOT NULL;
ALTER TABLE pulse.creative_jobs ADD COLUMN thruplays_backfilled_at timestamptz;
