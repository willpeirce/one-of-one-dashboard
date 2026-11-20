ALTER TABLE pulse.kit_board_kits
  ADD COLUMN IF NOT EXISTS sellout_target date,
  ADD COLUMN IF NOT EXISTS next_date text CHECK (length(next_date)<=28),
  ADD COLUMN IF NOT EXISTS move_note text CHECK (length(move_note)<=60);
