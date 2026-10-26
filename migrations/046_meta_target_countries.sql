ALTER TABLE pulse.meta_ad_sets ADD COLUMN target_countries jsonb NOT NULL DEFAULT '[]';
ALTER TABLE pulse.ad_spend ADD COLUMN target_countries jsonb NOT NULL DEFAULT '[]';
ALTER TABLE pulse.meta_spend_hours ADD COLUMN target_countries jsonb NOT NULL DEFAULT '[]';
