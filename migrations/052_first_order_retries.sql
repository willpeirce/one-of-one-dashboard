-- Nullable metadata only; existing records need no rewrite or backfill.
ALTER TABLE pulse.shopify_records ADD COLUMN first_order_checked_at timestamptz;
