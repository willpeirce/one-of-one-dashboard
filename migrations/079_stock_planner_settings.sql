CREATE TABLE IF NOT EXISTS pulse.stock_planner_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  values jsonb NOT NULL CHECK (jsonb_typeof(values) = 'object')
);
REVOKE ALL ON pulse.stock_planner_settings FROM PUBLIC;

DO $$ DECLARE c record; BEGIN
  FOR c IN SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE conrelid='pulse.settings_changes'::regclass AND contype='c'
      AND pg_get_constraintdef(oid) LIKE '%goalOrdersPerDay%'
      AND pg_get_constraintdef(oid) NOT LIKE '%''productSuppliers''%'
  LOOP
    EXECUTE format('ALTER TABLE pulse.settings_changes DROP CONSTRAINT %I',c.conname);
    EXECUTE format('ALTER TABLE pulse.settings_changes ADD CONSTRAINT %I %s',c.conname,
      replace(c.definition,'''goalOrdersPerDay''','''seasonalMultipliers'', ''reorderSafetyWeeks'', ''productSuppliers'', ''goalOrdersPerDay'''));
  END LOOP;
END $$;
