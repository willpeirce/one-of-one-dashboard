CREATE TABLE pulse.meta_campaigns (
  campaign_id text PRIMARY KEY,
  source text NOT NULL DEFAULT 'meta' CHECK (source = 'meta'),
  brand text NOT NULL DEFAULT 'one-of-one' CHECK (brand = 'one-of-one'),
  account_id text NOT NULL,
  name text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  first_seen timestamptz NOT NULL,
  last_seen timestamptz NOT NULL
);
CREATE INDEX meta_campaigns_account_created ON pulse.meta_campaigns(account_id, created_at DESC);
REVOKE ALL ON pulse.meta_campaigns FROM PUBLIC;
