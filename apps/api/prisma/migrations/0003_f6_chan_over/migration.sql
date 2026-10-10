-- HB-121 AC7: proven missing persisted versions; baseline0001 remains frozen.
BEGIN;
ALTER TABLE channel_mappings
  ADD COLUMN version bigint NOT NULL DEFAULT 1 CHECK (version > 0);
ALTER TABLE overbooking_cases
  ADD COLUMN version bigint NOT NULL DEFAULT 1 CHECK (version > 0);

-- Reuse the existing database-authoritative increment, including forged input handling.
CREATE TRIGGER trg_version BEFORE UPDATE ON channel_mappings
  FOR EACH ROW EXECUTE FUNCTION fn_increment_version();
CREATE TRIGGER trg_version BEFORE UPDATE ON overbooking_cases
  FOR EACH ROW EXECUTE FUNCTION fn_increment_version();
COMMIT;
