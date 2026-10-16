-- Refused historical days remain incomplete while the initial cursor moves on.
ALTER TABLE pulse.creative_insight_days ADD COLUMN error_code text;
ALTER TABLE pulse.creative_insight_days ADD COLUMN retry_after timestamptz;
