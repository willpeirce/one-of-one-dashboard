CREATE TABLE pulse.meta_spend_hours (
  brand text NOT NULL DEFAULT 'one-of-one' CHECK (brand='one-of-one'),
  source text NOT NULL DEFAULT 'meta' CHECK (source='meta'),
  account_id text NOT NULL, campaign_id text NOT NULL, campaign_name text NOT NULL,
  ad_set_id text NOT NULL, ad_set_name text NOT NULL,
  market text NOT NULL CHECK (market IN ('uk','us','unknown')),
  owner text NOT NULL CHECK (owner IN ('ours','freelancer','unassigned')),
  uk_day date NOT NULL, uk_hour integer NOT NULL CHECK (uk_hour BETWEEN 0 AND 23),
  spend_amount numeric(24,6) NOT NULL CHECK (spend_amount>=0), currency text NOT NULL,
  fetched_at timestamptz NOT NULL,
  PRIMARY KEY (account_id,campaign_id,ad_set_id,uk_day,uk_hour)
);
ALTER TABLE pulse.ad_spend_days ADD COLUMN hourly_complete boolean NOT NULL DEFAULT false;
REVOKE ALL ON pulse.meta_spend_hours FROM PUBLIC;
