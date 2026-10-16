CREATE TABLE pulse.meta_ad_sets (
  account_id text NOT NULL, ad_set_id text NOT NULL, campaign_id text NOT NULL,
  source text NOT NULL DEFAULT 'meta' CHECK (source='meta'),
  brand text NOT NULL DEFAULT 'one-of-one' CHECK (brand='one-of-one'),
  name text NOT NULL, status text NOT NULL, effective_status text NOT NULL,
  daily_budget bigint, lifetime_budget bigint, currency text NOT NULL,
  created_time timestamptz NOT NULL, updated_time timestamptz NOT NULL,
  learning_stage text, last_significant_edit timestamptz,
  market text NOT NULL CHECK (market IN ('uk','us','unknown')),
  first_seen timestamptz NOT NULL, last_seen timestamptz NOT NULL, last_read timestamptz NOT NULL,
  PRIMARY KEY (account_id,ad_set_id)
);
CREATE TABLE pulse.meta_ad_set_sync (
  account_id text PRIMARY KEY, last_read timestamptz NOT NULL
);
REVOKE ALL ON pulse.meta_ad_sets,pulse.meta_ad_set_sync FROM PUBLIC;
