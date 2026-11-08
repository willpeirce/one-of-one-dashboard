ALTER TABLE pulse.meta_activity_sync ADD COLUMN skipped_rows integer NOT NULL DEFAULT 0 CHECK (skipped_rows >= 0);
