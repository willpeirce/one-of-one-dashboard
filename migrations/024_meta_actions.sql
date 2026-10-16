CREATE TABLE pulse.meta_actions (
 id text PRIMARY KEY, time timestamptz NOT NULL, account_id text NOT NULL, ad_set_id text NOT NULL,
 action text NOT NULL CHECK(action IN ('pause','resume','budget')),
 old_value text NOT NULL, new_value text NOT NULL, who text NOT NULL,
 result text NOT NULL CHECK(result IN ('pending','success','failed')),
 undone_at timestamptz, undo_of text REFERENCES pulse.meta_actions(id),
 error_code text
);
CREATE UNIQUE INDEX meta_actions_one_pending ON pulse.meta_actions(account_id,ad_set_id) WHERE result='pending';
CREATE INDEX meta_actions_recent ON pulse.meta_actions(time DESC);
REVOKE ALL ON pulse.meta_actions FROM PUBLIC;
