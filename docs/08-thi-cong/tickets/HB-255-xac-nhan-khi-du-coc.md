---
id: HB-255
title: Thanh toán cọc trực tuyến đủ cọc thì booking tự `CONFIRMED` cùng transaction ghi thu (UC-PAY-02 bước 9)
risk: R2
owner: claude
max_lines: 300
allow:
  - apps/api/src/modules/pay/webhooks/apply.ts
  - apps/api/src/modules/pay/webhooks/README.md
  - apps/api/src/modules/book/bookings/writes.ts
  - apps/api/src/modules/book/bookings/service.ts
  - apps/api/src/modules/pay/counter/service.ts
  - apps/api/test/webhook-psp/webhook-psp.spec.ts
  - docs/08-thi-cong/tickets/HB-255-xac-nhan-khi-du-coc.md
unlock:
  - docs/08-thi-cong/tickets/HB-255-xac-nhan-khi-du-coc.md
---

# HB-255 — Xác nhận booking khi webhook ghi đủ cọc

> Đặc tả do Claude soạn ngày 19/11/2026 từ lần chạy máy thật (customer Android, PH-261119-00003).

## Vấn đề

- Khách trả cọc 390.000 ₫ qua VNPay. Callback hợp lệ, giao dịch `SUCCEEDED`, nhưng booking **vẫn `HELD`**.
- Không ai xác nhận thì job hết hạn (HB-078) chuyển booking sang `EXPIRED` khi hết 20 phút giữ chỗ. Khoản cọc khi đó thành tiền phải hoàn, dù khách đã trả đúng hạn.
- Đặc tả nói khác:
  - UC-PAY-02 bước 9: "Nếu đang chờ, hold còn hạn và tiền phòng đủ cọc → CONFIRMED cùng transaction ghi thu".
  - Hậu điều kiện UC-PAY-02 và mục tiêu UC-BOOK-01 cũng ghi như vậy.
- Mã lệch ở hai chỗ:
  - `pay/webhooks/apply.ts` ghi chú "việc xác nhận (BR-BOOK-09) vẫn là use case riêng".
  - `POST /bookings/{id}/confirm` chỉ dành cho nhân viên.
- Lệnh thu tại quầy (HB-096) thì đã tự xác nhận khi đủ cọc, nên hai đường thu tiền đang không nhất quán.

## Thay đổi

1. `apply.ts`, nhánh thu đúng hạn: sau khi phân bổ và đồng bộ sổ, nếu đủ ba điều kiện thì gọi writer `confirmBooking` của HB-077 trong **cùng transaction**. Ba điều kiện:
   - Booking `HELD`/`PENDING_PAYMENT`.
   - Hold còn hạn theo giờ CSDL.
   - Tổng `DEPOSIT + BALANCE SUCCEEDED` ≥ `deposit_amount`.
2. Writer ghi history `HELD → CONFIRMED` (actor null) và audit `BOOKING_CONFIRMED` với actor `SYSTEM`.
3. Booking không có hold (`holdMinutes = 0`) vẫn để nhân viên xác nhận, giống điều kiện của `POST /bookings/{id}/confirm`.
4. `BookingConfirmation` nhận `actor: ActorContext` thay cho `caller: BookingCaller`, vì webhook không có `users.id`. Hai nơi gọi cũ (xác nhận tay, thu tại quầy) truyền actor tương đương nên vết history và audit không đổi.
5. Tiền thu muộn (hold hết hiệu lực, booking kết thúc) giữ nguyên hành vi BR-PAY-11: không xác nhận, lập hoàn 100%.

## Tiêu chí nghiệm thu

1. Callback VNPay hợp lệ đủ cọc:
   - Booking `CONFIRMED`.
   - Có 1 dòng history `HELD → CONFIRMED` (actor null).
   - Audit `BOOKING_CONFIRMED` có `actor_role = SYSTEM` và `paymentId`.
   - 5 callback trùng vẫn chỉ cộng tiền một lần.
   - FAILED rồi SUCCEEDED thì xác nhận; decline muộn không hạ.
   - Test: `apps/api/test/webhook-psp/webhook-psp.spec.ts`. Bỏ thay đổi ở `apply.ts` thì 3 test đỏ.
2. Tiền vào hold hết hiệu lực vẫn giữ `HELD` và lập hoàn 100% (TN-5, không đổi).
3. Xác nhận tay và thu tại quầy vẫn xanh: `test/bookings/confirm.spec.ts`, `test/thu-tien-tai-quay`. Các bộ khác đi qua webhook cũng xanh: `psp-thanh-toan-truc-tuyen`, `huy-mot-phan`, `observability/trace-propagation`.

## Ngoài phạm vi

- Cấu hình merchant VNPay/MoMo sandbox thật cho môi trường dev.
- Thông báo xác nhận cho khách (UC-NOTI-01) sau khi tự xác nhận. Outbox của writer hiện có giữ nguyên.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci`
