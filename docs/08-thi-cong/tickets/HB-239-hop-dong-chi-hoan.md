---
id: HB-239
title: 'Hợp đồng `POST /refund-requests/{id}/pay`: 202 `RefundPayoutView` (TD-64)'
risk: R1
owner: claude
max_lines: 450
allow:
  - packages/contracts/src/openapi/paths/f5.ts
  - packages/contracts/openapi.json
  - packages/api-client/src/payment.ts
  - packages/api-client/test/f5-endpoints.spec.ts
  - apps/api/test/chi-hoan/payouts.spec.ts
  - tests/e2e/fake-api/f5/refunds.ts
  - tests/e2e/fake-api/f5/refund-facts.ts
  - tests/e2e/scr38-duyet-hoan-ops.spec.ts
  - packages/web-session/test/f5-refunds.spec.ts
  - packages/web-session/test/f5-refund-evidence.spec.ts
  - docs/04-thiet-ke/api.md
  - docs/07-ban-giao/no-ky-thuat.md
  - docs/08-thi-cong/tickets/HB-239-hop-dong-chi-hoan.md
---

# HB-239 — Hợp đồng chi hoàn (TD-64)

## Vấn đề

TD-64 ghi rằng phản hồi `202` của `POST /refund-requests/{id}/pay` "chưa có zod schema". Thực tế schema `refundPayoutViewSchema` đã có trong `packages/contracts` (HB-215), nhưng ba nơi khác vẫn lệch với API thật:

1. OpenAPI khai `200` + `RefundRequest`, trong khi controller trả `202` + `RefundPayoutView`.
2. `api-client` giải mã `pay` bằng `refundRequestSchema`. Với phản hồi thật, client ném lỗi `protocol` "Phản hồi không khớp hợp đồng". Hệ quả: kế toán bấm chi hoàn trên SCR-38, leg chi **đã ghi**, nhưng màn báo lỗi hoặc kết quả chưa rõ.
3. API giả của e2e trả `200` + `RefundRequest`, khác API thật, nên e2e không bắt được lỗi.

## Thay đổi

- OpenAPI: `202` + `refundPayoutViewSchema`. Sinh lại `openapi.json`; `check:contract` báo 0 thay đổi phá vỡ.
- `api-client.pay` trả `ApiResponse<RefundPayoutView>`. SCR-38 vốn đã nhánh `isRefundPayoutView` để đọc lại hồ sơ, nên không phải sửa UI.
- API giả: `/pay` trả `202` + `RefundPayoutView`. E2E SCR-38 đổi kỳ vọng mã thành `202`.
- Test API thật: phản hồi `/pay` phải qua được `refundPayoutViewSchema` của contracts.

## Tiêu chí nghiệm thu

1. `packages/api-client/test/f5-endpoints.spec.ts`: `pay` nhận `202` + payout view và giải mã được. Trên code cũ test này **đỏ** với lỗi "Phản hồi không khớp hợp đồng".
2. `apps/api/test/chi-hoan/payouts.spec.ts`: phản hồi thật khớp `refundPayoutViewSchema`.
3. E2E `scr38-duyet-hoan-ops.spec.ts` xanh trên Chromium.
4. `packages/web-session` (`f5-refunds`, `f5-refund-evidence`) nhận `202` + payout view, rồi đọc lại hồ sơ để kiểm `PAID` và số tiền (đúng cách SCR-38 làm).

## Còn lại

Chuỗi quyết toán bị chép giữa worker và API. Phần này để lại cho đợt tách gói dùng chung (TD-31).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · integration `apps/api/test/chi-hoan`.
