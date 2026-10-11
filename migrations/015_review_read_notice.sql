-- One durable count, never raw unreadable rows or their values.
CREATE TABLE pulse.judgeme_sync (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  unread_count integer NOT NULL DEFAULT 0 CHECK (unread_count >= 0)
);
REVOKE ALL ON pulse.judgeme_sync FROM PUBLIC;
