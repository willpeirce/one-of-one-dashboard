ALTER TABLE pulse.stock_daily ADD COLUMN IF NOT EXISTS sku text;

-- Legacy tables retain the original SKU's history and constraints.
CREATE TABLE IF NOT EXISTS pulse.series_stock_snapshots (
  sku text NOT NULL,
  day date NOT NULL,
  location_id text NOT NULL,
  inventory_item_id text NOT NULL,
  available integer NOT NULL,
  taken_at timestamptz NOT NULL,
  late boolean NOT NULL,
  PRIMARY KEY (sku, location_id, day)
);
CREATE TABLE IF NOT EXISTS pulse.series_sku_sales (
  sku text NOT NULL,
  day date NOT NULL,
  market text NOT NULL CHECK (market IN ('UK', 'US')),
  sold integer NOT NULL,
  fetched_at timestamptz NOT NULL,
  PRIMARY KEY (sku, market, day)
);
CREATE TABLE IF NOT EXISTS pulse.configured_series (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  series jsonb NOT NULL CHECK (jsonb_typeof(series) = 'array')
);
REVOKE ALL ON pulse.series_stock_snapshots, pulse.series_sku_sales, pulse.configured_series FROM PUBLIC;

-- Extend the local audit allowlist with the same field-path constraints.
DO $$ DECLARE c record; BEGIN
  FOR c IN SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE conrelid='pulse.settings_changes'::regclass AND contype='c'
      AND pg_get_constraintdef(oid) LIKE '%goalOrdersPerDay%'
      AND pg_get_constraintdef(oid) NOT LIKE '%''series''%'
  LOOP
    EXECUTE format('ALTER TABLE pulse.settings_changes DROP CONSTRAINT %I',c.conname);
    EXECUTE format('ALTER TABLE pulse.settings_changes ADD CONSTRAINT %I %s',c.conname,
      replace(c.definition,'''goalOrdersPerDay''','''series'', ''goalOrdersPerDay'''));
  END LOOP;
END $$;
