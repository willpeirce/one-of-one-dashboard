CREATE TABLE pulse.fulfilment_uploads (
  id uuid PRIMARY KEY,
  mode text NOT NULL CHECK (mode IN ('sample','live')),
  source text NOT NULL DEFAULT 'j-and-j', source_id text NOT NULL,
  brand text NOT NULL DEFAULT 'one-of-one',
  file_name text NOT NULL, row_count integer NOT NULL, saved_count integer NOT NULL,
  despatch_from timestamp NOT NULL, despatch_to timestamp NOT NULL,
  uploaded_at timestamptz NOT NULL, gbp_per_usd numeric(12,6) NOT NULL CHECK (gbp_per_usd > 0),
  error_pence numeric, error_count integer NOT NULL DEFAULT 0,
  coverage_week date CHECK (extract(isodow FROM coverage_week) = 1),
  changes jsonb NOT NULL DEFAULT '[]'
);
CREATE TABLE pulse.fulfilment_parcels (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  mode text NOT NULL CHECK (mode IN ('sample','live')),
  source text NOT NULL DEFAULT 'j-and-j', source_id text NOT NULL,
  brand text NOT NULL DEFAULT 'one-of-one', fetched_at timestamptz NOT NULL,
  order_number text NOT NULL CHECK (order_number ~ '^[0-9]+$'), order_id text,
  despatched_at timestamp NOT NULL,
  warehouse text NOT NULL CHECK (warehouse IN ('uk','us','unknown')), centre text NOT NULL,
  service text NOT NULL, carrier text NOT NULL, country text NOT NULL,
  boxed_grams integer NOT NULL CHECK (boxed_grams >= 0),
  currency text CHECK (currency IN ('GBP','USD')),
  postage_minor bigint NOT NULL, pick_pack_minor bigint NOT NULL,
  customer_paid_pence bigint NOT NULL, gbp_per_usd numeric(12,6) NOT NULL,
  upload_id uuid NOT NULL REFERENCES pulse.fulfilment_uploads(id),
  replaced_estimate_pence bigint, rate_baseline_pence numeric,
  flags jsonb NOT NULL DEFAULT '[]',
  UNIQUE (mode, order_number, despatched_at)
);
CREATE TABLE pulse.fulfilment_rates (
  mode text NOT NULL CHECK (mode IN ('sample','live')),
  warehouse text NOT NULL, service text NOT NULL, sku_mix text NOT NULL, state text NOT NULL,
  mean_postage_minor numeric NOT NULL, mean_pick_pack_minor numeric NOT NULL,
  count integer NOT NULL, last_seen timestamp NOT NULL,
  PRIMARY KEY (mode,warehouse,service,sku_mix,state)
);
CREATE TABLE pulse.fulfilment_models (
  mode text PRIMARY KEY CHECK (mode IN ('sample','live')),
  data jsonb NOT NULL DEFAULT '{}', updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE pulse.fulfilment_estimates (
  mode text NOT NULL CHECK (mode IN ('sample','live')), order_id text NOT NULL,
  cost_pence bigint, source text NOT NULL CHECK (source IN ('actual','exact','ladder','flat','unknown')),
  warehouse text NOT NULL, service text, guess boolean NOT NULL, updated_at timestamptz NOT NULL,
  PRIMARY KEY (mode,order_id)
);
UPDATE pulse.settings SET values = values || '{"jjGbpPerUsd":0.754}'::jsonb WHERE NOT values ? 'jjGbpPerUsd';
-- Same one-time re-fetch as 005, retaining the fixed window and last good rows.
UPDATE pulse.shopify_jobs SET state = (state - 'ordersDone' - 'after') || '{"after":null}'::jsonb,
  next_run_at = now() WHERE name = 'backfill';
REVOKE ALL ON pulse.fulfilment_uploads, pulse.fulfilment_parcels, pulse.fulfilment_rates,
  pulse.fulfilment_models, pulse.fulfilment_estimates FROM PUBLIC;
