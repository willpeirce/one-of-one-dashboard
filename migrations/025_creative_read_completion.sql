-- Existing coverage cannot prove a complete ad-level refresh; normal reads certify it again.
ALTER TABLE pulse.creative_insight_days ADD COLUMN completed boolean NOT NULL DEFAULT false;
ALTER TABLE pulse.creative_jobs ADD COLUMN catalogue_error text;
ALTER TABLE pulse.creative_jobs ADD COLUMN insights_error text;
UPDATE pulse.creative_jobs SET catalogue_error=error_code WHERE error_code LIKE '%at catalogue%';
UPDATE pulse.creative_jobs SET insights_error=error_code WHERE error_code IS NOT NULL AND catalogue_error IS NULL;

-- Re-certify retained historical days in bounded chunks; never discard their stored insights.
UPDATE pulse.creative_jobs j SET backfill_next=LEAST(j.backfill_next,d.first_day),backfill_done=false
FROM (SELECT account_id,min(day) AS first_day FROM pulse.creative_insight_days GROUP BY account_id) d
WHERE d.account_id=j.account_id;
