---
id: HB-257
title: Lệnh huỷ booking gửi neo `If-Match` từ lần xem trước — hết `428` trên app khách Android và operations web
risk: R1
owner: claude
max_lines: 300
allow:
  - packages/api-client/src/booking.ts
  - packages/api-client/test/f5-endpoints.spec.ts
  - apps/customer-android/src/cancel.ts
  - apps/customer-android/src/booking-actions-api.ts
  - apps/customer-android/src/strings.ts
  - apps/customer-android/app/booking/[code]/cancel.tsx
  - apps/customer-android/test/cancel.spec.ts
  - apps/operations-web/src/app/(ops)/bookings/[bookingId]/cancel/cancel-screen.tsx
  - docs/08-thi-cong/tickets/HB-257-huy-gui-if-match.md
unlock:
  - docs/08-thi-cong/tickets/HB-257-huy-gui-if-match.md
---

# HB-257 — Lệnh huỷ gửi neo xem trước

> Đặc tả do Claude soạn ngày 19/11/2026 từ lần chạy máy thật (customer Android, PH-261119-00004).

## Vấn đề

- `POST /bookings/{id}/cancel` **bắt buộc** `If-Match` = `ETag` của `cancel-preview` cùng tập phòng (HB-097). Thiếu thì `428`, cũ thì `412`.
- `createBookingApi().cancel` của `@pinehill/api-client` không có tham số cho neo.
- App khách Android và màn huỷ của operations web đều gọi qua đó, nên mọi lệnh huỷ trả `E_GEN_PRECONDITION_REQUIRED`, kể cả khi khách đã xem trước. Test đơn vị không bắt được vì client giả không kiểm header.
- Kèm theo trên màn huỷ Android: dòng bậc hoàn in mã UUID nội bộ ("Bậc 2f3e…"), và kết quả in mã yêu cầu hoàn cùng trạng thái thô (`PENDING`).

## Thay đổi

1. `api-client`: `cancel(bookingId, input, ifMatch)`, gửi header `if-match` qua `spec.ifMatch` có sẵn của client. `cancelPreview` đã trả `etag` trong `ApiResponse`.
2. Customer Android:
   - `CancelApi.preview` trả `{ preview, tag }`.
   - `confirmCancel` đối chiếu lại một lần rồi gửi neo **của chính lần đối chiếu đó**, nên số liệu đổi sau lúc khách bấm thì máy chủ vẫn từ chối `412`.
   - Adapter báo lỗi nếu máy chủ không trả `ETag`.
3. Operations web: dùng `etag` của lần đối chiếu ngay trước khi huỷ.
4. Câu chữ Android:
   - Bậc hoàn hiện "Còn {giờ} giờ trước giờ nhận phòng · hoàn {%}".
   - Kết quả hiện "Yêu cầu hoàn tiền đang chờ cơ sở duyệt…", không còn UUID hay mã trạng thái.

## Tiêu chí nghiệm thu

1. `apps/customer-android/test/cancel.spec.ts`: lệnh huỷ gửi đúng ETag của lần xem trước mới nhất (đỏ trước khi sửa).
2. `packages/api-client/test/f5-endpoints.spec.ts`: header `if-match` đi kèm lệnh huỷ.
3. Operations web: typecheck, vitest và lint xanh.
4. Máy thật (cùng HB-256): khách huỷ PH-261119-00004.
   - Xem trước: "Còn 740,0 giờ… hoàn 100%".
   - Xác nhận huỷ: booking `CANCELLED`, giải phóng 1 phòng, yêu cầu hoàn 390.000 ₫ `GUEST`/`PENDING`.

## Ngoài phạm vi

- Customer web gọi `POST …/cancel` qua lớp API riêng (`apps/customer-web/src/app/(guest)/bookings/api.ts`) và cũng chưa gửi `If-Match`. Đó là phạm vi của phiên frontend; báo lại trong PR.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci`
