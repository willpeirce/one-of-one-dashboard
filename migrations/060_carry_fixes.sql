-- Part B: keep Mailchimp storage private like the other source tables.
REVOKE ALL ON TABLE pulse.mailchimp_records FROM PUBLIC;
REVOKE ALL ON TABLE pulse.mailchimp_sync FROM PUBLIC;
