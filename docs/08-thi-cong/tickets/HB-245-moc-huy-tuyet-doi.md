---
id: HB-245
title: 'Mốc huỷ tuyệt đối trong báo giá và booking (yêu cầu frontend #7)'
risk: R1
owner: claude
max_lines: 600
allow:
  - packages/domain/src/cancellation/policy.ts
  - packages/domain/src/cancellation/index.ts
  - packages/domain/test/cancellation/deadlines.spec.ts
  - packages/contracts/src/cancellation-policy.ts
  - packages/contracts/src/quote.ts
  - packages/contracts/src/booking.ts
  - packages/contracts/openapi.json
  - apps/api/src/modules/book/bookings/refund-deadlines.ts
  - apps/api/src/modules/book/bookings/projection.ts
  - apps/api/src/modules/book/cancel/service.ts
  - apps/api/src/modules/rate/quotes/service.ts
  - apps/api/test/huy-booking/deadlines.spec.ts
  - apps/api/test/quotes/deadlines.spec.ts
  - docs/04-thiet-ke/api.md
  - YEU-CAU-API-TU-FRONTEND.md
  - docs/08-thi-cong/tickets/HB-245-moc-huy-tuyet-doi.md
---

# HB-245 — Mốc huỷ tuyệt đối trong báo giá và booking

## Nguồn

`YEU-CAU-API-TU-FRONTEND.md` mục 7 (góp ý FEAT-04): khách hiểu nhầm "7 ngày trước" là ngày lịch; frontend không được tự quy đổi chính sách huỷ.

## Thay đổi (chỉ thêm, không phá hợp đồng)

1. **Domain.** `refundDeadlines(policy, checkInMs)` trong `@pinehill/domain/cancellation`: quy bậc `offsetHours` ra mốc tuyệt đối, kiểm cấu hình bằng chính `resolveTier`. Property test: tại mốc → đúng bậc; mốc + 1 ms → bậc kế.
2. **Hợp đồng.** `refundDeadlineSchema { until: ISO UTC | null, refundPercent, chargeFirstNight }`; `refundDeadlines?` trong `quoteSchema` và `bookingSummarySchema`.
3. **Booking.** Projection đọc snapshot mới nhất (cùng bản lệnh huỷ đọc) và quy giờ nhận phòng bằng `nominalCheckInMs` của lệnh huỷ. Chỉ trả khi `HELD`/`PENDING_PAYMENT`/`CONFIRMED`, không phải OTA có mã chính sách kênh (BR-CHAN-04). Snapshot hỏng ⇒ vắng trường, đọc không hỏng.
4. **Báo giá.** Chính sách hiện hành của gói + giờ nhận phòng của cơ sở (hai nguồn `POST /bookings` chụp). Kênh OTA hoặc chính sách không chốt được ⇒ vắng trường, báo giá vẫn 201.
5. Danh sách mã kênh OTA dùng chung (`OTA_CHANNEL_CODES`) thay cho hằng riêng trong lệnh huỷ.

## Tiêu chí nghiệm thu

- `HB245_booking_deadlines_match_cancel_engine_boundaries`: mốc đúng giờ VN, có trong cả chi tiết lẫn danh sách; xem trước huỷ tại mốc 72h ra 50%, trễ 1 ms ra 0%.
- `HB245_no_deadlines_for_ota_contract_or_closed_bookings`.
- `HB245_quote_returns_absolute_deadlines_from_current_policy`, `HB245_quote_without_resolvable_policy_still_succeeds_without_deadlines`.
- `pnpm check:contract` 0 thay đổi phá vỡ; `pnpm run ci` xanh.
