UPDATE pulse.settings
SET values = (values - 'monthlyOverheadsGbp') || jsonb_build_object(
  'overheads', CASE
    WHEN values ? 'overheads' THEN values->'overheads'
    WHEN jsonb_typeof(values->'monthlyOverheadsGbp') = 'number'
      AND (values->>'monthlyOverheadsGbp')::numeric > 0
    THEN jsonb_build_array(jsonb_build_object(
      'name', 'Overheads', 'monthlyGbp', values->'monthlyOverheadsGbp',
      'startMonth', '', 'endMonth', ''
    ))
    ELSE '[]'::jsonb
  END
);

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
        'waitingContacts', 'deadlines', 'keyExpiryDates', 'morningSummaryEnabled', 'brand'
      )
    )
  $check$, field_check);
END;
$$;
