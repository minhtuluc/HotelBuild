---
id: HB-208
title: GET /guests/{guestId} — đọc hồ sơ khách theo id trong phạm vi
risk: R1
owner: deepseek
max_lines: 300
allow:
  - apps/api/src/modules/crm/guests/**
  - apps/api/test/crm/**
  - apps/api/test/rbac/registered-routes.spec.ts
---

# HB-208 — Đọc khách theo id

## Mục tiêu

Hiện thực `GET /guests/{guestId}` (hợp đồng HB-204) để màn có `guestId` (SCR-57, SCR-62) ghép được tên/cờ danh sách đen mà không phải tra `?q=`. Đóng TD-33.

## Căn cứ

- BR-CRM-01, BR-RBAC-02; UC-CRM-01; NFR-SEC-03 (không log PII)
- Hợp đồng: HB-204 AC2 (phải merge trước); mã tham chiếu `apps/api/src/modules/crm/guests/{controller,service,projection,permissions}.ts`

## Tiêu chí nghiệm thu (mỗi dòng ↔ một test)

1. Vai trò có `guests.read` đọc được khách trong phạm vi theo **đúng** luật phạm vi mà `GET /guests` đang áp — test `apps/api/test/crm/**`.
2. Khách không tồn tại hoặc ngoài phạm vi ⇒ 404 `E_GEN_NOT_FOUND` (không phân biệt hai trường hợp); HOUSEKEEPING ⇒ 403.
3. Khách đã ẩn danh hoá ⇒ trả bản đã ẩn danh (cùng projection danh sách).
4. Oracle tuyến mới trong `registered-routes.spec.ts`.

## Ngoài phạm vi

- Lịch sử lưu trú chi tiết, consumer Android (HB-210).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` (lead chạy) · vitest `test/crm test/rbac`

## Ghi chú cho người làm

Dùng lại projection của danh sách; không thêm trường ngoài `guestSummarySchema`.
