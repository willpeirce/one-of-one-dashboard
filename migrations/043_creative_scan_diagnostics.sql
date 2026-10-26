ALTER TABLE pulse.creative_scans ADD COLUMN provider_message text CHECK (length(provider_message)<=200);
ALTER TABLE pulse.creative_scans ADD COLUMN omitted_config text CHECK (omitted_config IN ('effort','format'));
ALTER TABLE pulse.creative_scans DROP CONSTRAINT creative_scans_failure_reason_check;
ALTER TABLE pulse.creative_scans ADD CONSTRAINT creative_scans_failure_reason_check
 CHECK(failure_reason IN ('rejected','refused','malformed','timeout','cap','network','prices','media too large','unsupported type'));
