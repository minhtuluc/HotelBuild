---
id: HB-253
title: App khách Android đặt phòng bằng một lệnh `POST /bookings` như web — hết booking "rỗng" do `POST /holds` tạo ra
risk: R1
owner: claude
max_lines: 450
allow:
  - apps/customer-android/app/booking/confirm.tsx
  - apps/customer-android/src/hold.ts
  - apps/customer-android/src/hold-api.ts
  - apps/customer-android/test/hold.spec.ts
  - docs/08-thi-cong/tickets/HB-253-dat-phong-mot-buoc.md
unlock:
  - docs/08-thi-cong/tickets/HB-253-dat-phong-mot-buoc.md
---

# HB-253 — Đặt phòng một bước trên app khách Android

> Đặc tả do Claude soạn ngày 19/11/2026 từ lần chạy máy thật (OnePlus PLQ110, ColorOS 16).

## Vấn đề (quan sát trên máy thật)

- Booking khách đặt qua app hôm 17/11 (PH-261117-00002) mở màn **Thanh toán tiền cọc** thì báo "Không đọc được trạng thái máy chủ".
- `GET /bookings/{id}/balance` trả 500. Bên trong, `BookingLedger.read` ném `LEDGER_CHARGES_INCOMPLETE`: booking có `total_amount` 2.640.000 nhưng **không có dòng `booking_charges` ROOM nào và không có `price_snapshots`**.

Nguyên nhân:

- Màn xác nhận gọi hai lệnh liên tiếp: `POST /holds` rồi `POST /bookings`, cùng một mã báo giá.
- `POST /holds` đã tự tạo một booking HELD theo api.md §3.4, nhưng nhánh đó không ghi snapshot giá hay nghĩa vụ phòng.
- `POST /bookings` sau đó không tạo được booking thứ hai. Khách chỉ còn lại booking từ hold, mọi thao tác tiền trên booking đó đều hỏng.
- Customer web chỉ gọi **một** lệnh `POST /bookings`. Lệnh này tự đặt `HELD` kèm `holdExpiresAt` theo kênh (BR-BOOK-07) và ghi đủ `price_snapshots` ORIGINAL + `booking_charges` ROOM.

## Thay đổi

1. `src/hold.ts`:
   - `placeBooking` xin báo giá trong phiên (giữ cách làm của HB-249), rồi gọi `POST /bookings` bằng mã báo giá đó.
   - Bỏ `startHold`, `finishBooking`, `holdRequestFor`; `HoldApi` chỉ còn `quote` và `book`.
2. Đếm ngược và khoá nút tiếp tục theo `BookingSummary.holdExpiresAt` của máy chủ. Booking không có hạn giữ (PENDING_PAYMENT) thì được tiếp tục ngay.
3. Màn xác nhận khoá nút gửi khi đã có booking, để không đặt lần hai.

## Tiêu chí nghiệm thu

1. Một lệnh `POST /bookings` bằng báo giá trong phiên; adapter không còn tuyến `POST /holds`. Test: `apps/customer-android/test/hold.spec.ts`
2. Đếm ngược và khoá theo `holdExpiresAt`; trường hợp `null`, offline, nghi trùng, lỗi máy chủ đều được kiểm cùng file.
3. Máy thật, booking PH-261119-00003:
   - Tạo bằng một lệnh, trạng thái HELD, đếm ngược 19 phút theo hạn máy chủ.
   - Sổ cái có 2 dòng ROOM 650.000 ₫.
   - Màn thanh toán đọc được số dư: tổng 1.300.000 ₫, cọc theo máy chủ 390.000 ₫.

## Ngoài phạm vi

- **Nút thanh toán vẫn bị khoá** ("Chưa đủ dữ liệu máy chủ…"), ở cả web lẫn Android. `GET /bookings/{id}` chưa trả `payments` (api.md §3.5 yêu cầu có, kể cả `[]`). Ticket backend riêng.
- `POST /holds` vẫn tạo booking không có snapshot/nghĩa vụ phòng. Booking cũ PH-261117-00002 trong DB dev vẫn hỏng. Sửa phía API ở ticket riêng.
- Ô ngày vẫn gõ `YYYY-MM-DD`.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci`
