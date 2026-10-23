---
id: HB-207
title: Ghi nhận kiểm phòng — POST /housekeeping/tasks cho phòng chưa có nhiệm vụ của lượt
risk: R2
owner: codex
max_lines: 500
allow:
  - apps/api/src/modules/fo/housekeeping/**
  - apps/api/test/uc-buong-phong/**
  - apps/api/test/rbac/registered-routes.spec.ts
---

# HB-207 — Ghi nhận kiểm phòng

## Mục tiêu

Hiện thực `POST /housekeeping/tasks` (hợp đồng HB-204) để FRONT_DESK/MANAGER tạo nhiệm vụ dọn hoặc ghi nhận **đã kiểm** (`INSPECTED`) cho phòng chưa có bằng chứng sẵn sàng của lượt giải phóng hiện tại, theo BR-FO-07. Gỡ F7-QA-01: lần giao đầu tiên của mọi phòng mới luôn 409 vì không có đường tạo nhiệm vụ.

## Căn cứ

- BR-FO-06, BR-FO-07, BR-RBAC-02; UC-FO-03; TC-FO-05
- Hợp đồng: HB-204 AC1 (phải merge trước)
- Mã tham chiếu: `apps/api/src/modules/fo/housekeeping/**` (PATCH, `transitions.ts`, `etag-interceptor.ts`), `apps/api/src/modules/fo/check-out/tasks.ts` (tạo task sau trả phòng)

## Tiêu chí nghiệm thu (mỗi dòng ↔ một test)

1. FRONT_DESK/MANAGER trong phạm vi cơ sở tạo được task `PENDING` hoặc `INSPECTED` (kèm `reason`); `201` trả đúng `housekeepingTaskSchema`, có `ETag` như PATCH — test `apps/api/test/uc-buong-phong/**`.
2. HOUSEKEEPING, vai trò khác, phòng ngoài phạm vi ⇒ 403/404 theo đúng mẫu PATCH hiện có; phòng không `ACTIVE` ⇒ từ chối.
3. Đã có nhiệm vụ **mở** (`PENDING`/`IN_PROGRESS`) cho cùng `(roomId, businessDate)` ⇒ 409 mã do HB-204 chốt; đồng thời hai lệnh tạo ⇒ đúng một thành công.
4. Audit + đổi dữ liệu cùng transaction; `Idempotency-Key` replay trả cùng task.
5. Đầu-cuối: phòng mới chưa có task ⇒ tạo `INSPECTED` ⇒ check-in phòng đó cùng ngày không còn 409 `UNITS_NOT_READY`.
6. Thêm dòng oracle cho tuyến mới ở `apps/api/test/rbac/registered-routes.spec.ts`.

## Ngoài phạm vi

- UI tạo/kiểm phòng (ghi TD nếu cần màn). Không tự tạo task hàng loạt cho phòng cũ.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` (lead chạy) · vitest `test/uc-buong-phong test/rbac test/uc-check-in` · **review độc lập Opus trước merge**

## Ghi chú cho người làm

Route mới thuộc module housekeeping hiện có — không cần sửa `app.module.ts`; nếu buộc phải sửa thì khai trong PR. Rebase sau HB-208/HB-209 nếu cùng chạm `registered-routes.spec.ts`.
