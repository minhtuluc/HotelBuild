---
id: HB-240
title: 'Sửa/ngừng khuyến mãi — `PUT /promotions/{promotionId}` (TD-08)'
risk: R1
owner: claude
max_lines: 650
allow:
  - packages/contracts/src/rate.ts
  - packages/contracts/src/openapi/paths/f3.ts
  - packages/contracts/openapi.json
  - packages/contracts/test/openapi.spec.ts
  - packages/api-client/src/rate.ts
  - packages/api-client/test/f3-endpoints.spec.ts
  - apps/api/src/modules/rate/promotions/**
  - apps/api/src/modules/rate/rate-plans/support.ts
  - apps/api/test/rate/calendar/promotion-update.spec.ts
  - apps/api/test/rbac/routes/f3-rate.ts
  - apps/api/test/rbac/registered-routes.spec.ts
  - docs/04-thiet-ke/api.md
  - docs/07-ban-giao/no-ky-thuat.md
  - docs/08-thi-cong/tickets/HB-240-sua-ngung-khuyen-mai.md
---

# HB-240 — Sửa/ngừng khuyến mãi (TD-08)

## Vấn đề

HB-236 đã đưa `GET`/`POST /promotions` lên API thật. Nhưng một mã đang chạy thì **không có cách nào** tắt sớm, gia hạn hay giảm lượt dùng. Muốn dừng một khuyến mãi lỗi chỉ còn cách sửa thẳng trong CSDL.

## Thay đổi

- **Hợp đồng `promotionUpdateRequestSchema`.**
  - Mọi trường đều tùy chọn, `reason` bắt buộc, phải có ít nhất một trường cần sửa.
  - `code` và `type` không sửa được: khách và báo giá cũ tham chiếu theo mã.
- **`PUT /promotions/{promotionId}`.**
  - Chỉ OWNER; trả 204.
  - Có `Idempotency-Key`. `If-Match` bắt buộc: thiếu thì 428, lệch phiên bản thì 412. Cách làm giống gói giá.
- **Xử lý trong service.**
  - Khoá dòng (`FOR UPDATE`), gộp thay đổi vào bản đang lưu, rồi chạy lại **toàn bộ** luật của lệnh tạo trên bản gộp.
  - Thêm luật `maxUses ≥ usedCount` (lỗi `BELOW_USED`).
  - Ghi audit `PROMOTION_UPDATED`, `PROMOTION_INACTIVE` hoặc `PROMOTION_ACTIVE` kèm lý do đã che PII; phát outbox `RateChanged`.
- **Ngừng khuyến mãi = `status: INACTIVE`.** Loader giá vốn chỉ nạp mã `ACTIVE`, nên báo giá mới không còn giảm. Mã vẫn nằm trong danh mục nên báo giá không trả lỗi (giữ đúng thiết kế HB-199).
- **`api-client.updatePromotion`** cho SCR-29.

## Tiêu chí nghiệm thu (`apps/api/test/rate/calendar/promotion-update.spec.ts`)

1. `HB240_owner_deactivates_promotion_quote_engine_stops_applying_it`: sau khi ngừng, báo giá có mã đó trả đúng tổng giá gốc. Có audit và outbox.
2. `HB240_partial_update_rechecks_rules_on_merged_promotion`: sửa một phần được lưu đúng. Vi phạm trên bản gộp trả 422 kèm chi tiết, dữ liệu không đổi.
3. `HB240_max_uses_cannot_drop_below_used_count`: lỗi `BELOW_USED`; gửi `null` thì bỏ giới hạn.
4. `HB240_version_role_and_body_guards`: 428, 412, 400 (khi gửi `code`/`type` hoặc thân rỗng), 404, 403 (MANAGER).
5. Oracle RBAC: `PUT promotions/:promotionId` chỉ OWNER.

Trên code cũ cả bốn test đều đỏ vì tuyến chưa tồn tại.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · integration `apps/api/test/rate`, `apps/api/test/rbac`.
