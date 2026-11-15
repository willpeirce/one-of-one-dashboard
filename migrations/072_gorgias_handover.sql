-- Narrow ticket fields only; no raw response, message body or customer contact details.
CREATE TABLE IF NOT EXISTS pulse.gorgias_tickets (
  scope text NOT NULL CHECK (scope ~ '^[a-f0-9]{64}$'),
  ticket_id text NOT NULL CHECK (ticket_id ~ '^[0-9]{1,25}$'),
  source text NOT NULL DEFAULT 'gorgias' CHECK (source = 'gorgias'),
  brand text NOT NULL DEFAULT 'one-of-one' CHECK (brand = 'one-of-one'),
  status text NOT NULL CHECK (status IN ('open','closed')),
  channel text NOT NULL CHECK (length(channel) BETWEEN 1 AND 40),
  tags jsonb NOT NULL CHECK (jsonb_typeof(tags) = 'array' AND jsonb_array_length(tags) <= 100),
  in_handover boolean NOT NULL,
  view_id text CHECK (view_id ~ '^[0-9]{1,25}$'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz,
  last_customer_message_at timestamptz,
  customer text NOT NULL CHECK (length(customer) <= 80),
  subject text NOT NULL CHECK (length(subject) <= 80),
  fetched_at timestamptz NOT NULL,
  PRIMARY KEY (scope,ticket_id)
);
REVOKE ALL ON pulse.gorgias_tickets FROM PUBLIC;
CREATE INDEX IF NOT EXISTS gorgias_tickets_members ON pulse.gorgias_tickets(scope,in_handover,status);
CREATE INDEX IF NOT EXISTS gorgias_tickets_created ON pulse.gorgias_tickets(scope,created_at);

CREATE TABLE IF NOT EXISTS pulse.gorgias_sync (
  scope text PRIMARY KEY CHECK (scope ~ '^[a-f0-9]{64}$'),
  last_attempt_at timestamptz NOT NULL,
  last_success_at timestamptz,
  next_run_at timestamptz NOT NULL,
  last_error text CHECK (last_error ~ '^[a-z_]{1,40}$'),
  failures integer NOT NULL DEFAULT 0 CHECK (failures >= 0)
);
REVOKE ALL ON pulse.gorgias_sync FROM PUBLIC;

-- Closure timestamps remain transient at the source boundary: only a numeric weekly aggregate is retained.
CREATE TABLE IF NOT EXISTS pulse.gorgias_weekly (
  scope text NOT NULL CHECK (scope ~ '^[a-f0-9]{64}$'),
  week_start date NOT NULL,
  closed_count integer NOT NULL CHECK (closed_count >= 0),
  fetched_at timestamptz NOT NULL,
  PRIMARY KEY (scope,week_start)
);
REVOKE ALL ON pulse.gorgias_weekly FROM PUBLIC;

DO $$ DECLARE c record; BEGIN
  FOR c IN SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE conrelid='pulse.settings_changes'::regclass AND contype='c'
      AND pg_get_constraintdef(oid) LIKE '%goalOrdersPerDay%'
      AND pg_get_constraintdef(oid) NOT LIKE '%''gorgiasHandoverViewId''%'
  LOOP
    EXECUTE format('ALTER TABLE pulse.settings_changes DROP CONSTRAINT %I',c.conname);
    EXECUTE format('ALTER TABLE pulse.settings_changes ADD CONSTRAINT %I %s',c.conname,
      replace(c.definition,'''goalOrdersPerDay''','''gorgiasHandoverViewId'', ''gorgiasHandoverTag'', ''gorgiasHandoverWaitHours'', ''goalOrdersPerDay'''));
  END LOOP;
END $$;
