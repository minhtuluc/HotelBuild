---
id: HB-033
title: UC + endpoint cơ sở, loại phòng, phòng vật lý, phòng thông nhau (+ bổ sung hợp đồng sửa loại phòng, tạo/sửa phòng)
risk: R1
owner: deepseek
max_lines: 900
allow:
  - apps/api/src/modules/prop/**
  - apps/api/test/prop/**
  - packages/contracts/src/property.ts
  - packages/contracts/src/openapi/paths/f2.ts
  - packages/contracts/openapi.json
  - packages/contracts/test/**
  - packages/api-client/src/f2.ts
  - packages/api-client/test/**
---

# HB-033 — Cơ sở, loại phòng, phòng

## Mục tiêu

Backend thật cho SCR-19/20/21: đọc/sửa cơ sở, đọc/tạo/sửa loại phòng, đọc/tạo/sửa phòng vật lý, gán phòng thông nhau đối xứng. Có audit và quyền theo phạm vi cơ sở.

## Căn cứ

- api.md §2.2; FR-PROP-01…05; UC-PROP-01…03; BR-PROP-01, BR-PROP-03, BR-PROP-04, BR-PROP-05, BR-OVER-15, BR-GEN-07, BR-RBAC-02
- csdl §3 `properties`, `room_types`, `rooms` (`connecting_room_id`, `bed_count`); hợp đồng HB-030 (`property.ts`, `paths/f2.ts`)
- Phụ thuộc chung: HB-013 (guard xác thực), HB-014 (`@Permission` + `modules/<mod>/permissions.ts`), HB-009 (`AuditWriter`), HB-018 (seed cho test)

## Tiêu chí nghiệm thu

1. **Bổ sung hợp đồng (không phá vỡ, QĐ-04 mục 7):** `PATCH /api/v1/room-types/{roomTypeId}` (giá cơ bản, sàn, trần, sức chứa, `status`; If-Match; OWNER), `POST /api/v1/rooms` (MANAGER), `PATCH /api/v1/rooms/{roomId}` (`floor`, `status`, `note`; If-Match; MANAGER). `GET /room-types` do HB-037 thêm — dùng lại, không thêm lần hai. Cập nhật bảng api.md §2.2 cùng PR (được phép theo QĐ-04).
2. Use case + controller cho mọi endpoint PROP của F2; quyền theo bảng api.md; ngoài phạm vi cơ sở → `E_AUTH_OUT_OF_SCOPE`.
3. Validate: `minPrice ≤ basePrice ≤ maxPrice` → sai thì `E_RATE_CONFIGURATION_INVALID` (BR-PROP-04); mã phòng không trùng trong cơ sở (BR-PROP-01) → 409; phòng thông nhau phải cùng cơ sở, khác nhau, gán/gỡ **đối xứng trong một transaction** (BR-OVER-15).
4. Mọi lệnh ghi: If-Match/version (`updated_at`), audit cùng transaction với before/after.
5. Test tích hợp PG16 trên seed HB-018: mỗi tiêu chí trên ít nhất một ca dương + một ca âm; 3 cơ sở / 55 phòng đọc đúng.
6. `pnpm run ci` + `pnpm test:integration` xanh; `check:contract` 0 phá vỡ.

## Ngoài phạm vi

- Khoá phòng (HB-034), lưới tồn (HB-035), xoá cơ sở/loại phòng/phòng (không có trong hợp đồng; vô hiệu bằng `status`).

## Ghi chú

Ticket màn hình HB-037 (SCR-19/20) và HB-038 (SCR-21) dùng các endpoint ở mục 1 — ai merge sau thì rebase và sinh lại `openapi.json`.
