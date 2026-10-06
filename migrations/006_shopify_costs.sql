CREATE TABLE pulse.shopify_cost_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  mode text NOT NULL CHECK (mode IN ('sample', 'live')),
  source text NOT NULL DEFAULT 'shopify',
  source_id text NOT NULL,
  brand text NOT NULL DEFAULT 'one-of-one',
  variant_id text NOT NULL,
  inventory_item_id text NOT NULL,
  sku text,
  product_id text NOT NULL,
  amount_pence bigint CHECK (amount_pence >= 0),
  currency text CHECK (currency ~ '^[A-Z]{3}$'),
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  CHECK (last_seen_at >= first_seen_at),
  CHECK ((amount_pence IS NULL) = (currency IS NULL))
);
CREATE INDEX shopify_cost_variant_history ON pulse.shopify_cost_history (mode, variant_id, first_seen_at DESC);
CREATE INDEX shopify_cost_sku_history ON pulse.shopify_cost_history (mode, sku, first_seen_at DESC);
REVOKE ALL ON pulse.shopify_cost_history FROM PUBLIC;
