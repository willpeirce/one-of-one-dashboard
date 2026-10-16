-- Lifts are disposable derived data. Old arbitrary-window rows must not be
-- labelled as seven-day evidence; the next pass/tag save rebuilds all windows.
DELETE FROM pulse.attribute_lifts;
ALTER TABLE pulse.attribute_lifts
  ADD COLUMN window_days integer NOT NULL CHECK(window_days IN (1,3,7)),
  ADD COLUMN market text NOT NULL CHECK(market IN ('all','uk','us'));
CREATE INDEX attribute_lifts_window ON pulse.attribute_lifts(mode,account_id,window_days,market);
-- Full evidence follows the brief's window. Retain historical field-only audit
-- rows, but remove the unused preference from current settings.
UPDATE pulse.settings SET values=values-'creativeLiftWindowDays';

-- Meta cannot return video_* fields hourly. Keep the account-day hold
-- denominator alongside daily ThruPlays; legacy and UK-day rows use the
-- existing three_second_plays until refreshed by the next regular read.
ALTER TABLE pulse.ad_insights_daily ADD COLUMN hold_three_second_plays numeric CHECK(hold_three_second_plays>=0);
