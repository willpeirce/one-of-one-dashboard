-- Will dismisses a new review on Home once he has seen it; Judge.me is never told.
CREATE TABLE IF NOT EXISTS pulse.review_dismissals (
  review_id text PRIMARY KEY CHECK (review_id ~ '^[0-9]{1,20}$'),
  dismissed_at timestamptz NOT NULL DEFAULT now()
);
