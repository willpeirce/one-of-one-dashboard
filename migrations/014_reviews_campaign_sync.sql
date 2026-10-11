-- Panel-only fields: no reviewer identity, raw response, IP, media URL or token.
CREATE TABLE pulse.judgeme_reviews (
  source text NOT NULL DEFAULT 'judgeme' CHECK (source = 'judgeme'),
  brand text NOT NULL DEFAULT 'one-of-one' CHECK (brand = 'one-of-one'),
  review_id text PRIMARY KEY CHECK (review_id ~ '^[0-9]+$'),
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  product_title text NOT NULL,
  product_handle text NOT NULL,
  market text,
  verified_buyer boolean NOT NULL,
  photo_count integer NOT NULL CHECK (photo_count >= 0),
  body text NOT NULL,
  created_at timestamptz NOT NULL,
  published boolean NOT NULL,
  hidden boolean NOT NULL,
  curated text NOT NULL CHECK (curated IN ('ok', 'spam', 'not-yet')),
  last_seen_at timestamptz NOT NULL
);

REVOKE ALL ON pulse.judgeme_reviews FROM PUBLIC;

CREATE TABLE pulse.meta_campaign_sync (
  account_id text PRIMARY KEY,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error_code text
);
INSERT INTO pulse.meta_campaign_sync (account_id, last_success_at)
SELECT account_id, max(last_seen) FROM pulse.meta_campaigns GROUP BY account_id;
REVOKE ALL ON pulse.meta_campaign_sync FROM PUBLIC;
