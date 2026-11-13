---
id: HB-244
title: 'Ảnh công khai của cơ sở và loại phòng — bảng ảnh, tuyến công khai, thay ảnh có ETag'
risk: R1
owner: claude
max_lines: 950
allow:
  - apps/api/prisma/migrations/0013_public_photos/**
  - apps/api/prisma/schema.prisma
  - apps/api/prisma/seed/photos.ts
  - apps/api/prisma/seed/index.ts
  - apps/api/src/modules/prop/photos/**
  - apps/api/src/modules/prop/property-admin/reads.ts
  - apps/api/src/modules/prop/property-admin/projection.ts
  - apps/api/src/modules/inv/availability/service.ts
  - apps/api/src/app.module.ts
  - apps/api/test/prop/photos.spec.ts
  - apps/api/test/rbac/routes/f2-property.ts
  - apps/api/test/availability/availability-http.spec.ts
  - apps/api/test/prop/reads.spec.ts
  - packages/contracts/src/property.ts
  - packages/contracts/src/inventory.ts
  - packages/contracts/src/openapi/paths/photos.ts
  - packages/contracts/src/openapi/registry.ts
  - packages/contracts/openapi.json
  - packages/contracts/test/openapi.spec.ts
  - packages/api-client/src/photos.ts
  - packages/api-client/src/index.ts
  - packages/api-client/test/photos.spec.ts
  - docs/04-thiet-ke/csdl.md
  - docs/04-thiet-ke/api.md
  - YEU-CAU-API-TU-FRONTEND.md
  - docs/08-thi-cong/tickets/HB-244-anh-cong-khai.md
---

# HB-244 — Ảnh công khai (yêu cầu frontend #5)

> Xếp chồng trên HB-243 vì cùng sửa `openapi.json` và `YEU-CAU-API-TU-FRONTEND.md`. Merge HB-243 trước.

## Vấn đề

Hợp đồng công khai không có trường ảnh. Web khách đặt ảnh tĩnh theo mã ô nên gặp hai giới hạn:
- không phân biệt được cùng một hạng phòng ở hai cơ sở khác nhau;
- màn chi tiết phòng (SCR-03), vốn chỉ biết `roomTypeId`, không gắn được ảnh.

## Thay đổi

- **Migration `0013_public_photos`:** thêm hai bảng `property_photos` và `room_type_photos` (csdl §3.2.10).
  - Mỗi dòng bất biến; sửa ảnh nghĩa là thay cả danh sách. Không có `version`/`updated_at`.
  - CHECK cho URL: `https://…` hoặc `/images/…`, vì chưa có kho tệp (HB-138). Thêm CHECK cho `alt`, kích thước và tối đa 20 ảnh.
  - Quyền CRUD mặc định, vì thay danh sách cần DELETE.
- **Hợp đồng (chỉ thêm):**
  - `publicPhotoSchema`;
  - `photos?` trong `PropertyPublicSummary` và trong từng mục của `Availability`;
  - `roomTypePublicSchema`, `photoListSchema`, `photoReplaceRequestSchema`.
- **Tuyến mới:**
  - `GET /public/room-types/{id}`: công khai, chỉ trả loại phòng ACTIVE của cơ sở ACTIVE.
  - `GET`/`PUT /properties/{id}/photos` và `GET`/`PUT /room-types/{id}/photos`: MANAGER và OWNER được đọc, chỉ OWNER được thay.
  - Khi thay: `If-Match` là ETag SHA-256 của danh sách; khoá dòng cha `FOR UPDATE`; ghi audit kèm lý do.
- **`api-client`:** `createPhotoApi` với `list`, `replace`, `publicRoomType`.
- **Seed dev:** 15 ảnh minh hoạ trùng file tĩnh hiện có. Chỉ chèn cho cơ sở hoặc loại phòng chưa có ảnh, không chạy ở production.

## Tiêu chí nghiệm thu (`apps/api/test/prop/photos.spec.ts`)

1. `HB244_owner_replaces_property_and_room_type_photos_visible_on_public_reads`:
   - sau khi thay, ảnh hiện đúng thứ tự ở `GET /public/properties`, `GET /public/room-types/{id}` và mục availability;
   - cơ sở khác và loại phòng khác không bị lẫn ảnh;
   - có audit; mảng rỗng thì gỡ hết ảnh.
2. `HB244_etag_guards_validation_and_roles`:
   - thiếu `If-Match` trả 428; ETag sai hoặc cũ trả 412;
   - URL `http`, đường dẫn ngoài `/images`, `..`, `alt` rỗng, kích thước 0, trường lạ, quá 20 ảnh, thiếu `reason`: đều trả 400;
   - id lạ trả 404; MANAGER đọc được trong phạm vi, ngoài phạm vi 403, không được thay; FRONT_DESK trả 403.
3. `HB244_public_room_type_hides_inactive_types`: loại phòng INACTIVE trả 404; id sai định dạng trả 400.
4. Catalog sau migration khớp csdl §3 (test HB010); test quyền bảng (HB-238) vẫn xanh.
5. Hai test canh "chỉ trả trường công khai" (`availability-http.spec.ts`, `prop/reads.spec.ts`) cho phép thêm `photos`. Mọi trường nội bộ khác vẫn bị cấm như trước; cả hai test đều không bị khoá.
6. Lớp phòng thủ thứ hai: CHECK của CSDL cũng chặn `/images/../x`. Lỗi này do chính test phát hiện ở bản regex đầu.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm db:drift` · integration `apps/api/test/{prop,migration,rbac,availability,seed}`.
