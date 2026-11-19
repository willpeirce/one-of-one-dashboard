-- Nullable intent projection only; existing rows are filled by bounded background reads.
ALTER TABLE pulse.gorgias_tickets
  ADD COLUMN IF NOT EXISTS ai_intent text NULL,
  ADD COLUMN IF NOT EXISTS ai_intent_checked_at timestamptz NULL;
