-- Source rows are segregated by mode so adding/removing keys cannot mix samples and live data.
CREATE TABLE pulse.shopify_records (
  mode text NOT NULL CHECK (mode IN ('sample', 'live')),
  kind text NOT NULL CHECK (kind IN ('order', 'inventory', 'sessions', 'sales')),
  source text NOT NULL DEFAULT 'shopify' CHECK (source = 'shopify'),
  source_id text NOT NULL,
  brand text NOT NULL DEFAULT 'one-of-one' CHECK (brand = 'one-of-one'),
  fetched_at timestamptz NOT NULL,
  source_updated_at timestamptz NOT NULL,
  data jsonb NOT NULL,
  PRIMARY KEY (mode, kind, source_id)
);
CREATE TABLE pulse.shopify_jobs (
  mode text NOT NULL CHECK (mode IN ('sample', 'live')),
  name text NOT NULL,
  state jsonb NOT NULL DEFAULT '{}',
  next_run_at timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz,
  failures integer NOT NULL DEFAULT 0,
  PRIMARY KEY (mode, name)
);
CREATE TABLE pulse.shopify_webhook_inbox (
  source text NOT NULL DEFAULT 'shopify' CHECK (source = 'shopify'),
  source_id text PRIMARY KEY,
  brand text NOT NULL DEFAULT 'one-of-one' CHECK (brand = 'one-of-one'),
  fetched_at timestamptz NOT NULL DEFAULT now(),
  topic text NOT NULL,
  -- Signature is checked over original bytes; only the replay identifiers survive privacy filtering.
  payload jsonb NOT NULL,
  processed_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shopify_inbox_pending ON pulse.shopify_webhook_inbox (next_attempt_at) WHERE processed_at IS NULL;
CREATE TABLE pulse.shopify_notices (
  mode text NOT NULL CHECK (mode IN ('sample', 'live')),
  source text NOT NULL DEFAULT 'shopify' CHECK (source = 'shopify'),
  source_id text NOT NULL,
  brand text NOT NULL DEFAULT 'one-of-one' CHECK (brand = 'one-of-one'),
  fetched_at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL CHECK (kind IN ('webhook_recreated', 'geo_unreliable', 'reports_unavailable', 'address_unavailable')),
  PRIMARY KEY (mode, source_id)
);
