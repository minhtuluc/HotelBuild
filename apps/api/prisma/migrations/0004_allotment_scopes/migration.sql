-- HB035 configuration precondition, separate from per-day row versions.
CREATE TABLE channel_allotment_scopes (
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  room_type_id uuid NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (channel_id, room_type_id)
);

-- Existing configurations start at 1 without rewriting child rows/timestamps.
INSERT INTO channel_allotment_scopes(channel_id, room_type_id)
  SELECT DISTINCT channel_id, room_type_id FROM channel_allotments;
CREATE TRIGGER trg_version BEFORE UPDATE ON channel_allotment_scopes
  FOR EACH ROW EXECUTE FUNCTION fn_increment_version();

CREATE FUNCTION fn_invalidate_allotment_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  old_channel uuid;
  old_type uuid;
  new_channel uuid;
  new_type uuid;
  scope record;
BEGIN
  -- Demand/cache updates are not configuration edits. Child versions remain independent.
  IF TG_OP = 'UPDATE' AND
    ROW(OLD.channel_id, OLD.room_type_id, OLD.date, OLD.allotment,
        OLD.is_closed, OLD.closed_reason, OLD.closed_at) IS NOT DISTINCT FROM
    ROW(NEW.channel_id, NEW.room_type_id, NEW.date, NEW.allotment,
        NEW.is_closed, NEW.closed_reason, NEW.closed_at) THEN
    RETURN NULL;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    old_channel := OLD.channel_id;
    old_type := OLD.room_type_id;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    new_channel := NEW.channel_id;
    new_type := NEW.room_type_id;
  END IF;
  -- Order both keys on moves; preserve counters after child deletion (no ABA).
  FOR scope IN
    SELECT channel_id, room_type_id FROM (
      SELECT old_channel AS channel_id, old_type AS room_type_id
      UNION SELECT new_channel, new_type
    ) pairs WHERE channel_id IS NOT NULL ORDER BY channel_id, room_type_id
  LOOP
    -- Parent cascade must not recreate an orphan counter.
    INSERT INTO channel_allotment_scopes(channel_id, room_type_id, version)
      SELECT scope.channel_id, scope.room_type_id, 2
      WHERE EXISTS (SELECT 1 FROM channels WHERE id = scope.channel_id)
        AND EXISTS (SELECT 1 FROM room_types WHERE id = scope.room_type_id)
      ON CONFLICT (channel_id, room_type_id) DO UPDATE
        SET version = channel_allotment_scopes.version + 1;
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_allotment_scope AFTER INSERT OR UPDATE OR DELETE ON channel_allotments
  FOR EACH ROW EXECUTE FUNCTION fn_invalidate_allotment_scope();
