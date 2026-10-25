ALTER TABLE pulse.creative_thruplay_days
 ADD COLUMN read_count integer NOT NULL DEFAULT 0,
 ADD COLUMN given_up_reason text;
-- Re-read open days using the narrow report's omitted-field-means-zero rule.
UPDATE pulse.creative_thruplay_days SET retry_after=NULL WHERE NOT completed;
