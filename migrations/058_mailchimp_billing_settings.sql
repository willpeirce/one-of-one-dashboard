-- Retain the audited Settings allowlist, including retired historical fields.
DO $$ DECLARE c record; BEGIN
  FOR c IN SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE conrelid='pulse.settings_changes'::regclass AND contype='c'
      AND pg_get_constraintdef(oid) LIKE '%goalOrdersPerDay%'
  LOOP
    EXECUTE format('ALTER TABLE pulse.settings_changes DROP CONSTRAINT %I',c.conname);
    EXECUTE format('ALTER TABLE pulse.settings_changes ADD CONSTRAINT %I %s',c.conname,
      replace(c.definition,'''goalOrdersPerDay''','''mailchimpPlanLimit'', ''mailchimpBillingDay'', ''goalOrdersPerDay'''));
  END LOOP;
END $$;
