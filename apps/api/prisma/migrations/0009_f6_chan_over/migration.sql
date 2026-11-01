-- HB-121 — F6 forward gap only. `0001_baseline` and `0003_f6_chan_over` stay frozen; this file
-- alters exactly the objects where the F6 decisions (D01/D04/D06/D07) and AC7/AC8 contracts proved
-- a gap, and adds the durable CHAN/OVER persistence those decisions require. No table of the
-- baseline (channels/OVER/inbox/delivery) is re-created here.

BEGIN;

-- ============================================================================================
-- F6-D01 — MERGE_CONNECTING is ONE booking with two reciprocal rooms (two BookingRoom rows).
-- No second booking, no second consent; only MERGE_SHARE keeps two bookings and two consents.
-- ============================================================================================
ALTER TABLE room_merges ALTER COLUMN secondary_booking_id DROP NOT NULL;
ALTER TABLE room_merges ADD COLUMN secondary_room_id uuid REFERENCES rooms(id) ON DELETE RESTRICT;

-- Existing rows must already match the single-booking model before the guard is validated; never
-- rewrite a merge silently, report and stop (same discipline as 0008 for money invariants).
DO $$
DECLARE
  v_bad bigint;
BEGIN
  SELECT count(*) INTO v_bad FROM room_merges
   WHERE NOT ((move_type = 'MERGE_CONNECTING'
               AND secondary_booking_id IS NULL AND secondary_room_id IS NOT NULL)
           OR (move_type = 'MERGE_SHARE'
               AND secondary_booking_id IS NOT NULL AND secondary_room_id IS NULL));
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'F6-D01: % room_merges row(s) do not follow the one-booking connecting model; '
      'reconcile them before applying 0009', v_bad USING ERRCODE = '23514';
  END IF;
END $$;

-- The distinct-booking test only applies to SHARE (connecting has no secondary booking).
ALTER TABLE room_merges DROP CONSTRAINT ck_room_merges_distinct;
ALTER TABLE room_merges ADD CONSTRAINT ck_room_merges_distinct CHECK (
  secondary_booking_id IS NULL OR primary_booking_id <> secondary_booking_id
);

-- Consent is a SHARE-only requirement; approved_by for the mixed-gender exception is a service
-- predicate (guest gender is not stored on room_merges) enforced by HB-124.
ALTER TABLE room_merges DROP CONSTRAINT ck_room_merges_consent;
ALTER TABLE room_merges ADD CONSTRAINT ck_room_merges_consent CHECK (
  move_type <> 'MERGE_SHARE'
  OR status NOT IN ('APPROVED','ACTIVE')
  OR (consent_primary AND consent_secondary)
);

ALTER TABLE room_merges ADD CONSTRAINT ck_room_merges_secondary CHECK (
  (move_type = 'MERGE_CONNECTING'
   AND secondary_booking_id IS NULL AND secondary_room_id IS NOT NULL)
  OR (move_type = 'MERGE_SHARE'
      AND secondary_booking_id IS NOT NULL AND secondary_room_id IS NULL)
);

-- "One ACTIVE merge" now covers both bookings *and* both rooms of a connecting merge.
DROP INDEX uq_room_merges_active_primary;
DROP INDEX uq_room_merges_active_secondary;
CREATE UNIQUE INDEX uq_room_merges_active_primary
  ON room_merges (primary_booking_id) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX uq_room_merges_active_secondary
  ON room_merges (secondary_booking_id)
  WHERE status = 'ACTIVE' AND secondary_booking_id IS NOT NULL;
CREATE UNIQUE INDEX uq_room_merges_active_room
  ON room_merges (room_id) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX uq_room_merges_active_secondary_room
  ON room_merges (secondary_room_id)
  WHERE status = 'ACTIVE' AND secondary_room_id IS NOT NULL;

-- ============================================================================================
-- F6-D04 — `approved_by` is conditional: only a paid/transport move needs a manager decision.
-- Zero-cost same-property relocation (tiers 1–2, SPLIT_ROOMS) and same-gender SHARE with both
-- consents execute without an artificial approver. CHECKED_IN/irresistible-force/cross-city and
-- mixed-gender predicates cross tables and stay service-enforced with the HB-124 suite; the DDL
-- must not be emptied to let every execute through.
-- ============================================================================================
ALTER TABLE room_moves DROP CONSTRAINT ck_room_moves_approval;
ALTER TABLE room_moves ADD CONSTRAINT ck_room_moves_approval CHECK (
  status NOT IN ('APPROVED','EXECUTED')
  OR compensation_amount + transport_cost <= 0
  OR approved_by IS NOT NULL
);

-- ============================================================================================
-- F6-D07 — durable system actor for automatic case closure. No fake user row: SYSTEM keeps
-- `resolved_by` NULL, USER keeps a real approver. BR-OVER-16 still forbids auto-closing a past day.
-- ============================================================================================
ALTER TABLE overbooking_cases ADD COLUMN resolution_source text
  CHECK (resolution_source IN ('USER','SYSTEM'));
-- Every RESOLVED row that exists before this migration was resolved by a person (SYSTEM did not
-- exist), so provenance is backfilled instead of inventing a NULL actor.
UPDATE overbooking_cases SET resolution_source = 'USER'
 WHERE status = 'RESOLVED' AND resolution_source IS NULL;

ALTER TABLE overbooking_cases DROP CONSTRAINT ck_overbooking_resolved;
ALTER TABLE overbooking_cases ADD CONSTRAINT ck_overbooking_resolved CHECK (
  status <> 'RESOLVED'
  OR (resolved_at IS NOT NULL
      AND ((resolution_source = 'SYSTEM' AND resolved_by IS NULL)
           OR (resolution_source = 'USER' AND resolved_by IS NOT NULL)))
);
ALTER TABLE overbooking_cases ADD CONSTRAINT ck_overbooking_resolution_source CHECK (
  resolution_source IS NULL OR status = 'RESOLVED'
);

-- ============================================================================================
-- F6-D06 — compensation is its own Payment linked to the approved RoomMove. The fund is never
-- `refund_allocations`/REFUND, the amount comes from the approved move, and the durable PENDING
-- row (not a client retry) is the operation to look up on timeout.
-- ============================================================================================
ALTER TABLE payments ADD COLUMN room_move_id uuid REFERENCES room_moves(id) ON DELETE RESTRICT;
ALTER TABLE payments ADD CONSTRAINT ck_payments_compensation CHECK (
  room_move_id IS NULL
  OR (type = 'COMPENSATION' AND method IN ('CASH','BANK_TRANSFER'))
);
CREATE UNIQUE INDEX uq_payments_room_move ON payments (room_move_id)
  WHERE room_move_id IS NOT NULL AND status IN ('PENDING','SUCCEEDED');

-- ============================================================================================
-- AC7/AC8 — review flag provenance on bookings. The row `version` (baseline `trg_version`) stays
-- the If-Match token; `duplicate_suspected_version` is the persisted decision counter and is
-- bumped by the database, never by a client timestamp.
-- ============================================================================================
ALTER TABLE bookings ADD COLUMN duplicate_suspected_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE bookings ADD COLUMN duplicate_suspected_reason text;
ALTER TABLE bookings ADD COLUMN duplicate_suspected_at timestamptz;
ALTER TABLE bookings ADD COLUMN duplicate_suspected_version bigint NOT NULL DEFAULT 0
  CHECK (duplicate_suspected_version >= 0);
-- Legacy BR-BOOK-16 only flips the boolean, so the guard cannot demand an actor from every caller;
-- it does require the actor and its instant to be written together by the F6 review route.
ALTER TABLE bookings ADD CONSTRAINT ck_bookings_duplicate_flag CHECK (
  duplicate_suspected_by IS NULL OR duplicate_suspected_at IS NOT NULL
);

CREATE FUNCTION fn_bump_duplicate_flag_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.duplicate_suspected, NEW.duplicate_suspected_by,
         NEW.duplicate_suspected_reason, NEW.duplicate_suspected_at)
     IS DISTINCT FROM
     ROW(OLD.duplicate_suspected, OLD.duplicate_suspected_by,
         OLD.duplicate_suspected_reason, OLD.duplicate_suspected_at) THEN
    NEW.duplicate_suspected_version := OLD.duplicate_suspected_version + 1;
  ELSE
    NEW.duplicate_suspected_version := OLD.duplicate_suspected_version;
  END IF;
  RETURN NEW;
END $$;
-- Sorts before baseline `trg_version`, so both database-authoritative counters advance atomically.
CREATE TRIGGER trg_bookings_duplicate_flag BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION fn_bump_duplicate_flag_version();

-- ============================================================================================
-- AC8 — closure provenance: manual closure is a latch the manager may clear; automatic closure
-- (pool ≤ 2 / quota) is re-derived by HB-131. `channel_allotments.is_closed` stays the effective
-- published flag (HB-035 writers are unchanged); the source of each closure is persisted here with
-- actor/reason/time, and reopening keeps the history instead of deleting it.
CREATE TABLE channel_sales_closures (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id    uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  room_type_id  uuid NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
  date          date NOT NULL,
  source        text NOT NULL CHECK (source IN ('MANUAL','AUTOMATIC')),
  reason        text,
  closed_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  closed_at     timestamptz NOT NULL DEFAULT now(),
  reopened_at   timestamptz,
  reopened_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  version       bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_channel_sales_closures_reopen CHECK (
    reopened_at IS NULL OR reopened_at >= closed_at),
  CONSTRAINT ck_channel_sales_closures_reopener CHECK (
    (reopened_at IS NULL AND reopened_by IS NULL)
    OR (reopened_at IS NOT NULL AND reopened_by IS NOT NULL))
);
-- One active closure per allotment **per source**: a manual reopen must not lift the automatic
-- closure, so MANUAL and AUTOMATIC latches coexist; each source has at most one open row.
CREATE UNIQUE INDEX uq_channel_sales_closures_active
  ON channel_sales_closures (channel_id, room_type_id, date, source)
  WHERE reopened_at IS NULL;
CREATE INDEX idx_channel_sales_closures_open
  ON channel_sales_closures (channel_id, date) WHERE reopened_at IS NULL;

-- ============================================================================================
-- AC8 — durable OTA ordering. Inbox rows are purged after 7 days, so the watermark and the cancel
-- tombstone live in their own tables keyed by channel + partner account + provider booking code;
-- two accounts sharing a provider booking code must not collapse into one row. Redis is never the
-- durable source (ADR-017).
CREATE TABLE channel_sync_watermarks (
  channel_id      uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  account_key     text NOT NULL CHECK (length(btrim(account_key)) > 0),
  provider        text NOT NULL CHECK (length(btrim(provider)) > 0),
  watermark_at    timestamptz NOT NULL,
  last_event_id   text,
  last_success_at timestamptz NOT NULL DEFAULT now(),
  version         bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, account_key)
);

CREATE FUNCTION fn_guard_channel_watermark() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- A late/old provider event must never move the ordering watermark backwards.
  IF NEW.watermark_at < OLD.watermark_at THEN
    RAISE EXCEPTION 'watermark must advance monotonically for channel % account %',
      NEW.channel_id, NEW.account_key USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_channel_sync_watermarks_monotonic
  BEFORE UPDATE ON channel_sync_watermarks
  FOR EACH ROW EXECUTE FUNCTION fn_guard_channel_watermark();

CREATE TABLE channel_cancel_tombstones (
  channel_id            uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  account_key           text NOT NULL CHECK (length(btrim(account_key)) > 0),
  provider_booking_code text NOT NULL CHECK (length(btrim(provider_booking_code)) > 0),
  provider_updated_at   timestamptz NOT NULL,
  cancelled_at          timestamptz NOT NULL,
  cancel_reason         text NOT NULL DEFAULT 'OTA_CANCELLATION'
                        CHECK (length(btrim(cancel_reason)) > 0),
  booking_id            uuid REFERENCES bookings(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, account_key, provider_booking_code)
);

-- ============================================================================================
-- AC7/AC8 — persisted overbooking scan freshness. `lastSuccessfulScanAt`, RUNNING and failure are
-- durable so an empty list is only shown after a verified successful scan; a failed run keeps the
-- previous success. Only one RUNNING scan per property.
-- ============================================================================================
CREATE TABLE overbooking_scan_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'RUNNING'
                  CHECK (status IN ('RUNNING','SUCCEEDED','FAILED')),
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  duration_ms     integer CHECK (duration_ms >= 0),
  scanned_count   integer NOT NULL DEFAULT 0 CHECK (scanned_count >= 0),
  case_count      integer NOT NULL DEFAULT 0 CHECK (case_count >= 0),
  failure_code    text,
  failure_message text,
  version         bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_overbooking_scan_runs_finished CHECK (
    status = 'RUNNING' OR finished_at IS NOT NULL),
  CONSTRAINT ck_overbooking_scan_runs_failed CHECK (
    status <> 'FAILED' OR failure_code IS NOT NULL),
  CONSTRAINT ck_overbooking_scan_runs_duration CHECK (
    status = 'RUNNING' OR duration_ms IS NOT NULL)
);

CREATE UNIQUE INDEX uq_overbooking_scan_runs_running
  ON overbooking_scan_runs (property_id) WHERE status = 'RUNNING';
CREATE INDEX idx_overbooking_scan_runs_success
  ON overbooking_scan_runs (property_id, finished_at DESC) WHERE status = 'SUCCEEDED';

-- New tables/columns above carry `version`/`updated_at` like the baseline convention (§1, §3.3).
CREATE TRIGGER trg_version BEFORE UPDATE ON channel_sync_watermarks
  FOR EACH ROW EXECUTE FUNCTION fn_increment_version();
CREATE TRIGGER trg_version BEFORE UPDATE ON channel_sales_closures
  FOR EACH ROW EXECUTE FUNCTION fn_increment_version();
CREATE TRIGGER trg_channel_sales_closures_touch BEFORE UPDATE ON channel_sales_closures
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();
CREATE TRIGGER trg_channel_sync_watermarks_touch BEFORE UPDATE ON channel_sync_watermarks
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();
CREATE TRIGGER trg_channel_cancel_tombstones_touch BEFORE UPDATE ON channel_cancel_tombstones
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();
CREATE TRIGGER trg_version BEFORE UPDATE ON overbooking_scan_runs
  FOR EACH ROW EXECUTE FUNCTION fn_increment_version();
CREATE TRIGGER trg_overbooking_scan_runs_touch BEFORE UPDATE ON overbooking_scan_runs
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

COMMIT;
