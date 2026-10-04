CREATE TABLE pulse.settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  values jsonb NOT NULL CHECK (jsonb_typeof(values) = 'object'),
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pulse.settings_changes (
  audit_id bigint PRIMARY KEY REFERENCES pulse.audit_log (id) ON DELETE CASCADE,
  field text NOT NULL CHECK (
    length(field) BETWEEN 1 AND 160
    AND field ~ '^[a-zA-Z][a-zA-Z0-9]*([.][a-zA-Z0-9]+)*$'
    AND split_part(field, '.', 1) IN (
      'goalOrdersPerDay', 'goalNetMarginPercent', 'monthlyOverheadsGbp',
      'cppUkBreakEvenGbp', 'cppUkTargetGbp', 'cppUsBreakEvenGbp', 'cppUsTargetGbp',
      'paymentFeePercent', 'startingCogs', 'flatFulfilmentUkGbp', 'flatFulfilmentUsGbp',
      'dispatchCutoffUk', 'dispatchCutoffUs', 'supplierLeadTimes', 'safetyWeeks',
      'seasonalMultiplier', 'markersPerKit', 'pencilsPerKit', 'metaOwners',
      'expectedGoogleCampaigns', 'blendedMetaTripwireGbp', 'creatorRules',
      'waitingContacts', 'deadlines', 'keyExpiryDates', 'morningSummaryEnabled', 'brand'
    )
  )
);
