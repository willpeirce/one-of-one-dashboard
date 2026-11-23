CREATE TABLE IF NOT EXISTS pulse.ask_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  values jsonb NOT NULL CHECK (jsonb_typeof(values) = 'object')
);
CREATE TABLE IF NOT EXISTS pulse.ask_log (
  id uuid PRIMARY KEY,
  question text CHECK (length(question) <= 300),
  answer text,
  tools jsonb NOT NULL DEFAULT '[]',
  model text NOT NULL CHECK (model IN ('claude-haiku-5-5', 'claude-sonnet-5-5')),
  input_tokens integer NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens integer NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  cache_write_tokens integer NOT NULL DEFAULT 0 CHECK (cache_write_tokens >= 0),
  cache_read_tokens integer NOT NULL DEFAULT 0 CHECK (cache_read_tokens >= 0),
  cost_pence numeric(14,6) NOT NULL DEFAULT 0 CHECK (cost_pence >= 0),
  duration_ms integer NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
  outcome text NOT NULL CHECK (outcome IN ('answered', 'cut short', 'refused', 'capped', 'unavailable')),
  asked_at timestamptz NOT NULL,
  pending boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS ask_log_asked_at ON pulse.ask_log(asked_at);
REVOKE ALL ON pulse.ask_log, pulse.ask_settings FROM PUBLIC;

DO $$ DECLARE c record; BEGIN
  FOR c IN SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE conrelid='pulse.settings_changes'::regclass AND contype='c'
      AND pg_get_constraintdef(oid) LIKE '%goalOrdersPerDay%'
      AND pg_get_constraintdef(oid) NOT LIKE '%''askModel''%'
  LOOP
    EXECUTE format('ALTER TABLE pulse.settings_changes DROP CONSTRAINT %I',c.conname);
    EXECUTE format('ALTER TABLE pulse.settings_changes ADD CONSTRAINT %I %s',c.conname,
      replace(c.definition,'''goalOrdersPerDay''','''askModel'', ''askDailyCapGbp'', ''goalOrdersPerDay'''));
  END LOOP;
END $$;
