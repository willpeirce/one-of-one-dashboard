import type { Database } from '../../../src/db.js';

/** Generated, entirely invented catalogue; no source account or real figures are used. */
export const creativePerformanceFixture = {
  account: '919191919191', today: '2026-11-08', groups: 1500, adsPerGroup: 3, days: 30,
  groupId: 'invented-perf-group-0',
} as const;

/** Only call on a disposable test database, as the benchmark harness does. */
export async function seedCreativePerformanceFixture(db: Database): Promise<void> {
  const { account, today, groups, adsPerGroup, days } = creativePerformanceFixture;
  const now = new Date(`${today}T12:00:00Z`);
  await db.query(`INSERT INTO pulse.media_groups(id,mode,source_id,account_id,kind,media_key,title,first_seen,fetched_at)
    SELECT 'invented-perf-group-'||i,'live','invented-perf-key-'||i,$1,'video','invented-perf-key-'||i,
      'Invented clip '||i,'2026-10-10',$2 FROM generate_series(0,$3-1) i`, [account, now, groups]);
  await db.query(`INSERT INTO pulse.ads(mode,source_id,account_id,ad_id,name,status,effective_status,created_at,
      ad_set_id,ad_set_name,campaign_id,campaign_name,owner,market,creative_id,creative_type,media_group_id,
      body,title,call_to_action,first_spend_day,last_seen,fetched_at)
    SELECT 'live','invented-perf-ad-'||i||'-'||j,$1,'invented-perf-ad-'||i||'-'||j,'Invented ad '||i||'-'||j,
      'ACTIVE','ACTIVE','2026-10-10','invented-perf-set-'||i,'Invented UK set','invented-perf-campaign',
      'Invented UK campaign','ours','uk','invented-perf-creative-'||i||'-'||j,'video','invented-perf-group-'||i,
      'Invented scene','Invented kit','SHOP_NOW','2026-10-10',$2,$2
    FROM generate_series(0,$3-1) i CROSS JOIN generate_series(0,$4-1) j`, [account, now, groups, adsPerGroup]);
  await db.query(`INSERT INTO pulse.ad_insights_daily(mode,source_id,account_id,ad_id,ad_set_id,day,spend,
      impressions,reach,frequency,link_clicks,three_second_plays,three_second_source,plays,thru_plays,
      plays_25,plays_50,plays_75,plays_100,average_play_time,adds_to_cart,purchases,purchase_value,fetched_at)
    SELECT 'live',a.ad_id||':'||d,$1,a.ad_id,a.ad_set_id,$3::date-d,60,1000,500,2,100,400,'video_view',
      500,200,350,250,200,150,4,20,3,180,$2 FROM pulse.ads a CROSS JOIN generate_series(0,$4-1) d
    WHERE a.account_id=$1`, [account, now, today, days]);
  await db.query('ANALYZE pulse.media_groups');
  await db.query('ANALYZE pulse.ads');
  await db.query('ANALYZE pulse.ad_insights_daily');
}
