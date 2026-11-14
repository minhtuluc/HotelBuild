---
id: HB-319
title: TD-82 — `GET /public/properties` trả `slug` của cơ sở (không phá vỡ), seed da-lat/phan-thiet/vung-tau
risk: R1
owner: claude
max_lines: 400
allow:
  - packages/contracts/src/property.ts
  - packages/contracts/openapi.json
  - apps/api/prisma/migrations/0013_property_slug/**
  - apps/api/prisma/schema.prisma
  - apps/api/prisma/seed/**
  - apps/api/src/modules/prop/property-admin/projection.ts
  - apps/api/test/prop/**
  - apps/customer-web/test/content/content-pages.spec.ts
  - tests/e2e/fake-api/journey/fixtures.ts
  - tests/e2e/scr01-tim-phong.spec.ts
  - tests/e2e/scr80-trang-noi-dung.spec.ts
  - docs/04-thiet-ke/api.md
  - docs/04-thiet-ke/csdl.md
  - docs/07-ban-giao/no-ky-thuat.md
  - YEU-CAU-API-TU-FRONTEND.md
  - docs/08-thi-cong/tickets/HB-319-slug-co-so-cong-khai.md
unlock:
  - docs/08-thi-cong/tickets/HB-319-slug-co-so-cong-khai.md
---

# HB-319 — TD-82: slug cơ sở trong API công khai

> Đặc tả do frontend lead tự soạn theo TD-82 ([sổ nợ kỹ thuật](../../07-ban-giao/no-ky-thuat.md)) và mục 6 của [yêu cầu API từ frontend](../../../YEU-CAU-API-TU-FRONTEND.md). Chặn HB-311 (nhân trang ga).

## Vấn đề

`PropertyPublicSummary` chỉ có `id`, `name`, giờ nhận/trả. Trang ga `/stays/[slug]` và khối tìm phòng `/?ga=` (HB-310) khớp cơ sở bằng chuỗi có trong tên (`apiNameIncludes`). Đổi tên cơ sở ở back-office thì trang ga mất giờ nhận/trả và CTA không chọn sẵn ga.

## Thay đổi

1. **CSDL** (migration `0013_property_slug`):
   - Cột `properties.slug text NOT NULL`, ràng buộc duy nhất `properties_slug_key`.
   - CHECK kebab-case: `^[a-z0-9]+(-[a-z0-9]+)*$`.
   - Dòng cũ được điền từ `code` (chữ thường, ký tự khác chữ/số thành `-`). Trigger `BEFORE INSERT` điền slug theo cùng quy tắc khi lệnh chèn không ghi slug (fixture/test cũ không phải sửa).
2. **Seed:** CS-01 `da-lat`, CS-02 `vung-tau`, CS-03 `phan-thiet`; chạy lại seed cập nhật slug.
3. **Hợp đồng:** thêm `slug` (bắt buộc trong phản hồi) vào `propertyPublicSummarySchema`; `openapi.json` sinh lại. Chỉ thêm trường phản hồi nên `check:contract` 0 phá vỡ.
4. **API:** `GET /public/properties` trả `slug`. `GET /properties` (nội bộ) không đổi.
5. **Dữ liệu kiểm thử:** fake API journey và hai spec E2E giả lập `/public/properties` trả `slug`; unit customer-web có mock cơ sở công khai thêm `slug`.

## Tiêu chí nghiệm thu

1. `apps/api/test/prop/reads.spec.ts`: phản hồi công khai có đúng khoá `id, name, slug, checkInTime, checkOutTime`; slug seed là `da-lat`, `phan-thiet`, `vung-tau`.
2. `pnpm check:openapi` không lệch; `pnpm check:contract` 0 phá vỡ.
3. Typecheck, lint, unit contracts/api/customer-web đạt; E2E SCR-01, SCR-80 đạt.
4. Chạy thật: migrate + seed + gọi `GET /api/v1/public/properties` (không dựng được hạ tầng thì ghi `BLOCKED` kèm lý do).

## Ngoài phạm vi

- Frontend bỏ `apiNameIncludes` và khớp theo `slug` (`apps/customer-web/src/content/property-pages.ts`, `station-timetable.tsx`, `/?ga=`): làm sau, khi chuỗi PR customer web (#308 → #311) đã rebase lên main để không xung đột. TD-82 ghi "Một phần".
- Sửa slug qua `PATCH /properties/{id}`: slug là định danh URL ổn định, chưa có nhu cầu đổi.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:integration` (CI) · `pnpm test:e2e` (SCR-01, SCR-80)
