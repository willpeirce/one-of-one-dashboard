-- Keep malformed check-card tags with the selected report, independently of monthly read state.
ALTER TABLE pulse.github_hq_reports
  ADD COLUMN IF NOT EXISTS malformed_card_tags integer NOT NULL DEFAULT 0 CHECK (malformed_card_tags >= 0);
