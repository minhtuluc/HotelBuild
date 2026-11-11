-- HB-230 (TD-80, QA HB-194 QA-F6-05): `RoomMove` lưu ca quá tải và bằng chứng đồng ý của khách.
-- Hợp đồng `roomMoveCreateRequestSchema`/`roomMoveSchema` đã có `overbookingCaseId` và `consent`, nhưng
-- bảng `room_moves` không có cột tương ứng: máy chủ nhận rồi trả `null`. Hệ quả: truy vết ca ⇒ lệnh điều
-- chuyển phải suy từ booking + đêm, và bằng chứng đồng ý (BR-OVER-06) chỉ nằm trong `reason`/audit.
--
-- Cột mới đều nullable: lệnh cũ không có dữ liệu để điền lại (không đoán ngược ca từ booking).
-- `ON DELETE RESTRICT`: ca quá tải đã có lệnh điều chuyển không được xoá (giữ chuỗi bằng chứng).

BEGIN;

ALTER TABLE room_moves
  ADD COLUMN overbooking_case_id uuid REFERENCES overbooking_cases(id) ON DELETE RESTRICT,
  ADD COLUMN consent_json jsonb;

ALTER TABLE room_moves ADD CONSTRAINT ck_room_moves_consent_object
  CHECK (consent_json IS NULL OR jsonb_typeof(consent_json) = 'object');

CREATE INDEX idx_room_moves_overbooking_case ON room_moves(overbooking_case_id)
  WHERE overbooking_case_id IS NOT NULL;

COMMIT;
