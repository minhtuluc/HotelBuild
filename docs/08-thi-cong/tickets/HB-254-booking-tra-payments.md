---
id: HB-254
title: "`GET /bookings/{id}` trả `payments` theo api.md §3.5 — mở khoá thanh toán cọc trực tuyến trên web và Android"
risk: R1
owner: claude
max_lines: 250
allow:
  - apps/api/src/modules/book/bookings/service.ts
  - apps/api/src/modules/pay/online/projection.ts
  - apps/api/test/bookings/payments-list.spec.ts
  - docs/08-thi-cong/tickets/HB-254-booking-tra-payments.md
unlock:
  - docs/08-thi-cong/tickets/HB-254-booking-tra-payments.md
---

# HB-254 — Booking trả danh sách giao dịch

> Đặc tả do Claude soạn ngày 19/11/2026 từ lần chạy máy thật (customer Android, booking PH-261119-00003).

## Vấn đề

- Màn **Thanh toán tiền cọc** của cả customer web lẫn Android luôn báo "Chưa đủ dữ liệu máy chủ để tạo thanh toán trực tuyến", kể cả khi máy chủ đã trả `onlineDepositAmount = 390.000`.
- Lý do: hai màn chỉ mở nút khi `BookingSummary.payments` có mặt (kể cả `[]`). Đó là bằng chứng chưa có giao dịch trực tuyến nào đang mở, để không tạo giao dịch thứ hai.
- api.md §3.5 yêu cầu "danh sách `BookingSummary.payments` (bao gồm `[]` khi chưa có giao dịch)", nhưng `GET /bookings/{id}` chưa bao giờ trả trường này.
- Hậu quả: không khách nào trả cọc trực tuyến được.

## Thay đổi

1. `GET /bookings/{id}` trả thêm `payments`: mọi giao dịch của booking, sắp theo `(created_at, id)` tăng dần. Quyền đọc giữ nguyên: khách lạ bị che 404, nhân viên theo phạm vi cơ sở.
2. `listedPayment` (`pay/online/projection.ts`) chiếu một dòng:
   - `paymentUrl` luôn `null`, vì URL cổng chỉ cấp một lần và không lưu.
   - `expiresAt` = `created_at + 15 phút` với VNPay/MoMo (BR-PAY-05); `null` với giao dịch tại quầy.
   - Dòng `REFUND` lưu số âm (`ck_payments_sign`) nên trả độ lớn dương.
3. `GET /bookings` (danh sách) giữ nguyên, không thêm truy vấn theo từng dòng.

## Tiêu chí nghiệm thu

1. Booking chưa có giao dịch trả `payments: []`. Có giao dịch thì liệt kê đúng thứ tự và đúng chiếu. Dòng hoàn trả số dương. Khách lạ vẫn 404. Test: `apps/api/test/bookings/payments-list.spec.ts` (đỏ khi bỏ thay đổi ở service, xanh khi có).
2. `test/bookings/reads.spec.ts` vẫn xanh; `check:openapi` và `check:contract` không có thay đổi phá vỡ.
3. Máy thật (customer Android, PH-261119-00003):
   - Màn thanh toán mở nút VNPay/MoMo.
   - Xem lại rồi xác nhận: `POST /payments/online` tạo giao dịch PENDING và mở cổng VNPay sandbox.
   - Gửi callback VNPay có chữ ký bằng merchant dev cục bộ: giao dịch thành SUCCEEDED.
   - App hiện "Đã nhận tiền", đã thu 390.000 ₫, còn nợ 910.000 ₫.

## Ngoài phạm vi

- **Trang VNPay sandbox báo "Không tìm thấy website"**: môi trường dev chưa có mã merchant sandbox thật (`VNPAY_TMN_CODE`/`VNPAY_HASH_SECRET`). Đây là cấu hình tài khoản, không phải lỗi mã.
- **Booking không tự chuyển CONFIRMED sau khi đủ cọc trực tuyến**. UC-PAY-02 bước 9 yêu cầu chuyển cùng transaction ghi thu, nhưng `pay/webhooks/apply.ts` để việc đó cho use case riêng chỉ nhân viên gọi. Booking đã trả cọc vẫn có thể hết hạn giữ. Ticket riêng (R2).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci`
