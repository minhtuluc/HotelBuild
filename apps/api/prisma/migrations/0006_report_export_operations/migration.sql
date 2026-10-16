-- HB-163: bảng `operations` (thao tác bất đồng bộ) — dùng chung cho xuất báo cáo trước, HB-179 sau này.
-- Nguyên tắc: mỗi thao tác gắn **người yêu cầu** và **ảnh chụp phạm vi cơ sở** tại thời điểm yêu cầu, để job
-- chạy sau đó vẫn chỉ chạm đúng dữ liệu người yêu cầu được xem (BR-RBAC-02, api.md §6.2).
CREATE TABLE operations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind              text NOT NULL CHECK (kind IN ('REPORT_EXPORT')),
  status            text NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING','RUNNING','SUCCEEDED','FAILED')),
  requested_by      uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  property_scope    uuid[] NOT NULL DEFAULT '{}',
  payload_json      jsonb NOT NULL,
  -- Ảnh chụp kết quả để worker sinh tệp; job xoá sau khi tệp xong (không giữ dữ liệu thêm một chỗ).
  result_json       jsonb,
  result_ref        text,
  -- Đường dẫn tệp tạm (chỉ trong worker); client chỉ nhận `result_ref` đã ký và còn hạn.
  result_path       text,
  result_expires_at timestamptz,
  error_code        text,
  error_message     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  started_at        timestamptz,
  finished_at       timestamptz,
  CONSTRAINT ck_operations_failed CHECK (
    status <> 'FAILED' OR (error_code IS NOT NULL AND finished_at IS NOT NULL)),
  CONSTRAINT ck_operations_succeeded CHECK (
    status <> 'SUCCEEDED' OR (result_ref IS NOT NULL AND result_path IS NOT NULL AND finished_at IS NOT NULL))
);

CREATE INDEX idx_operations_requested_by ON operations (requested_by, created_at DESC);

-- Quy ước §1 (csdl §3.1): mọi bảng có `updated_at` đều tự cập nhật. Khối DO trong baseline 0001 chỉ quét
-- bảng có mặt lúc đó, nên migration sau baseline phải tự dựng trigger (như `0004_allotment_scopes`,
-- `0005_room_updated_at`) — thiếu nó thì `updated_at` của `operations` đứng yên và lệch csdl §3.
CREATE TRIGGER trg_operations_touch BEFORE UPDATE ON operations
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();
