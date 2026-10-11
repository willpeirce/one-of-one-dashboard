-- Live warehouse observations only; the sample card uses explicitly invented fixtures.
CREATE TABLE pulse.stock_snapshots (
  day date NOT NULL,
  location_id text NOT NULL,
  inventory_item_id text NOT NULL,
  available integer NOT NULL,
  taken_at timestamptz NOT NULL,
  late boolean NOT NULL,
  source text NOT NULL DEFAULT 'shopify' CHECK (source = 'shopify'),
  brand text NOT NULL DEFAULT 'one-of-one' CHECK (brand = 'one-of-one'),
  PRIMARY KEY (location_id, day)
);
CREATE TABLE pulse.series_pace_sales (
  day date NOT NULL,
  market text NOT NULL CHECK (market IN ('UK', 'US')),
  sold integer NOT NULL,
  fetched_at timestamptz NOT NULL,
  source text NOT NULL DEFAULT 'shopify' CHECK (source = 'shopify'),
  brand text NOT NULL DEFAULT 'one-of-one' CHECK (brand = 'one-of-one'),
  PRIMARY KEY (market, day)
);
REVOKE ALL ON pulse.stock_snapshots, pulse.series_pace_sales FROM PUBLIC;

DO $$
DECLARE
  field_check text;
BEGIN
  SELECT c.conname INTO STRICT field_check
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
  WHERE c.conrelid = 'pulse.settings_changes'::regclass
    AND c.contype = 'c' AND a.attname = 'field';

  EXECUTE format('ALTER TABLE pulse.settings_changes DROP CONSTRAINT %I', field_check);
  EXECUTE format($check$
    ALTER TABLE pulse.settings_changes ADD CONSTRAINT %I CHECK (
      length(field) BETWEEN 1 AND 160
      AND field ~ '^[a-zA-Z][a-zA-Z0-9]*([.][a-zA-Z0-9]+)*$'
      AND split_part(field, '.', 1) IN (
        'goalOrdersPerDay', 'goalNetMarginPercent', 'overheads', 'monthlyOverheadsGbp',
        'cppUkBreakEvenGbp', 'cppUkTargetGbp', 'cppUsBreakEvenGbp', 'cppUsTargetGbp',
        'paymentFeePercent', 'startingCogs', 'jjGbpPerUsd',
        'flatFulfilmentUkGbp', 'flatFulfilmentUsGbp',
        'dispatchCutoffUk', 'dispatchCutoffUs', 'supplierLeadTimes', 'safetyWeeks',
        'seasonalMultiplier', 'markersPerKit', 'pencilsPerKit',
        'metaAdAccountId', 'googleCustomerId', 'googleLoginCustomerId', 'tiktokAdvertiserId',
        'metaOwners', 'expectedGoogleCampaigns', 'blendedMetaTripwireGbp', 'creatorRules',
        'waitingContacts', 'deadlines', 'keyExpiryDates', 'morningSummaryEnabled', 'brand',
        'series1OrderDate', 'series1UkLandingOffsetDays', 'series1UsLandingOffsetDays',
        'series1UkTargetDate', 'series1UsTargetDate'
      )
    )
  $check$, field_check);
END;
$$;
