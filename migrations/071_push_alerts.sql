-- Existing registrations stay opted out. Delivery state is separate from source observations.
ALTER TABLE pulse.push_subscriptions ADD COLUMN IF NOT EXISTS alerts_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS pulse.push_alert_checks (
  check_id text PRIMARY KEY CHECK (check_id IN ('orders','checkout','dispatch','refunds','webhooks','geo','self','ads_check')),
  evaluation_id text NOT NULL CHECK (length(evaluation_id) BETWEEN 1 AND 128),
  raw_status text NOT NULL CHECK (raw_status IN ('pass','tripped','unknown')),
  candidate_status text CHECK (candidate_status IN ('pass','tripped')),
  candidate_count integer NOT NULL CHECK (candidate_count BETWEEN 0 AND 2),
  confirmed_status text CHECK (confirmed_status IN ('pass','tripped')),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  transition_quiet boolean NOT NULL DEFAULT false
);
REVOKE ALL ON pulse.push_alert_checks FROM PUBLIC;

CREATE TABLE IF NOT EXISTS pulse.push_alert_devices (
  check_id text NOT NULL CHECK (check_id IN ('orders','checkout','dispatch','refunds','webhooks','geo','self','ads_check')),
  endpoint text NOT NULL REFERENCES pulse.push_subscriptions(endpoint) ON DELETE CASCADE,
  credential_id text NOT NULL,
  subscription_created_at timestamptz NOT NULL,
  revision bigint NOT NULL CHECK (revision >= 0),
  acknowledged_status text NOT NULL CHECK (acknowledged_status IN ('pass','tripped')),
  last_sent_status text CHECK (last_sent_status IN ('pass','tripped')),
  last_sent_at timestamptz,
  PRIMARY KEY(check_id, endpoint)
);
REVOKE ALL ON pulse.push_alert_devices FROM PUBLIC;

CREATE TABLE IF NOT EXISTS pulse.push_alert_months (
  endpoint text NOT NULL REFERENCES pulse.push_subscriptions(endpoint) ON DELETE CASCADE,
  credential_id text NOT NULL,
  subscription_created_at timestamptz NOT NULL,
  uk_month date NOT NULL CHECK (extract(day FROM uk_month)=1),
  claimed_at timestamptz NOT NULL,
  PRIMARY KEY(endpoint, uk_month)
);
REVOKE ALL ON pulse.push_alert_months FROM PUBLIC;

-- Keep historical allowlisted Settings keys and all path/length guards intact.
DO $$ DECLARE c record; BEGIN
  FOR c IN SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE conrelid='pulse.settings_changes'::regclass AND contype='c'
      AND pg_get_constraintdef(oid) LIKE '%goalOrdersPerDay%'
      AND pg_get_constraintdef(oid) NOT LIKE '%''alertQuietHours''%'
  LOOP
    EXECUTE format('ALTER TABLE pulse.settings_changes DROP CONSTRAINT %I',c.conname);
    EXECUTE format('ALTER TABLE pulse.settings_changes ADD CONSTRAINT %I %s',c.conname,
      replace(c.definition,'''goalOrdersPerDay''','''alertQuietHours'', ''goalOrdersPerDay'''));
  END LOOP;
END $$;
