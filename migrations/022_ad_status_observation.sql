-- Begin observation now: existing created_time does not establish the current status age.
ALTER TABLE pulse.ads ADD COLUMN status_since timestamptz NOT NULL DEFAULT now();
