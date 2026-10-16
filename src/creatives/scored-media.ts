// Shared account/window scope for recovery queues and their progress reports.
// Parameters: account, first day, last day. Merged children contribute to their final parent.
export const scoredMediaCte = `WITH RECURSIVE family AS (
 SELECT id AS member,id AS parent,merged_into_id,ARRAY[id] AS seen FROM pulse.media_groups WHERE mode='live' AND account_id=$1
 UNION ALL SELECT f.member,g.id,g.merged_into_id,f.seen||g.id FROM family f JOIN pulse.media_groups g ON g.id=f.merged_into_id
  WHERE g.mode='live' AND g.account_id=$1 AND NOT g.id=ANY(f.seen)
), scored AS (
 SELECT f.parent,SUM(i.spend) AS spend FROM family f JOIN pulse.ads a ON a.media_group_id=f.member AND a.mode='live' AND a.account_id=$1
 JOIN pulse.ad_insights_daily i ON i.ad_id=a.ad_id AND i.mode=a.mode AND i.account_id=a.account_id
 WHERE f.merged_into_id IS NULL
  AND i.day BETWEEN COALESCE(NULLIF($2::text,'0000-01-01')::date,'-infinity'::date) AND $3::date
  AND i.spend>0 GROUP BY f.parent
)`;
