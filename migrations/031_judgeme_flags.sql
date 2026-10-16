-- Moderation flags do not hide reviews; source is separate from the provenance column.
ALTER TABLE pulse.judgeme_reviews ADD COLUMN flagged boolean;
ALTER TABLE pulse.judgeme_reviews ADD COLUMN review_source text;
