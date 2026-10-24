---
id: HB-213
title: GET /refund-requests — danh sách hồ sơ hoàn cho SCR-38
risk: R1
owner: deepseek
max_lines: 400
allow:
  - apps/api/src/modules/pay/refunds/**
  - apps/api/test/duyet-hoan-tien/**
  - apps/api/test/rbac/registered-routes.spec.ts
  - packages/contracts/src/refund.ts
  - packages/contracts/openapi.json
  - packages/api-client/src/payment.ts
  - docs/04-thiet-ke/api.md
---

# HB-213 — `GET /refund-requests`

## Mục tiêu

SCR-38 trên **API thật** liệt kê được hồ sơ hoàn (trạng thái, số đã giữ/chi, tuổi hồ sơ, version, cờ ngưỡng) — đóng F5-QA-03 và mở khoá nghiệm thu thật HB-110.

## Căn cứ

- api.md §2.6 + §6.3; `refundListQuerySchema` (`packages/contracts/src/refund.ts:97`) **đã phát hành**; `createRefundApi().list()` (`packages/api-client/src/payment.ts:111`) **đã có**, decode `listResponseSchema(refundRequestSchema)`
- BR-CANCEL-16 (hạn mức/giữ chỗ), BR-RBAC-02/03 (phạm vi cơ sở)
- Tiêu thụ: `apps/operations-web/src/app/(ops)/bookings/[bookingId]/refunds/**`; bằng chứng `bang-chung-f5.md` §3 F5-QA-03

## Tiêu chí nghiệm thu (mỗi dòng ↔ một test)

1. `GET /refund-requests` nhận đúng `refundListQuerySchema` (lọc `status`, `bookingId`, `propertyId`, phân trang con trỏ) và trả `ListPage<RefundRequest>` **đúng** `refundRequestSchema` hiện hành — test `apps/api/test/duyet-hoan-tien/**`.
2. **Quyền (api.md §6.3)**: `FRONT_DESK`, `RESERVATION_AGENT`, `MANAGER`, `OWNER` (xem vận hành) và `ACCOUNTANT` (projection đối soát) — đều **lọc theo cơ sở**; `HOUSEKEEPING` và `SYSADMIN` ⇒ **403**. Không tự cấp quyền ghi vì được đọc.
3. Không lộ trường nhạy cảm: không số tài khoản thô, không `pinToken`, không ghi chú chưa che; đọc không ghi, `Cache-Control: no-store`.
4. Oracle RBAC thêm dòng cho tuyến mới trong `apps/api/test/rbac/registered-routes.spec.ts` — tệp **sát trần** `max-lines` (TD-49): dùng đúng một dòng `prettier-ignore` như HB-207/HB-209.
5. Sau merge: chạy lại phần SCR-38 của `tests/e2e/f5/` trên API thật để ghi nghiệm thu HB-110 (việc lead).

## Ngoài phạm vi

- `GET /refund-requests/{id}`: **không làm** — api-client không có phương thức này và SCR-38 đọc danh sách (QĐ-07 mục 4). Nếu sau này cần chi tiết, mở ticket riêng (chỉ-thêm hợp đồng).
- Xác nhận chuyển khoản tay (HB-215); sửa UI SCR-38 (đã dùng `refundListQuerySchema`).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm check:openapi` + `pnpm check:contract` (0 phá vỡ) · vitest `duyet-hoan-tien rbac`.

## Ghi chú cho người làm

Tuyến **đọc**: nếu hợp đồng đã đủ (schema + client + openapi đã có), PR này chỉ hiện thực controller/service + oracle RBAC; đổi hợp đồng là bất thường ⇒ nêu lý do trong PR. DTO trả về phải là `refundRequestSchema` **nguyên vẹn**, không thêm/bớt trường (UI đã decode bằng schema đó).
