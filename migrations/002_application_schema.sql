CREATE SCHEMA IF NOT EXISTS pulse;

DO $$
BEGIN
  IF to_regclass('pulse.source_health') IS NULL THEN
    IF to_regclass('public.source_health') IS NOT NULL THEN
      ALTER TABLE public.source_health SET SCHEMA pulse;
    ELSE
      CREATE TABLE pulse.source_health (
        source text PRIMARY KEY CHECK (length(source) > 0),
        mode text NOT NULL CHECK (mode IN ('sample', 'live')),
        status text NOT NULL CHECK (status IN ('waiting_for_keys', 'not_implemented', 'healthy', 'error')),
        last_success_at timestamptz,
        last_attempt_at timestamptz,
        consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    END IF;
  END IF;

  IF to_regclass('pulse.audit_log') IS NULL THEN
    IF to_regclass('public.audit_log') IS NOT NULL THEN
      ALTER TABLE public.audit_log SET SCHEMA pulse;
    ELSE
      CREATE TABLE pulse.audit_log (
        id bigserial PRIMARY KEY,
        event text NOT NULL CHECK (length(event) BETWEEN 1 AND 80),
        occurred_at timestamptz NOT NULL DEFAULT now(),
        credential_id text
      );
      CREATE INDEX audit_log_occurred_at_idx ON pulse.audit_log (occurred_at);
    END IF;
  END IF;
END
$$;
