ALTER TABLE pulse.ad_insights_daily
 ALTER COLUMN plays DROP NOT NULL,
 ALTER COLUMN plays_25 DROP NOT NULL,
 ALTER COLUMN plays_50 DROP NOT NULL,
 ALTER COLUMN plays_75 DROP NOT NULL,
 ALTER COLUMN plays_100 DROP NOT NULL;

-- Legacy hourly-only rows have no retained field-presence marker. Repair the
-- all-zero video signature only; keep zero-spend rows and any positive video evidence.
UPDATE pulse.ad_insights_daily SET plays=NULL,thru_plays=NULL,
 plays_25=NULL,plays_50=NULL,plays_75=NULL,plays_100=NULL
WHERE spend>0 AND impressions>0 AND plays=0 AND thru_plays=0
 AND COALESCE(plays_25,0)=0 AND COALESCE(plays_50,0)=0
 AND COALESCE(plays_75,0)=0 AND COALESCE(plays_100,0)=0 AND average_play_time=0;

-- Those days need the narrow video report again even if the earlier repair read them.
UPDATE pulse.creative_thruplay_days d SET completed=false,retry_after=NULL
WHERE EXISTS(SELECT 1 FROM pulse.ad_insights_daily i
 WHERE i.mode='live' AND i.account_id=d.account_id AND i.day=d.day AND i.spend>0 AND i.plays IS NULL);
