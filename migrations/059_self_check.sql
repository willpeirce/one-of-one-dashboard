-- Part A: retain exhausted webhook events without retrying them indefinitely.
ALTER TABLE pulse.shopify_webhook_inbox ADD COLUMN IF NOT EXISTS failed_at timestamptz;

-- Retain the scan history while ending repeated truncated replies for unchanged media.
ALTER TABLE pulse.creative_scans ADD COLUMN IF NOT EXISTS content_fingerprint text;
ALTER TABLE pulse.creative_scans ADD COLUMN IF NOT EXISTS skipped boolean NOT NULL DEFAULT false;

ALTER TABLE pulse.media_groups ADD COLUMN IF NOT EXISTS scan_media_fingerprint text;
