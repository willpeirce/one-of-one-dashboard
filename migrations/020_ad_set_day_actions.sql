ALTER TABLE pulse.ad_spend
  ADD COLUMN impressions numeric,
  ADD COLUMN link_clicks numeric,
  ADD COLUMN adds_to_cart numeric,
  ADD COLUMN purchases numeric,
  ADD COLUMN purchase_value numeric;
