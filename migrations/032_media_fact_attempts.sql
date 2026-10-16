ALTER TABLE pulse.media_groups ADD COLUMN facts_attempts integer NOT NULL DEFAULT 0;
-- Earlier empty direct reads did not try creative/byte fallbacks. Give them those paths once.
UPDATE pulse.media_groups SET size_unavailable=false,length_unavailable=false,facts_retry_after=NULL
WHERE size_unavailable OR length_unavailable;
