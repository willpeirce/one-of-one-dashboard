-- Only first/repeat/unknown is needed; remove the older unused customer-ID projection.
UPDATE pulse.shopify_records SET data=(data-'customerId') || jsonb_build_object('firstOrder',COALESCE(data->>'firstOrder','unknown')) WHERE kind='order';
CREATE TABLE pulse.shopify_first_order_backfill (
 mode text PRIMARY KEY CHECK(mode='live'), cursor text NOT NULL DEFAULT '',
 next_run_at timestamptz NOT NULL, last_success_at timestamptz, error text
);
REVOKE ALL ON pulse.shopify_first_order_backfill FROM PUBLIC;
