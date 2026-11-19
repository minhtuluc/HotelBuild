---
id: HB-259
title: Booking trả mã gói công bố (`ratePlanCode`) — app khách Android báo giá được khi đổi ngày
risk: R1
owner: claude
max_lines: 200
allow:
  - packages/contracts/src/booking.ts
  - packages/contracts/openapi.json
  - apps/api/src/modules/book/bookings/projection.ts
  - apps/api/test/bookings/reads.spec.ts
  - apps/customer-android/src/reschedule.ts
  - apps/customer-android/test/reschedule.spec.ts
  - docs/08-thi-cong/tickets/HB-259-booking-ma-goi.md
unlock:
  - docs/08-thi-cong/tickets/HB-259-booking-ma-goi.md
---

# HB-259 — Mã gói trên booking

> Đặc tả do Claude soạn ngày 19/11/2026 từ lần chạy máy thật (customer Android, PH-261119-00005).

## Vấn đề

- Màn **Đổi ngày** báo "Gói giá của đơn không phải mã gói công bố — app không tự lấy giá" với **mọi** booking thật, nên khách không đổi ngày được.
- `POST /quotes` cần `ratePlanCode` (FLEX7…), nhưng `BookingSummary` chỉ có `ratePlanId`, là UUID.
- `GET /rate-plans` công khai trả mã mà không có id, nên app không có cách nào ghép hai bên.

## Thay đổi

1. Hợp đồng `bookingSummarySchema` thêm `ratePlanCode` optional (tương thích ngược; `check:contract` không có thay đổi phá vỡ). Sinh lại `openapi.json`.
2. API chiếu `rate_plans.code`, chỉ khi mã thuộc bốn gói công bố. Gói tự đặt mã khác thì bỏ trống trường, không làm hỏng phản hồi.
3. Android báo giá đổi ngày bằng `booking.ratePlanCode`, và vẫn rơi về cách cũ khi phản hồi thiếu trường này.

## Tiêu chí nghiệm thu

1. `GET /bookings/{id}` trả `ratePlanCode: 'FLEX7'`. Test: `apps/api/test/bookings/reads.spec.ts`
2. Booking có UUID gói kèm `ratePlanCode` thì báo giá dùng mã đó. Test: `apps/customer-android/test/reschedule.spec.ts` (đỏ trước khi sửa).
3. Máy thật: khách đổi ngày PH-261119-00005 (cùng HB-258).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci`
