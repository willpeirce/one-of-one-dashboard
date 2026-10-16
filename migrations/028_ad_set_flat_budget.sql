-- Local planning flag only; catalogue refreshes never overwrite it.
ALTER TABLE pulse.meta_ad_sets ADD COLUMN flat_budget boolean;
