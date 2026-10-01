-- Source SHA: 8a3b9f9540237fac404c25c1405af007043fb50d
-- docs/04-thiet-ke/csdl.md:451
-- PostgreSQL 16 — đồ án Pine Hill Homestay
CREATE EXTENSION IF NOT EXISTS btree_gist;   -- kiểu chỉ mục gist cho uuid/smallint (ràng buộc loại trừ)
CREATE EXTENSION IF NOT EXISTS pgcrypto;     -- digest() SHA-256 cho chuỗi băm AuditLog

-- Ngữ cảnh phiên, ứng dụng đặt trong mỗi transaction ghi:
--   SET LOCAL app.actor_id = '<uuid>';  SET LOCAL app.actor_role = 'MANAGER';
CREATE OR REPLACE FUNCTION fn_current_role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('app.actor_role', true), 'ANONYMOUS')
$$;

CREATE SEQUENCE IF NOT EXISTS bookings_seq;  -- BR-OVER-11: phá hoà theo thứ tự tăng đơn điệu

-- docs/04-thiet-ke/csdl.md:470
CREATE TABLE users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username           text NOT NULL UNIQUE,
  password_hash      text NOT NULL,
  full_name          text NOT NULL,
  role               text NOT NULL CHECK (role IN ('OWNER','MANAGER','FRONT_DESK','RESERVATION_AGENT','ACCOUNTANT','HOUSEKEEPING','SYSADMIN')),
  phone              text,
  is_active          boolean NOT NULL DEFAULT true,
  failed_login_count smallint NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
  locked_until       timestamptz,
  last_login_at      timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE properties (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                text NOT NULL UNIQUE,
  name                text NOT NULL,
  address             text NOT NULL,
  phone               text NOT NULL,
  check_in_time       time NOT NULL DEFAULT '14:00',
  check_out_time      time NOT NULL DEFAULT '12:00',
  timezone            text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  overbook_limit_pct  numeric(4,2) NOT NULL DEFAULT 0,
  latitude            numeric(9,6) NOT NULL,
  longitude           numeric(9,6) NOT NULL,
  status              text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_properties_overbook_pct CHECK (overbook_limit_pct >= 0 AND overbook_limit_pct <= 5)
);

CREATE TABLE room_types (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id       uuid NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
  code              text NOT NULL CHECK (code IN ('STD','SUP','DLX','FAM','DOR')),
  name              text NOT NULL,
  capacity_adults   smallint NOT NULL CHECK (capacity_adults > 0),
  capacity_children smallint NOT NULL DEFAULT 0 CHECK (capacity_children >= 0),
  base_price        bigint NOT NULL CHECK (base_price > 0),
  min_price         bigint NOT NULL CHECK (min_price > 0),
  max_price         bigint NOT NULL CHECK (max_price > 0),
  allow_shared      boolean NOT NULL DEFAULT false,
  status            text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_room_types_property_code UNIQUE (property_id, code),
  CONSTRAINT ck_room_types_price_band CHECK (min_price <= base_price AND base_price <= max_price),
  CONSTRAINT ck_room_types_shared_only_dor CHECK (NOT allow_shared OR code = 'DOR')
);

CREATE TABLE rooms (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id         uuid NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
  room_type_id        uuid NOT NULL REFERENCES room_types(id) ON DELETE RESTRICT,
  code                text NOT NULL,
  name                text NOT NULL,
  floor               smallint NOT NULL DEFAULT 0,
  status              text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','MAINTENANCE','INACTIVE')),
  connecting_room_id  uuid REFERENCES rooms(id) ON DELETE SET NULL,
  bed_count           smallint NOT NULL DEFAULT 1 CHECK (bed_count >= 1),   -- BR-PROP-04: DOR = 6, còn lại = 1
  note                text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_rooms_property_code UNIQUE (property_id, code),
  CONSTRAINT ck_rooms_not_self_connecting CHECK (connecting_room_id IS NULL OR connecting_room_id <> id)
);

CREATE TABLE user_property_scopes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_property_scopes UNIQUE (user_id, property_id)
);

CREATE TABLE room_blocks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id     uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  start_date  date NOT NULL,
  end_date    date NOT NULL,
  reason      text NOT NULL CHECK (reason IN ('MAINTENANCE','RENOVATION','OWNER_USE','DEEP_CLEAN')),
  created_by  uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_room_blocks_range CHECK (end_date > start_date)
);

CREATE TABLE housekeeping_tasks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id       uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  business_date date NOT NULL,
  status        text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','IN_PROGRESS','DONE','INSPECTED')),
  assigned_to   uuid REFERENCES users(id) ON DELETE SET NULL,
  note          text,
  completed_at  timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_housekeeping_room_date UNIQUE (room_id, business_date)
);

-- docs/04-thiet-ke/csdl.md:570
CREATE TABLE cancellation_policies (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text NOT NULL UNIQUE,
  name       text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  early_checkout_free_hours smallint CHECK (early_checkout_free_hours IS NULL OR early_checkout_free_hours >= 0),
  early_checkout_refund_pct numeric(5,2) NOT NULL DEFAULT 0
                     CHECK (early_checkout_refund_pct >= 0 AND early_checkout_refund_pct <= 100),
  status     text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cancellation_tiers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id          uuid NOT NULL REFERENCES cancellation_policies(id) ON DELETE CASCADE,
  offset_hours       integer NOT NULL CHECK (offset_hours >= -1),
  refund_percent     numeric(5,2) NOT NULL CHECK (refund_percent >= 0 AND refund_percent <= 100),
  charge_first_night boolean NOT NULL DEFAULT false,
  label              text NOT NULL,
  sort_order         smallint NOT NULL CHECK (sort_order > 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_cancellation_tiers_order UNIQUE (policy_id, sort_order),
  CONSTRAINT uq_cancellation_tiers_offset UNIQUE (policy_id, offset_hours)
);

CREATE TABLE rate_plans (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                text NOT NULL UNIQUE CHECK (code IN ('FLEX7','SAVER3','NONREF','LONGSTAY14')),
  name                text NOT NULL,
  deposit_percent     numeric(5,2) NOT NULL CHECK (deposit_percent >= 0 AND deposit_percent <= 100),
  cancellation_policy_id uuid NOT NULL REFERENCES cancellation_policies(id) ON DELETE RESTRICT,
  min_nights          smallint NOT NULL DEFAULT 1 CHECK (min_nights >= 1),
  max_nights          smallint NOT NULL DEFAULT 365,
  fixed_nightly_price bigint CHECK (fixed_nightly_price IS NULL OR fixed_nightly_price > 0),
  los_discount_enabled boolean NOT NULL DEFAULT true,
  reschedule_allowed  boolean NOT NULL DEFAULT true,
  reschedule_min_hours integer NOT NULL DEFAULT 168 CHECK (reschedule_min_hours >= 0),
  reschedule_fee_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (reschedule_fee_pct BETWEEN 0 AND 100),
  max_reschedules smallint NOT NULL DEFAULT 1 CHECK (max_reschedules >= 0),
  status              text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_rate_plans_nights CHECK (max_nights >= min_nights)
);

CREATE TABLE channels (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code              text NOT NULL UNIQUE
                    CHECK (code IN ('WEB','PHONE','WALKIN','OTA_BOOKING','OTA_AGODA','OTA_AIRBNB','AGENCY')),
  name              text NOT NULL,
  multiplier        numeric(5,3) NOT NULL CHECK (multiplier > 0),
  commission_pct    numeric(5,2) NOT NULL DEFAULT 0 CHECK (commission_pct >= 0 AND commission_pct <= 50),
  hold_minutes      integer NOT NULL DEFAULT 0 CHECK (hold_minutes >= 0),
  overbook_allowed  boolean NOT NULL DEFAULT false,
  status            text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  sync_status       text NOT NULL DEFAULT 'OK' CHECK (sync_status IN ('OK','DEGRADED')),
  consecutive_sync_failures smallint NOT NULL DEFAULT 0 CHECK (consecutive_sync_failures >= 0),
  last_sync_at      timestamptz,
  last_sync_error   text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE channel_property_settings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id          uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  property_id         uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  commission_pct      numeric(5,2) NOT NULL CHECK (commission_pct >= 0 AND commission_pct <= 50),
  multiplier_override numeric(5,3) CHECK (multiplier_override IS NULL OR multiplier_override > 0),
  effective_from      date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_channel_property_settings UNIQUE (channel_id, property_id, effective_from)
);

CREATE TABLE channel_mappings (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id              uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  room_type_id            uuid NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
  external_room_code      text NOT NULL,
  external_rate_plan_code text,
  status                  text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_channel_mappings_room UNIQUE (channel_id, room_type_id),
  CONSTRAINT uq_channel_mappings_external UNIQUE (channel_id, external_room_code)
);

CREATE TABLE seasons (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id               uuid REFERENCES properties(id) ON DELETE CASCADE,
  code                      text NOT NULL CHECK (code IN ('SE-NY','SE-TET','SE-REUN','SE-NAT','SE-SUM','SE-SHO','SE-LOW')),
  name                      text NOT NULL,
  start_date                date NOT NULL,
  end_date                  date NOT NULL,
  multiplier                numeric(5,3) NOT NULL CHECK (multiplier > 0),
  priority                  smallint NOT NULL CHECK (priority >= 0),
  weekend_surcharge_enabled boolean NOT NULL DEFAULT true,
  status                    text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_seasons_range CHECK (end_date >= start_date),
  CONSTRAINT uq_seasons_scope_code_start UNIQUE (property_id, code, start_date)
);

CREATE TABLE rate_calendars (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_type_id uuid NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
  property_id  uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  date         date NOT NULL,
  price        bigint NOT NULL CHECK (price > 0),
  source       text NOT NULL DEFAULT 'BASE' CHECK (source IN ('BASE','SEASON','OVERRIDE','RATE_PLAN')),
  priority     smallint NOT NULL,
  channel_code text REFERENCES channels(code) ON DELETE CASCADE,
  season_id    uuid REFERENCES seasons(id) ON DELETE SET NULL,
  rate_plan_id uuid REFERENCES rate_plans(id) ON DELETE RESTRICT,
  reason       text,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_rate_calendars_priority CHECK (
    (source = 'OVERRIDE'  AND priority = 100) OR
    (source = 'RATE_PLAN' AND priority = 90)  OR
    (source = 'SEASON'    AND priority = 50)  OR
    (source = 'BASE'      AND priority = 10)),
  CONSTRAINT ck_rate_calendars_season CHECK (source = 'SEASON' OR season_id IS NULL),
  CONSTRAINT ck_rate_calendars_plan CHECK ((source = 'RATE_PLAN') = (rate_plan_id IS NOT NULL)),
  CONSTRAINT ck_rate_calendars_reason CHECK (source <> 'OVERRIDE' OR length(coalesce(reason, '')) > 0)
);

CREATE TABLE channel_allotments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id    uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  room_type_id  uuid NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
  date          date NOT NULL,
  allotment     smallint NOT NULL CHECK (allotment >= 0),
  used          smallint NOT NULL DEFAULT 0 CHECK (used >= 0),
  is_closed     boolean NOT NULL DEFAULT false,
  closed_reason text,
  closed_at     timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_channel_allotments_scope UNIQUE (channel_id, room_type_id, date),
  CONSTRAINT ck_channel_allotments_closed CHECK (is_closed = false OR closed_at IS NOT NULL)
);

CREATE TABLE promotions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             text NOT NULL UNIQUE,
  name             text NOT NULL,
  type             text NOT NULL CHECK (type IN ('PERCENT','AMOUNT')),
  value            numeric(12,2) NOT NULL CHECK (value > 0),
  min_nights       smallint NOT NULL DEFAULT 1 CHECK (min_nights >= 1),
  channel_scope    text[] NOT NULL DEFAULT '{}',
  room_type_scope  text[] NOT NULL DEFAULT '{}',
  valid_from       date NOT NULL,
  valid_to         date NOT NULL,
  max_uses         integer CHECK (max_uses IS NULL OR max_uses > 0),
  used_count       integer NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  stackable        boolean NOT NULL DEFAULT false,
  status           text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_promotions_window CHECK (valid_to >= valid_from),
  CONSTRAINT ck_promotions_percent CHECK (type <> 'PERCENT' OR value <= 100),
  CONSTRAINT ck_promotions_usage CHECK (max_uses IS NULL OR used_count <= max_uses),
  CONSTRAINT ck_promotions_channels CHECK (channel_scope <@ ARRAY['WEB','PHONE','WALKIN','OTA_BOOKING','OTA_AGODA','OTA_AIRBNB','AGENCY']::text[]),
  CONSTRAINT ck_promotions_room_types CHECK (room_type_scope <@ ARRAY['STD','SUP','DLX','FAM','DOR']::text[])
);

-- docs/04-thiet-ke/csdl.md:736
CREATE TABLE guests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name          text NOT NULL,
  phone              text NOT NULL,
  email              text,
  id_number          text,
  dob                date,
  nationality        text DEFAULT 'VN',
  loyalty_tier       text NOT NULL DEFAULT 'GUEST' CHECK (loyalty_tier IN ('GUEST','MEMBER','SILVER','GOLD','PLATINUM')),
  loyalty_points     integer NOT NULL DEFAULT 0 CHECK (loyalty_points >= 0),
  total_stays        smallint NOT NULL DEFAULT 0 CHECK (total_stays >= 0),
  blacklisted        boolean NOT NULL DEFAULT false,
  blacklist_reason   text,
  notes              text,
  gender             text NOT NULL DEFAULT 'UNSPECIFIED'
                     CHECK (gender IN ('MALE','FEMALE','OTHER','UNSPECIFIED')),
  consent_marketing  boolean NOT NULL DEFAULT false,
  consent_at         timestamptz,
  consent_version    text,
  anonymized_at      timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_guests_phone_normalized CHECK (anonymized_at IS NOT NULL OR phone ~ '^\+84[0-9]{9}$'),
  CONSTRAINT ck_guests_blacklist_reason CHECK (NOT blacklisted OR blacklist_reason IS NOT NULL)
);

CREATE TABLE guest_notes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id   uuid NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  content    text NOT NULL,
  author_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

-- docs/04-thiet-ke/csdl.md:773
CREATE TABLE bookings (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code               text NOT NULL UNIQUE CHECK (code ~ '^PH-[0-9]{6}-[A-Z0-9]{5}$'),
  seq                bigint NOT NULL DEFAULT nextval('bookings_seq') UNIQUE,   -- BR-OVER-11: phá hoà tất định
  guest_id           uuid NOT NULL REFERENCES guests(id) ON DELETE RESTRICT,
  property_id        uuid NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
  room_type_id       uuid NOT NULL REFERENCES room_types(id) ON DELETE RESTRICT,
  rate_plan_id       uuid NOT NULL REFERENCES rate_plans(id) ON DELETE RESTRICT,
  channel_id         uuid NOT NULL REFERENCES channels(id) ON DELETE RESTRICT,
  check_in           date NOT NULL,
  check_out          date NOT NULL,
  nights             smallint GENERATED ALWAYS AS ((check_out - check_in)::smallint) STORED,
  adults             smallint NOT NULL CHECK (adults > 0),
  children           smallint NOT NULL DEFAULT 0 CHECK (children >= 0),
  status             text NOT NULL DEFAULT 'DRAFT'
                     CHECK (status IN ('DRAFT','HELD','PENDING_PAYMENT','CONFIRMED','CHECKED_IN','CHECKED_OUT','CANCELLED','NO_SHOW','EXPIRED')),
  room_count         smallint NOT NULL DEFAULT 1 CHECK (room_count > 0),
  total_amount       bigint NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  deposit_percent    numeric(5,2) NOT NULL CHECK (deposit_percent >= 0 AND deposit_percent <= 100),
  deposit_amount     bigint NOT NULL DEFAULT 0 CHECK (deposit_amount >= 0),
  paid_amount        bigint NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  refunded_amount    bigint NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0),
  penalty_amount     bigint NOT NULL DEFAULT 0 CHECK (penalty_amount >= 0),
  balance_due        bigint NOT NULL DEFAULT 0 CHECK (balance_due >= 0), -- projection du sổ nghĩa vụ/phân bổ (§3.6)
  currency           char(3) NOT NULL DEFAULT 'VND',
  hold_expires_at    timestamptz,
  oversold           boolean NOT NULL DEFAULT false,
  duplicate_suspected boolean NOT NULL DEFAULT false,
  price_locked       boolean NOT NULL DEFAULT false,
  external_ref       text,
  channel_policy_code text,
  reschedule_count   smallint NOT NULL DEFAULT 0 CHECK (reschedule_count >= 0),
  note               text,
  created_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at       timestamptz,
  cancel_reason      text CHECK (cancel_reason IS NULL OR cancel_reason IN
                     ('GUEST_REQUEST','FORCE_MAJEURE','HOTEL_RELOCATION','PAYMENT_TIMEOUT','DUPLICATE','NO_SHOW',
                     'SYSTEM','OTA_CANCELLATION','EARLY_CHECKOUT')),
  CONSTRAINT ck_bookings_range CHECK (check_out > check_in),
  CONSTRAINT ck_bookings_refund_cap CHECK (refunded_amount <= paid_amount),
  CONSTRAINT ck_bookings_cancelled CHECK (status <> 'CANCELLED' OR cancelled_at IS NOT NULL),
  CONSTRAINT ck_bookings_hold CHECK (status NOT IN ('HELD','PENDING_PAYMENT') OR hold_expires_at IS NOT NULL)
);

CREATE TABLE booking_rooms (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  room_type_id    uuid NOT NULL REFERENCES room_types(id) ON DELETE RESTRICT,
  adults          smallint NOT NULL CHECK (adults > 0),
  children        smallint NOT NULL DEFAULT 0 CHECK (children >= 0),
  price_per_night bigint NOT NULL CHECK (price_per_night >= 0),
  status          text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CANCELLED')),
  cancelled_at    timestamptz,
  CONSTRAINT ck_booking_rooms_cancelled CHECK (status <> 'CANCELLED' OR cancelled_at IS NOT NULL),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE room_assignments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_room_id uuid NOT NULL REFERENCES booking_rooms(id) ON DELETE CASCADE,
  room_id         uuid NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
  bed_no          smallint NOT NULL DEFAULT 0 CHECK (bed_no >= 0),
  start_date      date NOT NULL,
  end_date        date NOT NULL,
  valid_range     daterange GENERATED ALWAYS AS (daterange(start_date, end_date, '[)')) STORED,
  released_at     timestamptz,
  release_reason  text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_room_assignments_range CHECK (end_date > start_date)
);

CREATE TABLE booking_status_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  from_status text,
  to_status   text NOT NULL,
  reason      text,
  actor_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  at          timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE price_snapshots (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id   uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  seq          smallint NOT NULL CHECK (seq > 0),
  kind         text NOT NULL DEFAULT 'ORIGINAL'
               CHECK (kind IN ('ORIGINAL','RESCHEDULE','PARTIAL_CANCEL')),
  payload_json jsonb NOT NULL,
  quote_id uuid UNIQUE,
  quote_fingerprint text,
  gross_amount bigint NOT NULL CHECK (gross_amount >= 0),
  commission_amount bigint NOT NULL CHECK (commission_amount >= 0 AND commission_amount <= gross_amount),
  policy_snapshot_json jsonb NOT NULL CHECK (jsonb_typeof(policy_snapshot_json) = 'object'),
  engine_version text NOT NULL,
  channel_property_setting_id uuid REFERENCES channel_property_settings(id) ON DELETE RESTRICT,
  captured_at  timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_price_snapshots_seq UNIQUE (booking_id, seq),
  CONSTRAINT ck_snapshot_quote CHECK (
    (quote_id IS NULL AND quote_fingerprint IS NULL)
    OR (kind = 'ORIGINAL' AND quote_id IS NOT NULL AND length(coalesce(quote_fingerprint, '')) > 0))
);

-- docs/04-thiet-ke/csdl.md:882
CREATE TABLE overbooking_cases (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     uuid NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
  date            date NOT NULL,
  room_type_id    uuid NOT NULL REFERENCES room_types(id) ON DELETE RESTRICT,
  shortage_count  smallint NOT NULL CHECK (shortage_count > 0),
  status          text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','PROPOSED','RESOLVED','ESCALATED')),
  detected_at     timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz,
  escalated_at    timestamptz,
  delay_reason    text,
  resolved_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_overbooking_resolved CHECK (status <> 'RESOLVED' OR (resolved_at IS NOT NULL AND resolved_by IS NOT NULL)),
  CONSTRAINT ck_overbooking_escalated CHECK (status <> 'ESCALATED' OR escalated_at IS NOT NULL)
);

CREATE TABLE room_moves (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id       uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  booking_room_id  uuid NOT NULL REFERENCES booking_rooms(id) ON DELETE CASCADE,
  move_type        text NOT NULL CHECK (move_type IN
                   ('SAME_TYPE_SAME_PROPERTY','UPGRADE_SAME_PROPERTY','SAME_TYPE_CROSS_PROPERTY',
                    'UPGRADE_CROSS_PROPERTY','WALK_OUT','SPLIT_ROOMS','MERGE_SHARE','MERGE_CONNECTING')),
  from_room_id     uuid REFERENCES rooms(id) ON DELETE SET NULL,
  to_room_id       uuid REFERENCES rooms(id) ON DELETE SET NULL,
  from_property_id uuid REFERENCES properties(id) ON DELETE SET NULL,
  to_property_id   uuid REFERENCES properties(id) ON DELETE SET NULL,
  reason           text NOT NULL,
  keep_score       smallint NOT NULL DEFAULT 0 CHECK (keep_score >= 0 AND keep_score <= 173),
  price_locked     boolean NOT NULL DEFAULT true,
  compensation_amount bigint NOT NULL DEFAULT 0 CHECK (compensation_amount >= 0),
  transport_cost   bigint NOT NULL DEFAULT 0 CHECK (transport_cost >= 0),
  walk_out_doc_no      text,
  guest_signature_ref  text,
  staff_signature_ref  text,
  approved_by      uuid REFERENCES users(id) ON DELETE RESTRICT,
  status           text NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED','APPROVED','EXECUTED','REJECTED','CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_room_moves_target CHECK (to_room_id IS NOT NULL OR move_type = 'WALK_OUT'),
  CONSTRAINT ck_room_moves_approval CHECK (status NOT IN ('APPROVED','EXECUTED') OR approved_by IS NOT NULL),
  CONSTRAINT ck_room_moves_price_lock CHECK (price_locked),
  CONSTRAINT ck_room_moves_walkout_doc CHECK (move_type <> 'WALK_OUT' OR status <> 'EXECUTED' OR walk_out_doc_no IS NOT NULL)
);

CREATE TABLE room_merges (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  primary_booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  secondary_booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  room_id            uuid NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
  move_type          text NOT NULL CHECK (move_type IN ('MERGE_SHARE','MERGE_CONNECTING')),
  consent_primary    boolean NOT NULL DEFAULT false,
  consent_secondary  boolean NOT NULL DEFAULT false,
  discount_pct       numeric(5,2) NOT NULL CHECK (discount_pct BETWEEN 0 AND 100),
  discount_amount    bigint NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  approved_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  status             text NOT NULL DEFAULT 'PENDING_CONSENT'
                     CHECK (status IN ('PENDING_CONSENT','APPROVED','ACTIVE','CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_room_merges_distinct CHECK (primary_booking_id <> secondary_booking_id),
  CONSTRAINT ck_room_merges_consent CHECK (status NOT IN ('APPROVED','ACTIVE')
    OR (consent_primary AND consent_secondary AND approved_by IS NOT NULL))
);

-- docs/04-thiet-ke/csdl.md:950
CREATE TABLE payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      uuid NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  type            text NOT NULL CHECK (type IN ('DEPOSIT','BALANCE','REFUND','PENALTY','EXTRA_SERVICE',
                                                 'COMPENSATION','RESCHEDULE_FEE')),
  method          text NOT NULL CHECK (method IN ('VNPAY','MOMO','CASH','BANK_TRANSFER','OTA_COLLECT')),
  amount          bigint NOT NULL CHECK (amount <> 0),
  status          text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SUCCEEDED','FAILED','REVERSED')),
  provider_txn_id text,
  idempotency_key text NOT NULL, -- mã nghiệp vụ do server tạo, không sao chép khoá HTTP của khách
  paid_at         timestamptz,
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  note            text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_payments_idempotency UNIQUE (booking_id, type, idempotency_key),
  CONSTRAINT uq_payments_provider_txn UNIQUE (method, provider_txn_id),
  CONSTRAINT ck_payments_sign CHECK ((type = 'REFUND' AND amount < 0) OR (type <> 'REFUND' AND amount > 0)),
  CONSTRAINT ck_payments_paid_at CHECK (status <> 'SUCCEEDED' OR paid_at IS NOT NULL),
  CONSTRAINT ck_payments_cash_shift CHECK (method <> 'CASH' OR created_by IS NOT NULL)
);

CREATE TABLE refund_requests (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id           uuid NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  event_key            text NOT NULL CHECK (length(event_key) > 0),
  payment_id           uuid REFERENCES payments(id) ON DELETE RESTRICT, -- tham chiếu nguồn đơn nếu có; phân bổ đầy đủ ở refund_allocations
  policy_id            uuid NOT NULL REFERENCES cancellation_policies(id) ON DELETE RESTRICT,
  hours_before_check_in numeric(10,2) NOT NULL,
  applied_tier_id      uuid REFERENCES cancellation_tiers(id) ON DELETE SET NULL,
  refund_percent       numeric(5,2) NOT NULL CHECK (refund_percent >= 0 AND refund_percent <= 100),
  requested_amount     bigint NOT NULL CHECK (requested_amount >= 0),
  approved_amount      bigint CHECK (approved_amount IS NULL OR approved_amount >= 0),
  refund_fee           bigint NOT NULL DEFAULT 0 CHECK (refund_fee >= 0),
  net_refund           bigint GENERATED ALWAYS AS
                         (greatest(0::bigint, coalesce(approved_amount, requested_amount) - refund_fee)) STORED,
  status               text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','PAID','CANCELLED')),
  is_force_majeure     boolean NOT NULL DEFAULT false,
  evidence_refs        text[] NOT NULL DEFAULT '{}',
  reason               text NOT NULL CHECK (reason IN
                       ('GUEST_REQUEST','FORCE_MAJEURE','HOTEL_RELOCATION','PAYMENT_TIMEOUT',
                        'DUPLICATE','NO_SHOW','SYSTEM','OTA_CANCELLATION','EARLY_CHECKOUT')),
  requested_by         uuid REFERENCES users(id) ON DELETE RESTRICT,
  requester_type       text NOT NULL CHECK (requester_type IN ('USER','GUEST','SYSTEM')),
  requester_id         text NOT NULL CHECK (length(requester_id) > 0),
  approved_by          uuid REFERENCES users(id) ON DELETE RESTRICT,
  decided_at           timestamptz,
  cancelled_at         timestamptz,
  paid_at              timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_refund_event UNIQUE (booking_id, event_key),
  CONSTRAINT ck_refund_requester CHECK (
    (requester_type = 'USER' AND requested_by IS NOT NULL AND requester_id = requested_by::text)
    OR (requester_type IN ('GUEST','SYSTEM') AND requested_by IS NULL)),
  CONSTRAINT ck_refund_requests_two_level CHECK (approved_by IS NULL OR approved_by <> requested_by),
  CONSTRAINT ck_refund_amount_limit CHECK (approved_amount IS NULL OR approved_amount <= requested_amount),
  CONSTRAINT ck_refund_requests_force_majeure CHECK (NOT is_force_majeure OR reason = 'FORCE_MAJEURE'),
  CONSTRAINT ck_refund_requests_approved CHECK (status NOT IN ('APPROVED','PAID') OR
    (approved_amount IS NOT NULL AND approved_by IS NOT NULL AND decided_at IS NOT NULL)),
  CONSTRAINT ck_refund_requests_paid CHECK (status <> 'PAID' OR (approved_amount IS NOT NULL AND paid_at IS NOT NULL)),
  CONSTRAINT ck_refund_requests_cancelled CHECK (status <> 'CANCELLED' OR (cancelled_at IS NOT NULL AND decided_at IS NULL))
);

-- Sổ nghĩa vụ và phân bổ tiền: chi tiết vật lý của Booking/Payment (BR-PAY-02).
CREATE TABLE booking_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  booking_room_id uuid REFERENCES booking_rooms(id) ON DELETE RESTRICT,
  stay_date date,
  kind text NOT NULL CHECK (kind IN ('ROOM','PENALTY','RESCHEDULE_FEE','EXTRA_SERVICE')),
  source_key text NOT NULL,
  amount bigint NOT NULL CHECK (amount >= 0),
  voided_amount bigint NOT NULL DEFAULT 0 CHECK (voided_amount >= 0 AND voided_amount <= amount),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, source_key),
  CHECK (kind <> 'ROOM' OR (booking_room_id IS NOT NULL AND stay_date IS NOT NULL))
);

CREATE TABLE payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  charge_id uuid NOT NULL REFERENCES booking_charges(id) ON DELETE RESTRICT,
  amount bigint NOT NULL CHECK (amount > 0),
  released_amount bigint NOT NULL DEFAULT 0 CHECK (released_amount >= 0 AND released_amount <= amount),
  release_reason text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_id, charge_id),
  CHECK (released_amount = 0 OR length(btrim(coalesce(release_reason, ''))) > 0)
);

-- Chi tiết vật lý của RefundRequest; không thêm cấp duyệt bắt buộc.
CREATE TABLE refund_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_request_id uuid NOT NULL REFERENCES refund_requests(id) ON DELETE RESTRICT,
  request_version bigint NOT NULL CHECK (request_version > 0),
  approver_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approver_role text NOT NULL CHECK (approver_role IN ('MANAGER','OWNER')),
  decision text NOT NULL CHECK (decision IN ('APPROVED','REJECTED')),
  approved_amount bigint CHECK (approved_amount >= 0),
  refund_fee bigint NOT NULL CHECK (refund_fee >= 0),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (refund_request_id, request_version),
  CHECK (decision <> 'APPROVED' OR approved_amount IS NOT NULL)
);

CREATE TABLE refund_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_request_id uuid NOT NULL REFERENCES refund_requests(id) ON DELETE RESTRICT,
  original_payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  refund_payment_id uuid UNIQUE REFERENCES payments(id) ON DELETE RESTRICT,
  amount bigint NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (refund_request_id, original_payment_id)
);

-- docs/04-thiet-ke/csdl.md:1070
CREATE TABLE loyalty_transactions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id   uuid NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
  points     integer NOT NULL CHECK (points <> 0),
  type       text NOT NULL CHECK (type IN ('EARN','REDEEM','EXPIRE','ADJUST')),
  reason     text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_loyalty_booking_type UNIQUE NULLS NOT DISTINCT (guest_id, booking_id, type)
);

-- docs/04-thiet-ke/csdl.md:1085
CREATE TABLE notifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    uuid REFERENCES bookings(id) ON DELETE SET NULL,
  recipient     text NOT NULL,
  channel       text NOT NULL CHECK (channel IN ('EMAIL','SMS','ZALO_OA','PUSH')),
  template      text NOT NULL,
  payload_json  jsonb NOT NULL DEFAULT '{}',
  status        text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENT','FAILED','CANCELLED')),
  sent_at       timestamptz,
  retry_count   smallint NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_notifications_sent CHECK (status <> 'SENT' OR sent_at IS NOT NULL)
);

CREATE SEQUENCE audit_chain_seq;
CREATE TABLE audit_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_seq   bigint NOT NULL UNIQUE,
  actor_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_role  text NOT NULL,
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   uuid,
  before_json jsonb,
  after_json  jsonb,
  reason      text,
  ip_address  inet,
  at          timestamptz NOT NULL DEFAULT now(),
  prev_hash   text,
  row_hash    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

-- Khoá bắt buộc theo BR-SYS-02: refund.feeAmount, job.hold.releaseIntervalSeconds,
-- job.holdReconcile.intervalSeconds, job.channelSync.intervalSeconds, job.overbooking.scanIntervalMinutes,
-- job.occupancy.snapshotIntervalSeconds, job.noShow.markTime, deal.threshold.minor,
-- deal.threshold.checkInDebt, checkInDebtPct, channel.lowInventoryThreshold,
-- pricing.weekendMultiplier, pricing.maxDiscountPct, overbooking.transportSupportCap.
CREATE TABLE system_settings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE,
  value       text NOT NULL,
  value_type  text NOT NULL DEFAULT 'STRING' CHECK (value_type IN ('STRING','NUMBER','BOOLEAN','JSON')),
  description text,
  updated_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE idempotency_keys (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key                text NOT NULL CHECK (length(key) BETWEEN 1 AND 255),
  principal_type     text NOT NULL CHECK (principal_type IN ('USER','GUEST','SYSTEM','ANONYMOUS')),
  principal_id       text NOT NULL CHECK (length(principal_id) > 0),
  method             text NOT NULL CHECK (method IN ('POST','PUT','PATCH','DELETE')),
  path               text NOT NULL CHECK (left(path, 1) = '/'),
  actor_id           uuid REFERENCES users(id) ON DELETE SET NULL,
  request_hash       text NOT NULL,
  status             text NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS','COMPLETED')),
  lease_token        uuid NOT NULL DEFAULT gen_random_uuid(),
  lease_expires_at   timestamptz NOT NULL,
  response_status    smallint CHECK (response_status BETWEEN 100 AND 599),
  response_body_json jsonb,
  response_headers_json jsonb,
  expires_at         timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_idempotency_scope UNIQUE (principal_type, principal_id, method, path, key),
  CONSTRAINT ck_idempotency_keys_expiry CHECK (expires_at > created_at),
  CONSTRAINT ck_idempotency_result CHECK (
    (status = 'IN_PROGRESS' AND response_status IS NULL)
    OR (status = 'COMPLETED' AND response_status IS NOT NULL))
);

CREATE TABLE webhook_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (length(provider) > 0),
  provider_account_id text NOT NULL CHECK (length(provider_account_id) > 0),
  event_id text NOT NULL CHECK (length(event_id) > 0),
  payload_hash text NOT NULL,
  payload_json jsonb NOT NULL,
  signature_verified_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSING','PROCESSED','FAILED','DEAD_LETTER')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  processed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_account_id, event_id),
  CHECK (status <> 'PROCESSING' OR (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK (status <> 'PROCESSED' OR processed_at IS NOT NULL)
);

CREATE TABLE outbox_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type     text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id   uuid NOT NULL,
  channel_id     uuid REFERENCES channels(id) ON DELETE SET NULL,
  payload_json   jsonb NOT NULL,
  status         text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PUBLISHED','FAILED','DEAD_LETTER')),
  attempts       smallint NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error     text,
  available_at   timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  processed_at   timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_outbox_published CHECK (status <> 'PUBLISHED' OR processed_at IS NOT NULL)
);

CREATE TABLE occupancy_snapshots (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id    uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  room_type_id   uuid REFERENCES room_types(id) ON DELETE CASCADE,
  date           date NOT NULL,
  physical_rooms smallint NOT NULL CHECK (physical_rooms >= 0),
  sold_rooms     smallint NOT NULL CHECK (sold_rooms >= 0),
  occupancy_pct  numeric(10,2) NOT NULL CHECK (occupancy_pct >= 0), -- cam kết OTA có thể vượt 200%
  captured_at    timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_occupancy_snapshots_scope UNIQUE NULLS NOT DISTINCT (property_id, room_type_id, date)
);

-- Trạng thái giao bền từng consumer; Redis/BullMQ chỉ là vận chuyển (ADR-017).
CREATE TABLE event_deliveries (
  event_id uuid NOT NULL REFERENCES outbox_events(id) ON DELETE RESTRICT,
  consumer text NOT NULL CHECK (length(btrim(consumer)) > 0),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSING','COMPLETED','DEAD_LETTER')),
  lease_token uuid,
  lease_expires_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  completed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, event_id),
  CHECK (status <> 'PROCESSING' OR (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK (status <> 'COMPLETED' OR completed_at IS NOT NULL)
);

-- docs/04-thiet-ke/csdl.md:1230
-- expectedVersion/If-Match là đầu vào API; version là giá trị lưu ở CSDL.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bookings','refund_requests','room_moves','room_merges','housekeeping_tasks','properties','room_types',
    'channels','channel_property_settings','channel_allotments','cancellation_policies',
    'cancellation_tiers','rate_plans','seasons','rate_calendars','promotions','system_settings']
  LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN version bigint NOT NULL DEFAULT 1 CHECK (version > 0)', t);
  END LOOP;
END $$;

CREATE FUNCTION fn_increment_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.version := OLD.version + 1;
  RETURN NEW;
END $$;

DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'version'
  LOOP
    EXECUTE format('CREATE TRIGGER trg_version BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION fn_increment_version()', t.table_name);
  END LOOP;
END $$;

CREATE FUNCTION fn_immutable_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Cascade chỉ khi parent đã qua guard xoá DRAFT/HELD và lưu bằng chứng vào AuditLog.
  IF TG_OP = 'DELETE' AND TG_TABLE_NAME = 'price_snapshots' THEN
    IF NOT EXISTS (SELECT 1 FROM bookings WHERE id = OLD.booking_id)
       AND EXISTS (SELECT 1 FROM audit_logs WHERE entity_id = OLD.booking_id
                    AND entity_type = 'Booking' AND action = 'DELETE') THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION 'immutable record in %', TG_TABLE_NAME USING ERRCODE = '42501';
END $$;
CREATE TRIGGER trg_price_snapshots_immutable BEFORE UPDATE OR DELETE ON price_snapshots
  FOR EACH ROW EXECUTE FUNCTION fn_immutable_record();
CREATE TRIGGER trg_refund_approvals_immutable BEFORE UPDATE OR DELETE ON refund_approvals
  FOR EACH ROW EXECUTE FUNCTION fn_immutable_record();

CREATE FUNCTION fn_guard_booking_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status NOT IN ('DRAFT','HELD') OR EXISTS (SELECT 1 FROM payments WHERE booking_id = OLD.id)
     OR length(btrim(coalesce(current_setting('app.delete_reason', true), ''))) = 0 THEN
    RAISE EXCEPTION 'only unpaid DRAFT/HELD with deletion reason can be deleted' USING ERRCODE = '23514';
  END IF;
  INSERT INTO audit_logs(actor_id, actor_role, action, entity_type, entity_id, before_json, reason)
    VALUES (nullif(current_setting('app.actor_id', true), '')::uuid, fn_current_role(),
      'DELETE', 'Booking', OLD.id, jsonb_build_object('booking', to_jsonb(OLD),
        'priceSnapshots', (SELECT coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
          FROM price_snapshots s WHERE s.booking_id = OLD.id)),
      current_setting('app.delete_reason', true));
  RETURN OLD;
END $$;
CREATE TRIGGER trg_bookings_delete BEFORE DELETE ON bookings
  FOR EACH ROW EXECUTE FUNCTION fn_guard_booking_delete();

CREATE FUNCTION fn_guard_refund_approval() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r refund_requests%ROWTYPE; u users%ROWTYPE;
BEGIN
  SELECT * INTO STRICT r FROM refund_requests WHERE id = NEW.refund_request_id FOR UPDATE;
  SELECT * INTO STRICT u FROM users WHERE id = NEW.approver_id;
  IF r.status <> 'PENDING' OR r.version <> NEW.request_version
    OR NEW.approver_id = r.requested_by OR NOT u.is_active
    OR u.role NOT IN ('MANAGER','OWNER') OR NEW.approver_role <> u.role
    OR NEW.refund_fee <> r.refund_fee THEN
    RAISE EXCEPTION 'invalid refund approval or stale version' USING ERRCODE = '23514';
  END IF;
  IF u.role = 'MANAGER' AND NOT EXISTS (
    SELECT 1 FROM bookings b JOIN user_property_scopes s ON s.property_id = b.property_id
      WHERE b.id = r.booking_id AND s.user_id = u.id) THEN
    RAISE EXCEPTION 'approver outside property scope' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_refund_approvals_guard BEFORE INSERT ON refund_approvals
  FOR EACH ROW EXECUTE FUNCTION fn_guard_refund_approval();

CREATE FUNCTION fn_guard_refund_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.requester_type = 'GUEST' AND NOT EXISTS (
    SELECT 1 FROM bookings b WHERE b.id = NEW.booking_id AND b.guest_id::text = NEW.requester_id) THEN
    RAISE EXCEPTION 'refund guest must own booking' USING ERRCODE = '23514';
  END IF;
  IF NEW.payment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM payments p WHERE p.id = NEW.payment_id AND p.booking_id = NEW.booking_id AND p.amount > 0) THEN
    RAISE EXCEPTION 'refund source belongs to another booking' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PENDING' THEN
      RAISE EXCEPTION 'refund starts PENDING' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.booking_id, NEW.event_key, NEW.requester_type, NEW.requester_id, NEW.requested_by)
    IS DISTINCT FROM (OLD.booking_id, OLD.event_key, OLD.requester_type, OLD.requester_id, OLD.requested_by) THEN
    RAISE EXCEPTION 'refund requester and booking are immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.status <> 'PENDING' AND (
    (NEW.approved_amount, NEW.refund_fee, NEW.requested_amount, NEW.approved_by, NEW.decided_at)
      IS DISTINCT FROM (OLD.approved_amount, OLD.refund_fee, OLD.requested_amount, OLD.approved_by, OLD.decided_at)
    OR (NEW.status <> OLD.status AND NOT (OLD.status = 'APPROVED' AND NEW.status = 'PAID'))) THEN
    RAISE EXCEPTION 'refund decision is final' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'PENDING' AND NEW.status IN ('APPROVED','REJECTED') AND NOT EXISTS (
    SELECT 1 FROM refund_approvals a WHERE a.refund_request_id = OLD.id
      AND a.request_version = OLD.version AND a.decision = NEW.status
      AND a.approver_id = NEW.approved_by AND a.refund_fee = NEW.refund_fee
      AND a.approved_amount IS NOT DISTINCT FROM NEW.approved_amount) THEN
    RAISE EXCEPTION 'independent approval record required' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'PENDING' AND NEW.status = 'PAID' THEN
    RAISE EXCEPTION 'approve before paying' USING ERRCODE = '23514';
  END IF;
  IF NEW.status IN ('PENDING','APPROVED') AND (SELECT coalesce(sum(a.amount), 0)
    FROM refund_allocations a WHERE a.refund_request_id = NEW.id)
    > greatest(0::bigint, coalesce(NEW.approved_amount, NEW.requested_amount) - NEW.refund_fee) THEN
    RAISE EXCEPTION 'adjust reserved allocations before reducing refund' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'PAID' AND (SELECT coalesce(sum(a.amount), 0)
      FROM refund_allocations a JOIN payments p ON p.id = a.refund_payment_id
     WHERE a.refund_request_id = NEW.id AND p.status = 'SUCCEEDED')
      <> greatest(0::bigint, coalesce(NEW.approved_amount, NEW.requested_amount) - NEW.refund_fee) THEN
    RAISE EXCEPTION 'successful allocations must equal net refund' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_refund_requests_guard BEFORE INSERT OR UPDATE ON refund_requests
  FOR EACH ROW EXECUTE FUNCTION fn_guard_refund_request();

CREATE FUNCTION fn_guard_refund_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r refund_requests%ROWTYPE; p payments%ROWTYPE; reserved numeric;
BEGIN
  SELECT * INTO STRICT r FROM refund_requests WHERE id = NEW.refund_request_id FOR UPDATE;
  SELECT * INTO STRICT p FROM payments WHERE id = NEW.original_payment_id FOR UPDATE;
  IF r.status NOT IN ('PENDING','APPROVED') OR p.booking_id <> r.booking_id OR p.amount <= 0 OR p.status <> 'SUCCEEDED' THEN
    RAISE EXCEPTION 'allocation needs pending/approved refund and successful original payment' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND ((NEW.refund_request_id, NEW.original_payment_id)
    IS DISTINCT FROM (OLD.refund_request_id, OLD.original_payment_id)
    OR (r.status <> 'PENDING' AND NEW.amount <> OLD.amount)) THEN
    RAISE EXCEPTION 'allocation source and amount are immutable' USING ERRCODE = '23514';
  END IF;
  SELECT coalesce(sum(a.amount), 0) INTO reserved FROM refund_allocations a
    JOIN refund_requests rr ON rr.id = a.refund_request_id
    WHERE a.original_payment_id = p.id AND a.id <> NEW.id AND rr.status IN ('PENDING','APPROVED','PAID');
  IF reserved + NEW.amount > p.amount OR NEW.amount + (
    SELECT coalesce(sum(a.amount), 0) FROM refund_allocations a
    WHERE a.refund_request_id = r.id AND a.id <> NEW.id) > r.net_refund THEN
    RAISE EXCEPTION 'refund allocation exceeds available funds' USING ERRCODE = '23514';
  END IF;
  IF NEW.refund_payment_id IS NOT NULL AND (r.status <> 'APPROVED' OR NOT EXISTS (
    SELECT 1 FROM payments rp WHERE rp.id = NEW.refund_payment_id
      AND rp.booking_id = r.booking_id AND rp.type = 'REFUND'
      AND (rp.method = p.method OR (p.method = 'CASH' AND rp.method = 'BANK_TRANSFER' AND length(btrim(coalesce(rp.note, ''))) > 0))
      AND rp.amount = -NEW.amount)) THEN
    RAISE EXCEPTION 'refund payment must match original method, booking and allocation' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.refund_payment_id IS NOT NULL
    AND NEW.refund_payment_id IS DISTINCT FROM OLD.refund_payment_id THEN
    RAISE EXCEPTION 'reuse the same refund payment when retrying' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_refund_allocations_guard BEFORE INSERT OR UPDATE ON refund_allocations
  FOR EACH ROW EXECUTE FUNCTION fn_guard_refund_allocation();
CREATE TRIGGER trg_refund_allocations_no_delete BEFORE DELETE ON refund_allocations
  FOR EACH ROW EXECUTE FUNCTION fn_immutable_record();

CREATE FUNCTION fn_guard_payment_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.booking_id, NEW.type, NEW.method, NEW.amount, NEW.idempotency_key)
    IS DISTINCT FROM (OLD.booking_id, OLD.type, OLD.method, OLD.amount, OLD.idempotency_key)
    OR (OLD.provider_txn_id IS NOT NULL AND NEW.provider_txn_id IS DISTINCT FROM OLD.provider_txn_id)
    OR (OLD.status = 'SUCCEEDED' AND NEW.status <> 'SUCCEEDED') THEN
    RAISE EXCEPTION 'payment identity and successful receipt are immutable; use a refund entry'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_payments_identity BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION fn_guard_payment_identity();

-- ─────────────────────────────────────────────────────────────────────────────
-- BR-INV-03 — BẤT BIẾN CỨNG: mỗi (room_id, bed_no, đêm) tối đa 1 RoomAssignment hoạt động.
-- Đơn vị bán là (phòng, giường): bed_no = 0 nghĩa là "cả phòng" (mọi loại phòng bán theo
-- phòng), bed_no = 1..bedCount là giường cụ thể (chỉ DOR — BR-PROP-04, MERGE_SHARE).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE room_assignments
  ADD CONSTRAINT excl_room_assignments_no_double_booking
  EXCLUDE USING gist (room_id WITH =,
    (CASE WHEN bed_no = 0 THEN int4range(0, NULL, '[)')
          ELSE int4range(bed_no::int, bed_no::int + 1, '[)') END) WITH &&,
    valid_range WITH &&)
  WHERE (released_at IS NULL);

-- Một BookingRoom chỉ được gán một nơi trong một đêm; đổi phòng dùng đoạn ngày liền kề.
ALTER TABLE room_assignments
  ADD CONSTRAINT excl_booking_room_one_assignment
  EXCLUDE USING gist (booking_room_id WITH =, valid_range WITH &&)
  WHERE (released_at IS NULL);

-- Đơn vị bán hợp lệ: giường chỉ tồn tại ở phòng đa giường, số giường không vượt sức chứa phòng.
CREATE OR REPLACE FUNCTION fn_guard_bed_no() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_shared   boolean;
  v_bed_count smallint;
BEGIN
  SELECT rt.allow_shared, r.bed_count INTO v_shared, v_bed_count
    FROM rooms r JOIN room_types rt ON rt.id = r.room_type_id
   WHERE r.id = NEW.room_id;
  IF NEW.bed_no = 0 THEN
    IF v_shared THEN
      RAISE EXCEPTION 'DOR requires individual bed claims, not bed_no=0' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT v_shared THEN
    RAISE EXCEPTION 'E_PROP_NOT_SHARED: phòng % bán theo phòng, không dùng bed_no > 0', NEW.room_id
      USING ERRCODE = '23514';
  END IF;
  IF NEW.bed_no > v_bed_count THEN
    RAISE EXCEPTION 'E_PROP_BED_NO_RANGE: bed_no % vượt số giường % của phòng', NEW.bed_no, v_bed_count
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_room_assignments_bed_no
  BEFORE INSERT OR UPDATE ON room_assignments
  FOR EACH ROW EXECUTE FUNCTION fn_guard_bed_no();

-- Phòng thường bán một đơn vị dù có nhiều giường vật lý (BR-PROP-04).
CREATE OR REPLACE FUNCTION fn_guard_room_bed_count() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_shared boolean;
BEGIN
  SELECT allow_shared INTO v_shared FROM room_types WHERE id = NEW.room_type_id;
  IF EXISTS (SELECT 1 FROM room_assignments ra WHERE ra.room_id = NEW.id
      AND ra.released_at IS NULL AND (ra.bed_no > NEW.bed_count OR (NOT v_shared AND ra.bed_no > 0))) THEN
    RAISE EXCEPTION 'E_PROP_BED_COUNT: thay đổi sức chứa làm mất đơn vị đang được gán'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_rooms_bed_count
  BEFORE INSERT OR UPDATE ON rooms
  FOR EACH ROW EXECUTE FUNCTION fn_guard_room_bed_count();

-- Không thể khoá một phòng lên lịch đang có assignment hoạt động (BR-INV-06).
CREATE OR REPLACE FUNCTION fn_guard_room_block_overlap() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_room_id uuid          := COALESCE(NEW.room_id, OLD.room_id);
  v_range   daterange;
BEGIN
  -- Mọi đường ghi block/assignment khoá cùng room; transaction dùng READ COMMITTED.
  PERFORM 1 FROM rooms WHERE id = v_room_id FOR UPDATE;
  IF TG_TABLE_NAME = 'room_blocks' THEN
    v_range := daterange(NEW.start_date, NEW.end_date, '[)');
    IF EXISTS (SELECT 1 FROM room_assignments ra
                WHERE ra.room_id = v_room_id
                  AND ra.released_at IS NULL
                  AND ra.valid_range && v_range) THEN
      IF fn_current_role() NOT IN ('MANAGER','OWNER') THEN
        RAISE EXCEPTION 'E_INV_BLOCK_OVERLAP: khoá phòng chồng lấn lịch đang hoạt động'
          USING ERRCODE = '23P01';
      END IF;
    END IF;
  ELSE
    IF NEW.released_at IS NOT NULL THEN RETURN NEW; END IF;
    -- Cột GENERATED chưa có giá trị trong BEFORE trigger.
    v_range := daterange(NEW.start_date, NEW.end_date, '[)');
    IF EXISTS (SELECT 1 FROM room_blocks b
                WHERE b.room_id = v_room_id
                  AND daterange(b.start_date, b.end_date, '[)') && v_range) THEN
      RAISE EXCEPTION 'E_INV_ROOM_BLOCKED: phòng đang bị khoá trong khoảng ngày này'
        USING ERRCODE = '23P01';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_room_blocks_overlap_guard
  BEFORE INSERT OR UPDATE ON room_blocks
  FOR EACH ROW EXECUTE FUNCTION fn_guard_room_block_overlap();

CREATE TRIGGER trg_room_assignments_block_guard
  BEFORE INSERT OR UPDATE ON room_assignments
  FOR EACH ROW EXECUTE FUNCTION fn_guard_room_block_overlap();

-- BR-INV-05 — allotment một ngày không vượt số đơn vị bán của loại phòng.
CREATE OR REPLACE FUNCTION fn_guard_allotment_capacity() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_physical integer;
BEGIN
  -- Ghi used thực tế của OTA không phải sửa cấu hình quota.
  IF TG_OP = 'UPDATE' AND (NEW.allotment, NEW.room_type_id, NEW.date)
    IS NOT DISTINCT FROM (OLD.allotment, OLD.room_type_id, OLD.date) THEN RETURN NEW; END IF;
  SELECT sum(CASE WHEN rt.allow_shared THEN r.bed_count ELSE 1 END)::int INTO v_physical
    FROM rooms r JOIN room_types rt ON rt.id = r.room_type_id
   WHERE r.room_type_id = NEW.room_type_id AND r.status = 'ACTIVE';
  IF NEW.allotment > coalesce(v_physical, 0) THEN
    RAISE EXCEPTION 'E_INV_ALLOTMENT_EXCEEDS_ROOMS: allotment % > % đơn vị bán',
      NEW.allotment, v_physical USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_channel_allotments_capacity
  BEFORE INSERT OR UPDATE ON channel_allotments
  FOR EACH ROW EXECUTE FUNCTION fn_guard_allotment_capacity();

-- BR-SYS-01 + NFR-SEC-04 — app role không sửa/xoá; superuser không nằm trong trust boundary này.
CREATE OR REPLACE FUNCTION fn_audit_logs_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'E_SYS_AUDIT_IMMUTABLE: AuditLog là append-only, cấm UPDATE/DELETE'
    USING ERRCODE = '42501';
END $$;

CREATE TRIGGER trg_audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION fn_audit_logs_append_only();

-- Hash chuẩn dùng epoch; không phụ thuộc TimeZone session khi kiểm tra.
CREATE FUNCTION fn_audit_digest(a audit_logs, previous_hash text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT encode(digest(jsonb_build_array(coalesce(previous_hash, 'GENESIS'),
    to_jsonb(a) - 'row_hash' - 'prev_hash' - 'at' - 'created_at' - 'updated_at',
    extract(epoch FROM a.at), extract(epoch FROM a.created_at))::text, 'sha256'), 'hex')
$$;

-- Cấp chain_seq SAU khóa; thứ tự append không phụ thuộc timestamp/UUID của client.
CREATE OR REPLACE FUNCTION fn_audit_logs_hash_chain() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_prev text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('audit_logs.chain'));
  NEW.chain_seq := nextval('audit_chain_seq');
  SELECT row_hash INTO v_prev FROM audit_logs ORDER BY chain_seq DESC LIMIT 1;
  NEW.prev_hash := v_prev;
  NEW.row_hash := fn_audit_digest(NEW, v_prev);
  RETURN NEW;
END $$;

CREATE TRIGGER trg_audit_logs_hash_chain
  BEFORE INSERT ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION fn_audit_logs_hash_chain();

-- Cập nhật updated_at tự động cho mọi bảng nghiệp vụ (AuditLog được miễn: append-only).
CREATE OR REPLACE FUNCTION fn_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
     WHERE c.table_schema = 'public' AND c.column_name = 'updated_at'
       AND c.table_name <> 'audit_logs'
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at()',
      'trg_' || t.table_name || '_touch', t.table_name);
  END LOOP;
END $$;

-- docs/04-thiet-ke/csdl.md:1615
-- Tồn phòng theo khoảng ngày (BR-INV-01, BR-INV-07, UC-INV-01/02)
CREATE UNIQUE INDEX uq_snapshot_original ON price_snapshots(booking_id) WHERE kind = 'ORIGINAL';
CREATE UNIQUE INDEX uq_snapshot_quote_acceptance ON price_snapshots((payload_json->>'quoteId'))
  WHERE kind = 'ORIGINAL' AND payload_json->>'quoteId' IS NOT NULL;
CREATE INDEX idx_delivery_pending ON event_deliveries(status, lease_expires_at)
  WHERE status IN ('PENDING','PROCESSING');
CREATE INDEX idx_room_assignments_active_room_range
  ON room_assignments USING gist (room_id, bed_no, valid_range) WHERE released_at IS NULL;
CREATE INDEX idx_room_assignments_booking_room
  ON room_assignments (booking_room_id) WHERE released_at IS NULL;
CREATE INDEX idx_rooms_active_by_type
  ON rooms (room_type_id, property_id) WHERE status = 'ACTIVE';
CREATE INDEX idx_room_blocks_range
  ON room_blocks USING gist (room_id, (daterange(start_date, end_date, '[)')));
-- Booking theo khách, theo cơ sở và theo hạn cọc (UC-BOOK-07, BR-PAY-02)
CREATE INDEX idx_bookings_guest_created ON bookings (guest_id, created_at DESC);
CREATE INDEX idx_bookings_property_checkin ON bookings (property_id, check_in);
CREATE INDEX idx_bookings_deposit_due
  ON bookings (status, check_in) WHERE status IN ('HELD','PENDING_PAYMENT');
CREATE INDEX idx_bookings_hold_expiry
  ON bookings (hold_expires_at) WHERE status IN ('HELD','PENDING_PAYMENT');
CREATE UNIQUE INDEX uq_bookings_channel_external_ref
  ON bookings (channel_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE INDEX idx_bookings_cancel_reason
  ON bookings (cancel_reason) WHERE cancel_reason IS NOT NULL;
-- Thanh toán theo ngày, theo booking và theo ca (UC-PAY-05, BR-PAY-10)
CREATE INDEX idx_payments_paid_at ON payments (paid_at) WHERE status = 'SUCCEEDED';
CREATE INDEX idx_payments_booking ON payments (booking_id, created_at DESC);
CREATE INDEX idx_refund_requests_status ON refund_requests (status, created_at DESC);
-- Đồng bộ kênh qua outbox (BR-CHAN-02, BR-CHAN-06)
CREATE INDEX idx_outbox_pending
  ON outbox_events (available_at, created_at) WHERE status IN ('PENDING','FAILED');
-- Quá tải: gộp trùng theo (property, date, roomType) và hạn T−24h (BR-OVER-04/05)
CREATE UNIQUE INDEX uq_overbooking_open_case
  ON overbooking_cases (property_id, date, room_type_id) WHERE status <> 'RESOLVED';
CREATE INDEX idx_overbooking_deadline
  ON overbooking_cases (date) WHERE status <> 'RESOLVED';
-- Giá, mùa, allotment (UC-RATE-01/02/05, UC-INV-03)
CREATE INDEX idx_rate_calendars_date ON rate_calendars (date);
CREATE INDEX idx_seasons_window ON seasons (start_date, end_date) WHERE status = 'ACTIVE';
CREATE INDEX idx_channel_allotments_date ON channel_allotments (date, room_type_id);
-- Khách, điểm thưởng, danh sách đen (UC-CRM-01/02/03)
CREATE UNIQUE INDEX uq_guests_phone ON guests (phone) WHERE anonymized_at IS NULL;
CREATE INDEX idx_guests_blacklist ON guests (blacklisted) WHERE blacklisted;
CREATE INDEX idx_loyalty_guest_created ON loyalty_transactions (guest_id, created_at DESC);
-- Nhật ký kiểm toán & hàng đợi thông báo (UC-SYS-01, BR-SYS-06)
CREATE INDEX idx_audit_logs_entity ON audit_logs (entity_type, entity_id, at DESC);
CREATE INDEX idx_audit_logs_actor ON audit_logs (actor_id, at DESC);
CREATE INDEX idx_notifications_pending
  ON notifications (status, created_at) WHERE status IN ('PENDING','FAILED');
-- Buồng phòng, điều chuyển, công suất (BR-FO-06, UC-OVER-02, BR-RATE-04.3)
CREATE INDEX idx_housekeeping_date_status ON housekeeping_tasks (business_date, status);
CREATE INDEX idx_room_moves_booking ON room_moves (booking_id, created_at DESC);
CREATE UNIQUE INDEX uq_room_merges_active_secondary
  ON room_merges (secondary_booking_id) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX uq_room_merges_active_primary
  ON room_merges (primary_booking_id) WHERE status = 'ACTIVE';
CREATE INDEX idx_rate_calendars_lookup
  ON rate_calendars (room_type_id, date, priority DESC, channel_code, created_at);
CREATE INDEX idx_payments_collector_vn_day
  ON payments (created_by, ((paid_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date))
  WHERE method = 'CASH' AND status = 'SUCCEEDED';
CREATE INDEX idx_occupancy_snapshots_property_date
  ON occupancy_snapshots (property_id, date) WHERE room_type_id IS NULL;
CREATE INDEX idx_idempotency_keys_expiry ON idempotency_keys (expires_at) WHERE status = 'COMPLETED';
CREATE INDEX idx_idempotency_keys_recovery ON idempotency_keys (lease_expires_at) WHERE status = 'IN_PROGRESS';
CREATE INDEX idx_webhook_inbox_pending ON webhook_inbox (available_at, created_at) WHERE status IN ('PENDING','FAILED');
CREATE INDEX idx_webhook_inbox_recovery ON webhook_inbox (lease_expires_at) WHERE status = 'PROCESSING';
CREATE INDEX idx_refund_allocations_source ON refund_allocations (original_payment_id);
CREATE INDEX idx_booking_charges_booking ON booking_charges (booking_id);
CREATE INDEX idx_payment_allocations_charge ON payment_allocations (charge_id);
CREATE INDEX idx_channel_property_settings_effective
  ON channel_property_settings (channel_id, property_id, effective_from DESC);

-- docs/04-thiet-ke/csdl.md:1693
-- BR-SYS-01 — thu hồi quyền ghi trên bảng append-only ở tầng CSDL.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    CREATE ROLE app_rw LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_ro') THEN
    CREATE ROLE app_ro LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'analytics_ro') THEN
    CREATE ROLE analytics_ro LOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO app_rw, app_ro, analytics_ro;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_rw;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_ro;
-- Analytics không được đọc users/guests/inbox/raw audit; cấp view tổng hợp đã review khi thi công.
GRANT SELECT ON properties, room_types, channels TO analytics_ro;

REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM app_rw, app_ro, analytics_ro;
REVOKE UPDATE, DELETE, TRUNCATE ON price_snapshots, refund_approvals FROM app_rw, app_ro, analytics_ro;
REVOKE DELETE, TRUNCATE ON refund_allocations, payments, refund_requests FROM app_rw, app_ro, analytics_ro;

-- Quyền mặc định cho bảng tạo về sau; mọi migration PHẢI chạy lại khối REVOKE ở trên
-- cho các bảng append-only mới (xem §8.3 Quy tắc migration).
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO app_ro;

