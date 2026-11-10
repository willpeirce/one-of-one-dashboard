-- Durable diagnostics and parser version keep conditional reads from preserving an obsolete parse.
ALTER TABLE pulse.github_hq_reads
  ADD COLUMN IF NOT EXISTS parser_version integer NOT NULL DEFAULT 0 CHECK (parser_version >= 0),
  ADD COLUMN IF NOT EXISTS capped_rows integer NOT NULL DEFAULT 0 CHECK (capped_rows >= 0),
  ADD COLUMN IF NOT EXISTS headings_complete boolean NOT NULL DEFAULT false;
