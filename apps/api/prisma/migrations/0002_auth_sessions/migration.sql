-- HB-010 / QĐ-03: forward-only identity schema; baseline0001 is frozen.
BEGIN;
ALTER TABLE users ADD COLUMN must_change_password boolean NOT NULL DEFAULT false, ADD COLUMN password_changed_at timestamptz;

CREATE TABLE guest_credentials (
  guest_id uuid PRIMARY KEY REFERENCES guests(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  failed_login_count smallint NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
  locked_until timestamptz,
  password_changed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_type text NOT NULL CHECK (principal_type IN ('USER','GUEST')),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  guest_id uuid REFERENCES guests(id) ON DELETE CASCADE,
  surface text NOT NULL CHECK (surface IN ('OPS_WEB','OPS_ANDROID','GUEST_WEB','GUEST_ANDROID')),
  family_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  rotated_at timestamptz,
  revoked_at timestamptz,
  revoke_reason text,
  ip inet,
  user_agent text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_auth_sessions_principal CHECK (
    (principal_type = 'USER' AND user_id IS NOT NULL AND guest_id IS NULL) OR
    (principal_type = 'GUEST' AND guest_id IS NOT NULL AND user_id IS NULL)
  ),
  CONSTRAINT ck_auth_sessions_surface CHECK (
    (principal_type = 'USER' AND surface IN ('OPS_WEB','OPS_ANDROID')) OR
    (principal_type = 'GUEST' AND surface IN ('GUEST_WEB','GUEST_ANDROID'))
  ),
  CONSTRAINT ck_auth_sessions_expiry CHECK (expires_at > created_at),
  CONSTRAINT uq_auth_sessions_id_user UNIQUE (id, user_id)
);
CREATE INDEX idx_auth_sessions_family ON auth_sessions (family_id);
CREATE INDEX idx_auth_sessions_active_user ON auth_sessions (user_id)
  WHERE revoked_at IS NULL AND rotated_at IS NULL AND user_id IS NOT NULL;
CREATE INDEX idx_auth_sessions_active_guest ON auth_sessions (guest_id)
  WHERE revoked_at IS NULL AND rotated_at IS NULL AND guest_id IS NOT NULL;

CREATE TABLE user_pins (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  pin_hash text NOT NULL,
  failed_count smallint NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  locked_until timestamptz,
  set_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pin_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  purpose text NOT NULL,
  booking_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_pin_grants_session_user FOREIGN KEY (session_id, user_id)
    REFERENCES auth_sessions(id, user_id) ON DELETE CASCADE,
  CONSTRAINT ck_pin_grants_expiry CHECK (expires_at > created_at AND expires_at <= created_at + interval '5 minutes')
);

CREATE TABLE guest_password_resets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id uuid NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_guest_password_resets_expiry CHECK (expires_at > created_at AND expires_at <= created_at + interval '30 minutes')
);

ALTER TABLE pin_grants ADD CONSTRAINT fk_pin_grants_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE;

CREATE TRIGGER trg_guest_credentials_touch BEFORE UPDATE ON guest_credentials FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();
CREATE TRIGGER trg_auth_sessions_touch BEFORE UPDATE ON auth_sessions FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();
CREATE TRIGGER trg_user_pins_touch BEFORE UPDATE ON user_pins FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();
CREATE TRIGGER trg_pin_grants_touch BEFORE UPDATE ON pin_grants FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();
CREATE TRIGGER trg_guest_password_resets_touch BEFORE UPDATE ON guest_password_resets FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();
COMMIT;
