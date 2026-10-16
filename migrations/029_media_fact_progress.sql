ALTER TABLE pulse.media_groups
  ADD COLUMN size_unavailable boolean NOT NULL DEFAULT false,
  ADD COLUMN length_unavailable boolean NOT NULL DEFAULT false,
  ADD COLUMN facts_retry_after timestamptz,
  ADD COLUMN facts_error text;
ALTER TABLE pulse.creative_jobs ADD COLUMN media_facts_last_run timestamptz;
