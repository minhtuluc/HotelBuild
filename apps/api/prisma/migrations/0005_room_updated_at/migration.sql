-- HB033: rooms use updated_at (microseconds) as their published optimistic version.
-- The generic touch trigger uses transaction-start now(), which can move backwards after a wait.
-- Keep this trigger local to rooms; version counters and other business timestamps are unchanged.
CREATE FUNCTION fn_touch_room_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := GREATEST(OLD.updated_at + interval '1 microsecond', NEW.updated_at, clock_timestamp());
  RETURN NEW;
END $$;
DROP TRIGGER trg_rooms_touch ON rooms;
CREATE TRIGGER trg_rooms_touch BEFORE UPDATE ON rooms
  FOR EACH ROW EXECUTE FUNCTION fn_touch_room_updated_at();
