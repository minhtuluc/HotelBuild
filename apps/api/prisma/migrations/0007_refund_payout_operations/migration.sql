-- HB-100: thao tác chi hoàn bền (ADR-016) — trạng thái kỹ thuật tách khỏi `refund_requests.status`.
--
-- Mỗi dòng là **một leg** (một receipt gốc) của hồ sơ hoàn; `refund_allocation_id`/`refund_payment_id`
-- UNIQUE nên không thể sinh leg hay chứng từ chi thứ hai cho cùng request+receipt. `psp_key` là khoá
-- idempotency bền của PSP (thay key mới chỉ sau khi PSP xác nhận lần trước thất bại dứt điểm), và
-- lease/version bảo vệ worker cũ không commit kết quả khi đã mất lease.
--
-- READY/IN_FLIGHT/UNKNOWN/SUCCEEDED/FAILED_FINAL là trạng thái **operation kỹ thuật**, không thêm vào
-- enum `RefundStatus`. Timeout chỉ chứng minh hệ thống ngừng chờ; hạn mức hoàn vẫn giữ tới khi có
-- bằng chứng PSP đã/không chi.
CREATE TABLE refund_payout_operations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_request_id   uuid NOT NULL REFERENCES refund_requests(id) ON DELETE RESTRICT,
  refund_allocation_id uuid NOT NULL UNIQUE REFERENCES refund_allocations(id) ON DELETE RESTRICT,
  original_payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  refund_payment_id   uuid NOT NULL UNIQUE REFERENCES payments(id) ON DELETE RESTRICT,
  method              text NOT NULL CHECK (method IN ('VNPAY','MOMO','BANK_TRANSFER')),
  amount              bigint NOT NULL CHECK (amount > 0),
  bank_note           text,
  status              text NOT NULL DEFAULT 'READY'
                      CHECK (status IN ('READY','IN_FLIGHT','UNKNOWN','SUCCEEDED','FAILED_FINAL')),
  psp_key             text NOT NULL UNIQUE CHECK (length(btrim(psp_key)) > 0),
  provider_txn_id     text,
  attempts            integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_token         uuid,
  lease_expires_at    timestamptz,
  version             bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  last_error          text,
  started_at          timestamptz,
  finished_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_refund_payout_lease CHECK (
    status <> 'IN_FLIGHT' OR (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CONSTRAINT ck_refund_payout_succeeded CHECK (
    status <> 'SUCCEEDED' OR (provider_txn_id IS NOT NULL AND finished_at IS NOT NULL)),
  CONSTRAINT ck_refund_payout_failed CHECK (
    status <> 'FAILED_FINAL' OR last_error IS NOT NULL)
);

CREATE INDEX idx_refund_payout_ready
  ON refund_payout_operations (created_at)
  WHERE status IN ('READY','IN_FLIGHT','UNKNOWN');

-- Sổ **mô phỏng** phía PSP cho môi trường chưa có sandbox (cùng vai trò `PspSimulator` của HB-094).
-- Worker chỉ ghi bảng này khi `REFUND_PAYOUT_SIMULATOR=true`; production luôn chạy đối soát thủ công.
-- Ghi bằng kết nối riêng (không phải transaction nghiệp vụ) để mô phỏng PSP đã chi trước khi DB commit —
-- đúng ca crash bắt buộc của ADR-016.
CREATE TABLE refund_payout_simulator_transfers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  psp_key         text NOT NULL UNIQUE CHECK (length(btrim(psp_key)) > 0),
  method          text NOT NULL CHECK (method IN ('VNPAY','MOMO')),
  amount          bigint NOT NULL CHECK (amount > 0),
  status          text NOT NULL CHECK (status IN ('SUCCEEDED','FAILED')),
  provider_txn_id text NOT NULL UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Quy ước §1: bảng có `updated_at` tự cập nhật; khối DO của baseline chỉ quét bảng có mặt lúc đó.
CREATE TRIGGER trg_refund_payout_operations_touch BEFORE UPDATE ON refund_payout_operations
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();
CREATE TRIGGER trg_refund_payout_operations_version BEFORE UPDATE ON refund_payout_operations
  FOR EACH ROW EXECUTE FUNCTION fn_increment_version();
