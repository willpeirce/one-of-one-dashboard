-- The earlier repair's impression/time guards left paid zero-play rows behind.
-- Keep any positive play/completion evidence and every zero-spend row.
WITH repaired AS (
 UPDATE pulse.ad_insights_daily SET plays=NULL,thru_plays=NULL,
  plays_25=NULL,plays_50=NULL,plays_75=NULL,plays_100=NULL
 WHERE spend>0 AND plays=0 AND thru_plays=0
  AND COALESCE(plays_25,0)=0 AND COALESCE(plays_50,0)=0
  AND COALESCE(plays_75,0)=0 AND COALESCE(plays_100,0)=0
 RETURNING mode,account_id,day
)
UPDATE pulse.creative_thruplay_days d SET completed=false,retry_after=NULL
WHERE EXISTS(SELECT 1 FROM repaired i
 WHERE i.mode='live' AND i.account_id=d.account_id AND i.day=d.day);
