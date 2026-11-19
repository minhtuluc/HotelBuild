---
id: HB-265
title: Chi tiết đơn trên app khách hiện danh sách giao dịch và chỉ mời thanh toán cọc khi booking còn chờ
risk: R1
owner: claude
max_lines: 250
allow:
  - apps/customer-android/src/orders.ts
  - apps/customer-android/src/strings.ts
  - apps/customer-android/app/booking/[code].tsx
  - apps/customer-android/test/orders.spec.ts
  - docs/08-thi-cong/tickets/HB-265-chi-tiet-don-giao-dich.md
unlock:
  - docs/08-thi-cong/tickets/HB-265-chi-tiet-don-giao-dich.md
---

# HB-265 — Giao dịch trên màn chi tiết đơn (SCR-80)

> Đặc tả do Claude soạn ngày 19/11/2026 từ máy thật (PH-261119-00006).

## Vấn đề

1. Màn chi tiết vẫn ghi "Danh sách khoản thanh toán: hợp đồng chưa có tuyến liệt kê", dù `GET /bookings/{id}` đã trả `payments` từ HB-254. Nguyên nhân: màn chi tiết chỉ đọc danh sách (`GET /bookings`), mà danh sách không có giao dịch.
2. Link "Thanh toán tiền cọc" hiện cả với booking đã xác nhận và đã trả đủ. Bấm vào thì màn thanh toán chỉ báo "chưa đủ dữ liệu", vì thanh toán cọc trực tuyến chỉ áp cho booking HELD/PENDING_PAYMENT (api.md §3.5).

## Thay đổi

1. `loadOrderDetail`: tìm theo mã trong danh sách, rồi đọc `GET /bookings/{id}` để có giao dịch. Đọc lỗi thì giữ bản trong danh sách, không chặn màn.
2. Khối "Các khoản thanh toán": mỗi dòng gồm loại, phương thức, số tiền, trạng thái (nhãn tiếng Việt). Bản offline không có giao dịch thì không hiện khối này.
3. `canPayDeposit`: chỉ hiện lối vào thanh toán cọc khi booking HELD/PENDING_PAYMENT.

## Tiêu chí nghiệm thu

1. `apps/customer-android/test/orders.spec.ts`: chi tiết có giao dịch; đọc chi tiết lỗi thì vẫn hiện bản trong danh sách; `canPayDeposit` (ca đầu đỏ trước khi sửa).
2. Máy thật, PH-261119-00006:
   - Hiện "Tiền cọc · VNPay · 660.000 ₫ — thành công" và "Số dư · Tiền mặt · 1.540.000 ₫ — thành công".
   - Booking đã xác nhận không còn link thanh toán cọc.

## Ngoài phạm vi

- Bảng giá theo đêm: API chưa có tuyến đọc snapshot giá cho khách (chỉ có ràng buộc cấm sửa).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci`
