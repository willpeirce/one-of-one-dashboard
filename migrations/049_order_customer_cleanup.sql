-- Repeat 048's cleanup after any intervening writes by the previous release.
UPDATE pulse.shopify_records SET data=(data-'customerId') || jsonb_build_object('firstOrder',COALESCE(data->>'firstOrder','unknown')) WHERE kind='order';
