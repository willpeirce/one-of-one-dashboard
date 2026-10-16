CREATE TABLE pulse.meta_ad_set_changes (
  audit_id bigint PRIMARY KEY REFERENCES pulse.audit_log(id),
  account_id text NOT NULL, ad_set_id text NOT NULL,
  field text NOT NULL CHECK(field IN ('status','daily_budget')),
  old_value text NOT NULL, new_value text NOT NULL,
  observed_at timestamptz NOT NULL
);
CREATE INDEX meta_ad_set_changes_set ON pulse.meta_ad_set_changes(account_id,ad_set_id,observed_at);
REVOKE ALL ON pulse.meta_ad_set_changes FROM PUBLIC;
