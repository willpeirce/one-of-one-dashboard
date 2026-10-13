-- Creative performance is kept apart from the ad-set spend used by the hero.
CREATE TABLE pulse.media_groups (
  id text PRIMARY KEY, mode text NOT NULL CHECK (mode IN ('sample','live')),
  source text NOT NULL DEFAULT 'meta', source_id text NOT NULL, brand text NOT NULL DEFAULT 'one-of-one',
  account_id text NOT NULL, kind text NOT NULL CHECK (kind IN ('image','video')), media_key text NOT NULL,
  title text NOT NULL, length_seconds numeric, width integer, height integer,
  first_seen timestamptz NOT NULL, fetched_at timestamptz NOT NULL,
  thumbnail bytea, poster bytea, frames bytea[] NOT NULL DEFAULT '{}' CHECK (cardinality(frames)<=10), full_image bytea,
  full_image_mime text, last_opened_at timestamptz,
  alternates jsonb NOT NULL DEFAULT '[]', merged_into_id text REFERENCES pulse.media_groups(id),
  CHECK (merged_into_id IS DISTINCT FROM id), UNIQUE (mode,account_id,kind,media_key)
);
CREATE TABLE pulse.ads (
  mode text NOT NULL CHECK (mode IN ('sample','live')), source text NOT NULL DEFAULT 'meta', source_id text NOT NULL,
  brand text NOT NULL DEFAULT 'one-of-one', account_id text NOT NULL, ad_id text NOT NULL,
  name text NOT NULL, status text NOT NULL, effective_status text NOT NULL, created_at timestamptz NOT NULL,
  ad_set_id text NOT NULL, ad_set_name text NOT NULL, campaign_id text NOT NULL, campaign_name text NOT NULL,
  owner text NOT NULL CHECK (owner IN ('ours','freelancer','unassigned')),
  market text NOT NULL CHECK (market IN ('uk','us','unknown')), creative_id text NOT NULL,
  creative_type text NOT NULL CHECK (creative_type IN ('video','image','carousel','catalogue','other')),
  media_group_id text NOT NULL REFERENCES pulse.media_groups(id), body text NOT NULL, title text NOT NULL,
  call_to_action text NOT NULL, link_url text, utm_content text, first_spend_day date, last_seen timestamptz NOT NULL,
  object_story_id text, instagram_media_id text, facebook_url text, instagram_url text,
  fetched_at timestamptz NOT NULL, PRIMARY KEY (mode,account_id,ad_id)
);
CREATE INDEX ads_group ON pulse.ads(mode,account_id,media_group_id);
CREATE TABLE pulse.media_merges (
  sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE, id text PRIMARY KEY, account_id text NOT NULL, group_id text NOT NULL REFERENCES pulse.media_groups(id),
  parent_id text REFERENCES pulse.media_groups(id), previous_parent_id text REFERENCES pulse.media_groups(id),
  action text NOT NULL CHECK (action IN ('rule','merge','split')), who text NOT NULL, created_at timestamptz NOT NULL,
  undone_at timestamptz, undone_by text
);
CREATE INDEX media_merge_history ON pulse.media_merges(group_id,sequence DESC);
CREATE TABLE pulse.ad_insights_daily (
  mode text NOT NULL CHECK (mode IN ('sample','live')), source text NOT NULL DEFAULT 'meta', source_id text NOT NULL,
  brand text NOT NULL DEFAULT 'one-of-one', account_id text NOT NULL, ad_id text NOT NULL, ad_set_id text NOT NULL,
  day date NOT NULL, spend numeric(24,6) NOT NULL, impressions numeric NOT NULL, reach numeric NOT NULL,
  frequency numeric NOT NULL, link_clicks numeric NOT NULL, three_second_plays numeric NOT NULL,
  three_second_source text NOT NULL CHECK (three_second_source IN ('video_view','video_continuous_2_sec_watched_actions','none')),
  plays numeric NOT NULL, thru_plays numeric NOT NULL, plays_25 numeric NOT NULL, plays_50 numeric NOT NULL,
  plays_75 numeric NOT NULL, plays_100 numeric NOT NULL, average_play_time numeric NOT NULL,
  adds_to_cart numeric NOT NULL, purchases numeric NOT NULL, purchase_value numeric(24,6) NOT NULL,
  fetched_at timestamptz NOT NULL, PRIMARY KEY (mode,account_id,ad_id,day)
);
CREATE INDEX ad_insights_range ON pulse.ad_insights_daily(mode,account_id,day);
CREATE TABLE pulse.creative_insight_days (
  account_id text NOT NULL, day date NOT NULL, fetched_at timestamptz NOT NULL, PRIMARY KEY(account_id,day)
);
CREATE TABLE pulse.creative_jobs (
  account_id text PRIMARY KEY, backfill_next date NOT NULL DEFAULT '2026-08-07',
  backfill_done boolean NOT NULL DEFAULT false, last_success_at timestamptz, last_catalogue_at timestamptz,
  nightly_day date, error_code text
);
-- Reach is non-additive: retain Meta's exact seven-day frequency for each ad membership.
CREATE TABLE pulse.creative_frequencies (
  account_id text NOT NULL, membership_key text NOT NULL, ad_ids jsonb NOT NULL,
  from_day date NOT NULL, to_day date NOT NULL, frequency numeric CHECK(frequency>=0),
  fetched_at timestamptz NOT NULL, PRIMARY KEY(account_id,membership_key,from_day,to_day)
);
REVOKE ALL ON pulse.creative_frequencies FROM PUBLIC;
-- Reserved for sample examples in this batch. Production scanning and lifts are deferred together.
CREATE TABLE pulse.media_attributes (
  id text PRIMARY KEY, mode text NOT NULL CHECK (mode IN ('sample','live')), account_id text NOT NULL,
  media_group_id text NOT NULL REFERENCES pulse.media_groups(id), attribute_key text NOT NULL, value jsonb NOT NULL,
  source text NOT NULL CHECK (source IN ('meta','model','will')), recorded_at timestamptz NOT NULL,
  UNIQUE(mode,account_id,media_group_id,attribute_key,source)
);
CREATE TABLE pulse.attribute_lifts (
  id text PRIMARY KEY, mode text NOT NULL CHECK (mode IN ('sample','live')), account_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('image','video')), attribute_key text NOT NULL, value jsonb NOT NULL,
  metrics jsonb NOT NULL, confidence text NOT NULL CHECK(confidence IN ('Hint','Likely','Strong')),
  computed_at timestamptz NOT NULL
);
CREATE TABLE pulse.creative_card_states (
  mode text NOT NULL, account_id text NOT NULL, card_id text NOT NULL,
  done_at timestamptz, snoozed_until timestamptz, updated_by text,
  PRIMARY KEY(mode,account_id,card_id)
);
REVOKE ALL ON pulse.media_groups,pulse.ads,pulse.media_merges,pulse.ad_insights_daily,
  pulse.creative_insight_days,pulse.creative_jobs,pulse.media_attributes,pulse.attribute_lifts,pulse.creative_card_states FROM PUBLIC;

-- New local preferences retain the existing value-free field audit.
DO $$
DECLARE
  field_check text;
BEGIN
  SELECT c.conname INTO STRICT field_check
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
  WHERE c.conrelid = 'pulse.settings_changes'::regclass
    AND c.contype = 'c' AND a.attname = 'field';

  EXECUTE format('ALTER TABLE pulse.settings_changes DROP CONSTRAINT %I', field_check);
  EXECUTE format($check$
    ALTER TABLE pulse.settings_changes ADD CONSTRAINT %I CHECK (
      length(field) BETWEEN 1 AND 160
      AND field ~ '^[a-zA-Z][a-zA-Z0-9]*([.][a-zA-Z0-9]+)*$'
      AND split_part(field, '.', 1) IN (
        'goalOrdersPerDay', 'goalNetMarginPercent', 'overheads', 'monthlyOverheadsGbp',
        'cppUkBreakEvenGbp', 'cppUkTargetGbp', 'cppUsBreakEvenGbp', 'cppUsTargetGbp',
        'paymentFeePercent', 'startingCogs', 'jjGbpPerUsd',
        'flatFulfilmentUkGbp', 'flatFulfilmentUsGbp',
        'dispatchCutoffUk', 'dispatchCutoffUs', 'supplierLeadTimes', 'safetyWeeks',
        'seasonalMultiplier', 'markersPerKit', 'pencilsPerKit',
        'metaAdAccountId', 'googleCustomerId', 'googleLoginCustomerId', 'tiktokAdvertiserId',
        'metaOwners', 'expectedGoogleCampaigns', 'blendedMetaTripwireGbp', 'creatorRules',
        'waitingContacts', 'deadlines', 'keyExpiryDates', 'morningSummaryEnabled', 'brand',
        'series1OrderDate', 'series1UkLandingOffsetDays', 'series1UsLandingOffsetDays',
        'series1UkTargetDate', 'series1UsTargetDate',
        'creativeDefaultWindow', 'creativeSpendFloorGbp', 'creativePurchaseMinimum', 'creativeFadeFrequency', 'creativeFadeCtrDropPercent', 'creativeWeeklyTarget', 'creativeHitWinnerSpendGbp', 'creativeHitKilledSpendGbp', 'creativeHitKilledTargetMultiplier', 'creativeLiftWindowDays', 'creativeLiftMinimumGroups', 'creativeLiftMinimumSpendGbp', 'creativeMediaCapMb', 'creativeScanModel', 'creativeScanInputPrice', 'creativeScanOutputPrice', 'creativeScanCapGbp', 'creativeFreelancerInitial'
      )
    )
  $check$, field_check);
END;
$$;
