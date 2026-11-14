-- HB-317 (TD-82): `properties.slug` — định danh URL công khai của cơ sở (`GET /public/properties`).
-- Trang ga `/stays/[slug]` của customer web khớp cơ sở theo slug thay vì chuỗi trong tên (đổi tên ở
-- back-office không còn làm trang ga mất giờ nhận/trả).
--
-- * Kebab-case chữ thường không dấu, duy nhất (`properties_slug_key`, `ck_properties_slug_format`).
-- * Dòng đã có được điền từ `code` (chữ thường, mọi ký tự khác chữ/số thành `-`); trùng thì thêm
--   8 ký tự md5 của `code`. Seed (HB-018) ghi slug thật: CS-01 `da-lat`, CS-02 `vung-tau`, CS-03 `phan-thiet`.
-- * Trigger `BEFORE INSERT` điền slug theo cùng quy tắc khi lệnh chèn không ghi slug, để các lệnh chèn
--   cũ (fixture kiểm thử, script) không phải sửa. Đổi `code` về sau không đổi slug.

BEGIN;

CREATE FUNCTION fn_property_slug_base(p_code text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(
    nullif(trim(both '-' FROM regexp_replace(lower(p_code), '[^a-z0-9]+', '-', 'g')), ''),
    'co-so-' || substr(md5(p_code), 1, 8)
  )
$$;

CREATE FUNCTION fn_property_slug_default() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_slug text;
BEGIN
  IF NEW.slug IS NULL THEN
    v_slug := fn_property_slug_base(NEW.code);
    IF EXISTS (SELECT 1 FROM properties WHERE slug = v_slug) THEN
      v_slug := v_slug || '-' || substr(md5(NEW.code), 1, 8);
    END IF;
    NEW.slug := v_slug;
  END IF;
  RETURN NEW;
END $$;

ALTER TABLE properties ADD COLUMN slug text;

UPDATE properties p
   SET slug = CASE WHEN s.rank = 1 THEN s.base ELSE s.base || '-' || substr(md5(p.code), 1, 8) END
  FROM (
    SELECT id, fn_property_slug_base(code) AS base,
           row_number() OVER (PARTITION BY fn_property_slug_base(code) ORDER BY code) AS rank
      FROM properties
  ) s
 WHERE s.id = p.id;

ALTER TABLE properties ALTER COLUMN slug SET NOT NULL;
ALTER TABLE properties ADD CONSTRAINT properties_slug_key UNIQUE (slug);
ALTER TABLE properties ADD CONSTRAINT ck_properties_slug_format
  CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

CREATE TRIGGER trg_properties_slug_default
  BEFORE INSERT ON properties
  FOR EACH ROW EXECUTE FUNCTION fn_property_slug_default();

-- TD-12: hàm mới không mở quyền EXECUTE cho PUBLIC; chỉ vai trò chạy trigger (app_rw) được giữ.
REVOKE ALL ON FUNCTION fn_property_slug_base(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_property_slug_default() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_property_slug_base(text) TO app_rw;
GRANT EXECUTE ON FUNCTION fn_property_slug_default() TO app_rw;

COMMIT;
