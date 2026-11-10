-- Extend the existing Settings audit allowlist once for any missing Google keys.
DO $$ DECLARE c record; key text; definition text; BEGIN
  FOR c IN SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE conrelid='pulse.settings_changes'::regclass AND contype='c'
      AND pg_get_constraintdef(oid) LIKE '%goalOrdersPerDay%'
  LOOP
    definition := c.definition;
    FOREACH key IN ARRAY ARRAY['googleContentShareMaxPct', 'googleContentSpendFloorGbp',
      'googleNoSaleSpendFloorGbp', 'googleBreakEvenReturnUk', 'googleBreakEvenReturnUs', 'googleContactName']
    LOOP
      IF position(quote_literal(key) in definition) = 0 THEN
        definition := replace(definition,'''goalOrdersPerDay''',quote_literal(key) || ', ''goalOrdersPerDay''');
      END IF;
    END LOOP;
    IF definition <> c.definition THEN
      EXECUTE format('ALTER TABLE pulse.settings_changes DROP CONSTRAINT %I',c.conname);
      EXECUTE format('ALTER TABLE pulse.settings_changes ADD CONSTRAINT %I %s',c.conname,definition);
    END IF;
  END LOOP;
END $$;
