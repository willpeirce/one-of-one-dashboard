ALTER TABLE pulse.media_groups ADD COLUMN detail_reduced_at timestamptz;
-- Keep the first refusal time while limiting subsequent failed recoveries to once a day.
ALTER TABLE pulse.media_groups ADD COLUMN detail_retry_after timestamptz;
ALTER TABLE pulse.media_groups ADD CONSTRAINT media_groups_scope UNIQUE(mode,account_id,id);

CREATE TABLE pulse.creative_scans (
  sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  id text PRIMARY KEY,
  mode text NOT NULL CHECK(mode IN ('sample','live')), account_id text NOT NULL,
  media_group_id text NOT NULL, model_id text NOT NULL,
  status text NOT NULL CHECK(status IN ('done','failed')),
  failure_reason text CHECK(failure_reason IN ('refused','malformed','timeout','cap','network','prices')),
  http_status integer CHECK(http_status BETWEEN 100 AND 599),
  input_tokens bigint NOT NULL DEFAULT 0 CHECK(input_tokens>=0),
  output_tokens bigint NOT NULL DEFAULT 0 CHECK(output_tokens>=0),
  cost_gbp numeric(18,10) NOT NULL DEFAULT 0 CHECK(cost_gbp>=0),
  raw_response text NOT NULL DEFAULT '' CHECK(octet_length(raw_response)<=20480),
  requested_at timestamptz NOT NULL, finished_at timestamptz NOT NULL, retry_after timestamptz,
  poster_only boolean NOT NULL DEFAULT false,
  dropped_count integer NOT NULL DEFAULT 0 CHECK(dropped_count>=0),
  FOREIGN KEY(mode,account_id,media_group_id) REFERENCES pulse.media_groups(mode,account_id,id),
  CHECK((status='done' AND failure_reason IS NULL) OR (status='failed' AND failure_reason IS NOT NULL))
);
CREATE INDEX creative_scans_group ON pulse.creative_scans(mode,account_id,media_group_id,model_id,requested_at DESC);
CREATE INDEX creative_scans_day ON pulse.creative_scans(mode,account_id,requested_at);
REVOKE ALL ON pulse.creative_scans FROM PUBLIC;
