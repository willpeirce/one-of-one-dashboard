ALTER TABLE pulse.creative_jobs
  ADD COLUMN account_video_after text,
  ADD COLUMN account_video_list_complete boolean NOT NULL DEFAULT false;

CREATE TABLE pulse.creative_account_videos (
  account_id text NOT NULL REFERENCES pulse.creative_jobs(account_id),
  video_id text NOT NULL,
  width integer, height integer, length_seconds numeric,
  fetched_at timestamptz NOT NULL,
  PRIMARY KEY (account_id,video_id)
);
REVOKE ALL ON pulse.creative_account_videos FROM PUBLIC;

ALTER TABLE pulse.media_groups ADD COLUMN video_owned_elsewhere boolean NOT NULL DEFAULT false;
-- Give videos exhausted by the old per-video permission refusals the new list path.
UPDATE pulse.media_groups SET size_unavailable=false,length_unavailable=false,
  facts_attempts=0,facts_retry_after=NULL,facts_error=NULL
WHERE mode='live' AND kind='video' AND (width IS NULL OR height IS NULL OR length_seconds IS NULL);
