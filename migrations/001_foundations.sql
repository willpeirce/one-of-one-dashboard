CREATE TABLE public.source_health (
  source text PRIMARY KEY CHECK (length(source) > 0),
  mode text NOT NULL CHECK (mode IN ('sample', 'live')),
  status text NOT NULL CHECK (status IN ('waiting_for_keys', 'not_implemented', 'healthy', 'error')),
  last_success_at timestamptz,
  last_attempt_at timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.audit_log (
  id bigserial PRIMARY KEY,
  event text NOT NULL CHECK (length(event) BETWEEN 1 AND 80),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  credential_id text
);
CREATE INDEX audit_log_occurred_at_idx ON public.audit_log (occurred_at);

CREATE TABLE pulse_private.owner (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  user_id text NOT NULL CHECK (length(user_id) > 0)
);

CREATE TABLE pulse_private.credentials (
  id text PRIMARY KEY CHECK (length(id) > 0),
  public_key bytea NOT NULL CHECK (octet_length(public_key) > 0),
  counter bigint NOT NULL DEFAULT 0 CHECK (counter >= 0),
  transports jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(transports) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

CREATE TABLE pulse_private.sessions (
  token_hash text PRIMARY KEY CHECK (length(token_hash) > 0),
  credential_id text NOT NULL REFERENCES pulse_private.credentials (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > created_at)
);
CREATE INDEX sessions_expires_at_idx ON pulse_private.sessions (expires_at);

CREATE TABLE pulse_private.challenges (
  id_hash text PRIMARY KEY CHECK (length(id_hash) > 0),
  challenge text NOT NULL CHECK (length(challenge) > 0),
  kind text NOT NULL CHECK (kind IN ('registration', 'authentication')),
  expires_at timestamptz NOT NULL
);
CREATE INDEX challenges_expires_at_idx ON pulse_private.challenges (expires_at);

CREATE TABLE pulse_private.rate_limits (
  bucket_hash text PRIMARY KEY CHECK (length(bucket_hash) > 0),
  window_started_at timestamptz NOT NULL,
  attempts integer NOT NULL CHECK (attempts >= 0)
);
CREATE INDEX rate_limits_window_started_at_idx ON pulse_private.rate_limits (window_started_at);

CREATE TABLE pulse_private.app_secrets (
  name text PRIMARY KEY CHECK (length(name) > 0),
  value bytea NOT NULL CHECK (octet_length(value) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON ALL TABLES IN SCHEMA pulse_private FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA pulse_private FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA pulse_private REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA pulse_private REVOKE ALL ON SEQUENCES FROM PUBLIC;
