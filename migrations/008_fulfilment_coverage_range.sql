ALTER TABLE pulse.fulfilment_uploads
  ADD COLUMN coverage_from date,
  ADD COLUMN coverage_to date;
UPDATE pulse.fulfilment_uploads
  SET coverage_from = coverage_week, coverage_to = coverage_week + 6;
ALTER TABLE pulse.fulfilment_uploads DROP COLUMN coverage_week;
ALTER TABLE pulse.fulfilment_uploads ADD CONSTRAINT fulfilment_coverage_range_check
  CHECK ((coverage_from IS NULL AND coverage_to IS NULL)
    OR (coverage_from IS NOT NULL AND coverage_to IS NOT NULL AND coverage_from <= coverage_to));
