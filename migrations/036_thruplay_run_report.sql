ALTER TABLE pulse.creative_jobs
 ADD COLUMN thruplay_last_run_at timestamptz,
 ADD COLUMN thruplay_run_report jsonb;
