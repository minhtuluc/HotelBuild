-- HB-131 — bề mặt CHAN cần thêm ba thứ mà 0009 chưa có:
--   1. `channel_allotments` giữ **provenance** đóng bán tại chỗ (manual/automatic + người đóng) vì
--      `is_closed` là cờ hiệu lực duy nhất mà loader tồn (HB-036) đọc; `channel_sales_closures` vẫn là
--      sổ lịch sử theo nguồn (0009) và được HB-131 ghi song song trong cùng transaction.
--   2. `channel_mappings.allotment_pct` — phần trăm hạn mức theo BR-CHAN-01/BR-INV-05 (mặc định 80%),
--      cộng ràng buộc "một loại phòng, một mã OTA trong mỗi kênh" ở tầng CSDL.
--   3. `channel_sync_attempts` — sổ bền của từng lượt đồng bộ theo khoá idempotent (`data.key`) để phát
--      lại cùng lượt không tăng `consecutive_sync_failures` và không phát cảnh báo lần hai, đồng thời là
--      nguồn `history` của `GET /channels/{id}/sync-status`.
-- `operations.kind` chỉ cho phép REPORT_EXPORT nên phải mở thêm hai loại tác vụ của HB-131.

BEGIN;

ALTER TABLE channel_allotments
  ADD COLUMN manual_closed boolean NOT NULL DEFAULT false,
  ADD COLUMN auto_closed boolean NOT NULL DEFAULT false,
  ADD COLUMN closed_by uuid REFERENCES users(id) ON DELETE SET NULL;

-- Dòng đã đóng trước migration này không có nguồn tự động (HB-131 mới sinh nó) ⇒ là đóng thủ công.
UPDATE channel_allotments SET manual_closed = true WHERE is_closed;

-- Cờ thủ công phải đi cùng mốc đóng, cùng tinh thần `ck_channel_allotments_closed`.
ALTER TABLE channel_allotments ADD CONSTRAINT ck_channel_allotments_manual_closed CHECK (
  manual_closed = false OR closed_at IS NOT NULL
);

ALTER TABLE channel_mappings
  ADD COLUMN allotment_pct smallint NOT NULL DEFAULT 80
  CHECK (allotment_pct >= 1 AND allotment_pct <= 100);

-- BR-CHAN-08: một loại phòng chỉ có một mã phòng OTA trong một kênh, và ngược lại. Kiểm dữ liệu trước
-- khi dựng index duy nhất — migration không được lặng lẽ chọn một dòng thay vì báo lỗi.
DO $$
DECLARE
  v_dupes bigint;
BEGIN
  SELECT count(*) INTO v_dupes FROM (
    SELECT channel_id, room_type_id FROM channel_mappings
     GROUP BY channel_id, room_type_id HAVING count(*) > 1
  ) pairs;
  IF v_dupes > 0 THEN
    RAISE EXCEPTION 'HB-131: % (channel, room type) pair(s) have more than one mapping', v_dupes
      USING ERRCODE = '23505';
  END IF;
  SELECT count(*) INTO v_dupes FROM (
    SELECT channel_id, external_room_code FROM channel_mappings
     GROUP BY channel_id, external_room_code HAVING count(*) > 1
  ) pairs;
  IF v_dupes > 0 THEN
    RAISE EXCEPTION 'HB-131: % (channel, provider code) pair(s) are duplicated', v_dupes
      USING ERRCODE = '23505';
  END IF;
END $$;

CREATE UNIQUE INDEX uq_channel_mappings_room_type
  ON channel_mappings (channel_id, room_type_id);
CREATE UNIQUE INDEX uq_channel_mappings_external_code
  ON channel_mappings (channel_id, external_room_code);

-- Lượt đồng bộ bền theo (kênh, khoá lượt): phát lại cùng khoá là no-op, không đếm lỗi lần hai.
CREATE TABLE channel_sync_attempts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id   uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  attempt_key  text NOT NULL CHECK (length(btrim(attempt_key)) > 0),
  outcome      text NOT NULL CHECK (outcome IN ('SUCCESS','FAILURE')),
  error_code   text,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_channel_sync_attempts_key UNIQUE (channel_id, attempt_key)
);
CREATE INDEX idx_channel_sync_attempts_history
  ON channel_sync_attempts (channel_id, attempted_at DESC);

-- `operations` là bảng dùng chung §2.12: thêm loại tác vụ CHAN đã công bố ở HB-120.
ALTER TABLE operations DROP CONSTRAINT operations_kind_check;
ALTER TABLE operations ADD CONSTRAINT operations_kind_check CHECK (
  kind IN ('REPORT_EXPORT','CHANNEL_SYNC','CHANNEL_DELIVERY_RETRY')
);

-- Tác vụ CHAN không sinh tệp nên không có `result_ref`/`result_path`; giữ nguyên bất biến của tác vụ xuất
-- báo cáo (vẫn buộc đủ cặp đường dẫn + kết quả) thay vì nới lỏng cho mọi loại.
ALTER TABLE operations DROP CONSTRAINT ck_operations_succeeded;
ALTER TABLE operations ADD CONSTRAINT ck_operations_succeeded CHECK (
  status <> 'SUCCEEDED'
  OR (finished_at IS NOT NULL
      AND (kind <> 'REPORT_EXPORT'
           OR (result_ref IS NOT NULL AND result_path IS NOT NULL)))
);

COMMIT;
