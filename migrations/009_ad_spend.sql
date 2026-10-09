UPDATE pulse.settings SET values = values || '{"metaAdAccountId":"","googleCustomerId":"","googleLoginCustomerId":"","tiktokAdvertiserId":"","expectedGoogleCampaigns":[]}'::jsonb;
-- Retain saved assignments; removing a mapping now means unassigned.
UPDATE pulse.settings SET values=jsonb_set(values,'{metaOwners}',COALESCE((SELECT jsonb_agg(rule) FROM jsonb_array_elements(values->'metaOwners') AS rule WHERE rule->>'owner' IN ('ours','freelancer')),'[]'::jsonb));
CREATE TABLE pulse.ad_spend (
  brand text NOT NULL DEFAULT 'one-of-one' CHECK (brand = 'one-of-one'),
  mode text NOT NULL CHECK (mode IN ('sample','live')),
  source text NOT NULL CHECK (source IN ('meta','google-ads','tiktok')),
  account_id text NOT NULL, campaign_id text NOT NULL, campaign_name text NOT NULL,
  ad_set_id text, ad_set_name text,
  market text NOT NULL CHECK (market IN ('uk','us','unknown')),
  owner text NOT NULL CHECK (owner IN ('ours','freelancer','unassigned')),
  uk_day date NOT NULL, spend_amount numeric(24,6) NOT NULL CHECK (spend_amount >= 0),
  spend_gbp numeric(24,6), currency text NOT NULL, fetched_at timestamptz NOT NULL,
  UNIQUE NULLS NOT DISTINCT (mode,source,campaign_id,ad_set_id,uk_day)
);
CREATE INDEX ad_spend_range ON pulse.ad_spend(mode,source,account_id,uk_day);
CREATE TABLE pulse.ad_spend_jobs (
  source text NOT NULL, account_id text NOT NULL,
  backfill_next date NOT NULL DEFAULT '2026-08-07', backfill_done boolean NOT NULL DEFAULT false,
  operations_day date, operations integer NOT NULL DEFAULT 0,
  last_poll_at timestamptz, last_success_at timestamptz, failures integer NOT NULL DEFAULT 0,
  PRIMARY KEY (source,account_id)
);
CREATE TABLE pulse.ad_spend_days (
  source text NOT NULL, account_id text NOT NULL, uk_day date NOT NULL,
  fetched_at timestamptz NOT NULL, PRIMARY KEY (source,account_id,uk_day)
);
REVOKE ALL ON pulse.ad_spend, pulse.ad_spend_jobs, pulse.ad_spend_days FROM PUBLIC;
