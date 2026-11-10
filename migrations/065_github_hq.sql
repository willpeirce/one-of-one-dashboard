-- Parsed summaries only. Credentials and complete HQ files never enter these tables.
CREATE TABLE IF NOT EXISTS pulse.github_hq_reads (
  target_key text PRIMARY KEY,
  ref text NOT NULL CHECK (ref IN ('main', 'claude/ads-daily')),
  path text NOT NULL CHECK (path = 'ops/tests/register.md' OR path ~ '^ops/ads-daily/[0-9]{4}-(0[1-9]|1[0-2])\.md$'),
  etag text CHECK (length(etag) <= 1024),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  error_code text CHECK (error_code IN ('target','timeout','network','http','denied','not_found','redirect','rate_limit','too_large','invalid','unreadable','storage')),
  retry_after_at timestamptz,
  parsed_available boolean NOT NULL DEFAULT false,
  readable boolean NOT NULL DEFAULT false,
  initialized boolean NOT NULL DEFAULT false,
  skipped_rows integer NOT NULL DEFAULT 0 CHECK (skipped_rows >= 0),
  CHECK (path <> 'ops/tests/register.md' OR ref = 'main')
);
REVOKE ALL ON pulse.github_hq_reads FROM PUBLIC;
CREATE INDEX IF NOT EXISTS github_hq_retry_after ON pulse.github_hq_reads(retry_after_at) WHERE retry_after_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS pulse.github_hq_reports (
  source text NOT NULL DEFAULT 'github-hq' CHECK (source = 'github-hq'),
  brand text NOT NULL DEFAULT 'one-of-one' CHECK (brand = 'one-of-one'),
  report_day date NOT NULL,
  run_label text NOT NULL CHECK (length(run_label) <= 100),
  status text NOT NULL CHECK (status IN ('ok','needs','unreadable')),
  item_count integer NOT NULL CHECK (item_count >= 0),
  items jsonb NOT NULL CHECK (jsonb_typeof(items) = 'array' AND jsonb_array_length(items) <= 12),
  first_lines jsonb NOT NULL CHECK (jsonb_typeof(first_lines) = 'array' AND jsonb_array_length(first_lines) <= 3),
  ref text NOT NULL CHECK (ref IN ('main','claude/ads-daily')),
  path text NOT NULL CHECK (path ~ '^ops/ads-daily/[0-9]{4}-(0[1-9]|1[0-2])\.md$'),
  read_at timestamptz NOT NULL,
  PRIMARY KEY (report_day,ref)
);
REVOKE ALL ON pulse.github_hq_reports FROM PUBLIC;

CREATE TABLE IF NOT EXISTS pulse.github_hq_tests (
  source text NOT NULL DEFAULT 'github-hq' CHECK (source = 'github-hq'),
  brand text NOT NULL DEFAULT 'one-of-one' CHECK (brand = 'one-of-one'),
  test_id text PRIMARY KEY CHECK (length(test_id) BETWEEN 1 AND 600),
  section text NOT NULL CHECK (section IN ('live','queue','history')),
  row_order integer NOT NULL CHECK (row_order BETWEEN 0 AND 119),
  cells jsonb NOT NULL CHECK (jsonb_typeof(cells) = 'array'),
  first_seen_at timestamptz NOT NULL,
  section_first_seen_at timestamptz NOT NULL,
  initially_seen boolean NOT NULL,
  CHECK (jsonb_array_length(cells) = CASE section WHEN 'live' THEN 9 WHEN 'queue' THEN 7 ELSE 5 END)
);
REVOKE ALL ON pulse.github_hq_tests FROM PUBLIC;
