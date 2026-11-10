-- Local answers never change a connected source. Sample and live answers stay separate.
CREATE TABLE IF NOT EXISTS pulse.morning_card_states (
  mode text NOT NULL CHECK (mode IN ('sample', 'live')),
  card_key text NOT NULL CHECK (length(card_key) BETWEEN 1 AND 384),
  state text NOT NULL CHECK (state IN ('parked', 'hidden', 'seen', 'answered')),
  until_day date,
  facts_hash text NOT NULL CHECK (facts_hash ~ '^[0-9a-f]{64}$'),
  answer text CHECK (answer IN ('hold', 'a', 'b', 'draw')),
  credential_id text NOT NULL,
  pressed_at timestamptz NOT NULL,
  cleared_at timestamptz,
  title text NOT NULL,
  card_kind text NOT NULL,
  subject_id text NOT NULL,
  source_scope text NOT NULL,
  PRIMARY KEY (mode, card_key),
  CHECK ((state = 'answered' AND answer IS NOT NULL) OR (state <> 'answered' AND answer IS NULL))
);
REVOKE ALL ON pulse.morning_card_states FROM PUBLIC;
