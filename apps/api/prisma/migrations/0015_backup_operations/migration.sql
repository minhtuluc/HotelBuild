-- HB-246 (phần API của HB-179): `POST /system/backups` và `POST /system/backups/{backupId}/restore`.
-- API chỉ **ghi yêu cầu** vào `operations`; sidecar `backup` (đã có quyền pgBackRest, socket CSDL) nhận
-- việc, chạy rồi chốt kết quả. API không bao giờ chạy lệnh hệ thống hay nhận đường dẫn/URL CSDL (§2.14).
BEGIN;

-- Giữ nguyên các loại CHAN của 0010, thêm hai loại sao lưu.
ALTER TABLE operations DROP CONSTRAINT operations_kind_check;
ALTER TABLE operations ADD CONSTRAINT operations_kind_check CHECK (
  kind IN ('REPORT_EXPORT','CHANNEL_SYNC','CHANNEL_DELIVERY_RETRY','BACKUP','RESTORE_DRILL')
);

-- Bất biến của 0010 giữ nguyên; thêm: sao lưu/diễn tập chỉ được SUCCEEDED khi có `result_json` (biên bản).
ALTER TABLE operations DROP CONSTRAINT ck_operations_succeeded;
ALTER TABLE operations ADD CONSTRAINT ck_operations_succeeded CHECK (
  status <> 'SUCCEEDED'
  OR (finished_at IS NOT NULL
      AND (kind <> 'REPORT_EXPORT'
           OR (result_ref IS NOT NULL AND result_path IS NOT NULL))
      AND (kind NOT IN ('BACKUP','RESTORE_DRILL') OR result_json IS NOT NULL))
);

-- Mỗi lúc chỉ một sao lưu **hoặc** diễn tập đang chờ/chạy: hai việc nặng cùng lúc làm chậm production và
-- diễn tập dùng chung volume tạm. Chỉ mục là hàng rào cuối nếu hai lệnh lọt qua kiểm tra của API.
CREATE UNIQUE INDEX uq_operations_backup_active ON operations ((true))
  WHERE kind IN ('BACKUP','RESTORE_DRILL') AND status IN ('PENDING','RUNNING');

-- Ảnh chụp `pgbackrest info --output=json` do sidecar ghi định kỳ (một dòng). API chỉ đọc để hiện danh sách
-- bản sao lưu và kiểm `backupId`; `app_rw` không được ghi (REVOKE dưới) để API không tự "tạo" bản sao lưu.
CREATE TABLE backup_catalog (
  id           smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  info_json    jsonb NOT NULL CHECK (jsonb_typeof(info_json) = 'array'),
  refreshed_at timestamptz NOT NULL DEFAULT now()
);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON backup_catalog FROM app_rw;

COMMIT;
