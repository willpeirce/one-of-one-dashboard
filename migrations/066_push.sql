CREATE TABLE IF NOT EXISTS pulse.push_subscriptions (
  endpoint text PRIMARY KEY CHECK (length(endpoint) BETWEEN 1 AND 2048),
  p256dh text NOT NULL,
  auth text NOT NULL,
  credential_id text NOT NULL,
  created_at timestamptz NOT NULL,
  last_success_at timestamptz,
  failures integer NOT NULL DEFAULT 0 CHECK (failures >= 0)
);
CREATE INDEX IF NOT EXISTS push_subscriptions_credential ON pulse.push_subscriptions(credential_id,created_at);
REVOKE ALL ON pulse.push_subscriptions FROM PUBLIC;

CREATE TABLE IF NOT EXISTS pulse.push_sent (
  kind text NOT NULL,
  uk_day date NOT NULL,
  claimed_at timestamptz NOT NULL,
  PRIMARY KEY(kind,uk_day)
);
REVOKE ALL ON pulse.push_sent FROM PUBLIC;
