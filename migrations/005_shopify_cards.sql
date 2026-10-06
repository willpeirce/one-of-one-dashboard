ALTER TABLE pulse.shopify_notices ADD COLUMN detail jsonb NOT NULL DEFAULT '{}';
ALTER TABLE pulse.shopify_notices DROP CONSTRAINT shopify_notices_kind_check;
ALTER TABLE pulse.shopify_notices ADD CONSTRAINT shopify_notices_kind_check CHECK
  (kind IN ('webhook_recreated', 'geo_unreliable', 'reports_unavailable', 'address_unavailable', 'channel_short'));
-- Observations survive restarts; no personal payloads or source credentials.
CREATE TABLE pulse.shopify_watchdog_state (
  mode text PRIMARY KEY CHECK (mode IN ('sample', 'live')),
  source text NOT NULL DEFAULT 'shopify',
  source_id text NOT NULL DEFAULT 'watchdogs',
  brand text NOT NULL DEFAULT 'one-of-one',
  fetched_at timestamptz NOT NULL,
  data jsonb NOT NULL
);
CREATE TABLE pulse.bank_holidays (
  source text NOT NULL DEFAULT 'calendar',
  source_id text NOT NULL,
  brand text NOT NULL DEFAULT 'one-of-one',
  fetched_at timestamptz NOT NULL DEFAULT now(),
  warehouse text NOT NULL CHECK (warehouse IN ('uk', 'us')),
  day date NOT NULL,
  PRIMARY KEY (warehouse, day)
);
-- England/Wales bank holidays and US federal holidays, 2026-27. See DECISIONS.
INSERT INTO pulse.bank_holidays (warehouse, day, source_id)
SELECT 'uk', day::date, 'uk:' || day FROM unnest(ARRAY[
'2026-01-01','2026-04-03','2026-04-06','2026-05-04','2026-05-25','2026-08-31','2026-12-25','2026-12-28',
'2027-01-01','2027-03-26','2027-03-29','2027-05-03','2027-05-31','2027-08-30','2027-12-27','2027-12-28']) day;
INSERT INTO pulse.bank_holidays (warehouse, day, source_id)
SELECT 'us', day::date, 'us:' || day FROM unnest(ARRAY[
'2026-01-01','2026-01-19','2026-02-16','2026-05-25','2026-06-19','2026-07-03','2026-09-07','2026-10-12','2026-11-11','2026-11-26','2026-12-25',
'2027-01-01','2027-01-18','2027-02-15','2027-05-31','2027-06-18','2027-07-05','2027-09-06','2027-10-11','2027-11-11','2027-11-25','2027-12-24','2027-12-31']) day;
-- Re-read the fixed initial window with the richer channel/payment/fulfilment projection.
-- Existing records remain readable until replaced; missing new fields render unknown.
UPDATE pulse.shopify_jobs SET state = (state - 'ordersDone' - 'after') || '{"after":null}'::jsonb,
  next_run_at = now() WHERE name = 'backfill';
-- A pre-1b in-flight reconciliation lacks the channel report's fixed UK dates.
-- Restart it idempotently over the current seven completed dates.
UPDATE pulse.shopify_jobs SET state = '{}', next_run_at = now() WHERE name = 'reconcile';
