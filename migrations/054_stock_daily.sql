-- Small daily observations from already-stored inventory; no historical backfill.
CREATE TABLE pulse.stock_daily (
  mode text NOT NULL CHECK (mode IN ('sample', 'live')),
  day date NOT NULL,
  location_id text NOT NULL,
  inventory_item_id text NOT NULL,
  product_id text NOT NULL,
  available integer NOT NULL,
  taken_at timestamptz NOT NULL,
  fetched_at timestamptz NOT NULL,
  source text NOT NULL DEFAULT 'shopify' CHECK (source = 'shopify'),
  source_id text NOT NULL,
  brand text NOT NULL DEFAULT 'one-of-one' CHECK (brand = 'one-of-one'),
  PRIMARY KEY (mode, day, location_id, inventory_item_id)
);
REVOKE ALL ON pulse.stock_daily FROM PUBLIC;
