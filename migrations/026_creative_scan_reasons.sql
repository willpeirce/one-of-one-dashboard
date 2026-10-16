ALTER TABLE pulse.creative_scans ADD COLUMN provider_code text;
ALTER TABLE pulse.creative_scans DROP CONSTRAINT creative_scans_failure_reason_check;
ALTER TABLE pulse.creative_scans ADD CONSTRAINT creative_scans_failure_reason_check
  CHECK(failure_reason IN ('refused','malformed','timeout','cap','network','prices','media too large','unsupported type'));
-- Previously repeated failures waited a week. Make retained failures eligible the next UK day.
UPDATE pulse.creative_scans SET retry_after=LEAST(retry_after,
  (((finished_at AT TIME ZONE 'Europe/London')::date+1)::timestamp AT TIME ZONE 'Europe/London'))
WHERE status='failed' AND failure_reason NOT IN ('cap','prices');
