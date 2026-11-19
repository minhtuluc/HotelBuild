---
id: HB-258
title: Khách tự đổi ngày booking của mình (api.md §2.5) và mọi client gửi neo `If-Match` khi đổi ngày
risk: R2
owner: claude
max_lines: 450
allow:
  - apps/api/src/modules/book/reschedule/**
  - apps/api/src/modules/book/cancel/caller.ts
  - apps/api/test/doi-ngay/**
  - apps/api/test/rbac/routes/f4-booking.ts
  - packages/api-client/src/booking.ts
  - packages/api-client/test/f5-endpoints.spec.ts
  - packages/web-session/test/f5-bookings.spec.ts
  - apps/customer-android/src/reschedule.ts
  - apps/customer-android/src/booking-actions-api.ts
  - apps/customer-android/app/booking/[code]/reschedule.tsx
  - apps/customer-android/test/reschedule.spec.ts
  - apps/operations-web/src/app/(ops)/bookings/[bookingId]/reschedule/reschedule-screen.tsx
  - docs/08-thi-cong/tickets/HB-258-khach-doi-ngay.md
unlock:
  - docs/08-thi-cong/tickets/HB-258-khach-doi-ngay.md
---

# HB-258 — Khách tự đổi ngày

> Đặc tả do Claude soạn ngày 19/11/2026 từ lần chạy máy thật (customer Android). **Xếp chồng trên HB-256 (#343) và HB-257 (#342)**: dùng lại `cancelCaller` và cùng chỉnh `api-client`.

## Vấn đề

1. `POST /bookings/{id}/reschedule` chỉ nhận phiên nhân viên, trong khi api.md §2.5 cho `GUEST` (UC-BOOK-06). App khách vì thế nhận `403`. Đây là cùng khoảng trống "chờ HB-017" như phần huỷ.
2. Lệnh đổi ngày **bắt buộc** `If-Match` = `version` booking (HB-098), nhưng `api-client.reschedule` không gửi. App khách Android và ops web đều nhận `428`.

## Thay đổi

1. API:
   - Tuyến đổi ngày thành `@Public`; chủ thể lấy qua `cancelCaller` (thêm quyền `bookings.reschedule`).
   - Khách chỉ đổi được booking của mình, khác chủ thì che 404. Báo giá kỳ mới phải của chính khách (`principal` GUEST).
   - Audit và sổ ghi `actor_role = GUEST`, `actor_id = null`.
   - Xoá cứng (`DELETE /bookings/{id}`) giữ nguyên là tuyến nhân viên.
   - Nhân viên dùng mật khẩu tạm bị chặn như guard, nhờ `bookingCaller` của HB-256.
2. `api-client`: `reschedule(bookingId, input, ifMatch)`. Android truyền `"<version>"` của booking đang xem; ops web cũng vậy.
3. Bảng đối chiếu RBAC bỏ tuyến đổi ngày (giờ là `@Public`). Bất biến khai quyền vẫn chỉ gồm vai trò nhân viên.

## Tiêu chí nghiệm thu

1. `apps/api/test/doi-ngay/guest.spec.ts`:
   - Chủ booking đổi ngày được, audit vai trò GUEST.
   - Khách khác bị 404; khách xoá cứng bị 403.
   - Nhân viên dùng mật khẩu tạm bị 403.
   - Hai ca đầu đỏ trước khi sửa.
2. Vẫn xanh: `test/doi-ngay` (guards, contract, reschedule, hard-delete), `test/rbac`, `test/huy-booking`.
3. `apps/customer-android/test/reschedule.spec.ts` (gửi `If-Match` = `"7"`) và `api-client` (header `if-match`) xanh; ops web typecheck và test xanh.
4. Máy thật (cùng HB-259): khách đổi PH-261119-00006 từ 10–12/01 sang 17–19/01/2027; booking vẫn `CONFIRMED`, `rescheduleCount = 1`.

## Ngoài phạm vi

- Customer web (`apps/customer-web/.../bookings/api.ts`) cũng chưa gửi `If-Match` khi đổi ngày. Đó là phạm vi của phiên frontend.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci`
