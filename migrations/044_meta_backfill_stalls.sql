ALTER TABLE pulse.ad_spend_jobs ADD COLUMN backfill_failures integer NOT NULL DEFAULT 0 CHECK(backfill_failures>=0);
