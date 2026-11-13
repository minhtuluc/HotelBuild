-- HB-244: ảnh công khai của cơ sở và loại phòng (yêu cầu frontend #5). Trước đây hợp đồng công khai không có
-- trường ảnh; web khách đặt ảnh tĩnh theo mã ô nên không phân biệt được cùng hạng phòng ở hai cơ sở.
-- Hệ thống chưa có kho tệp (HB-138) ⇒ chỉ lưu **tham chiếu**: URL https tuyệt đối hoặc đường dẫn tĩnh
-- `/images/…` của web khách. Mỗi dòng là bất biến: sửa ảnh = thay cả danh sách (DELETE + INSERT trong một
-- transaction, `PUT …/photos`), nên không có `version`/`updated_at`; khoá lạc quan dùng ETag băm danh sách.
-- Quyền `app_rw`: CRUD mặc định (cần DELETE để thay danh sách) — `table-privileges.spec.ts` không cần ngoại lệ.
BEGIN;

CREATE TABLE property_photos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  position    smallint NOT NULL CHECK (position >= 0 AND position < 20),
  url         text NOT NULL CHECK (url ~ '^(https://[^[:space:]]+|/images/([A-Za-z0-9_-][A-Za-z0-9._-]*/)*[A-Za-z0-9_-][A-Za-z0-9._-]*)$' AND length(url) <= 2048),
  alt         text NOT NULL CHECK (length(btrim(alt)) BETWEEN 1 AND 300),
  width       integer NOT NULL CHECK (width BETWEEN 1 AND 10000),
  height      integer NOT NULL CHECK (height BETWEEN 1 AND 10000),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_property_photos_position UNIQUE (property_id, position)
);

CREATE TABLE room_type_photos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_type_id uuid NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
  position     smallint NOT NULL CHECK (position >= 0 AND position < 20),
  url          text NOT NULL CHECK (url ~ '^(https://[^[:space:]]+|/images/([A-Za-z0-9_-][A-Za-z0-9._-]*/)*[A-Za-z0-9_-][A-Za-z0-9._-]*)$' AND length(url) <= 2048),
  alt          text NOT NULL CHECK (length(btrim(alt)) BETWEEN 1 AND 300),
  width        integer NOT NULL CHECK (width BETWEEN 1 AND 10000),
  height       integer NOT NULL CHECK (height BETWEEN 1 AND 10000),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_room_type_photos_position UNIQUE (room_type_id, position)
);

COMMIT;
