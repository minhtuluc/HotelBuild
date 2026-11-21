---
id: HB-268
title: Lễ tân lập được điều chuyển từ cảnh báo quá tải — máy chủ tự lấy phòng duy nhất khi thiếu `bookingRoomId`
risk: R1
owner: claude
max_lines: 200
allow:
  - packages/contracts/src/overbooking-move.ts
  - packages/contracts/openapi.json
  - apps/api/src/modules/over/moves/validation.ts
  - apps/api/src/modules/over/moves/service.ts
  - apps/api/src/modules/over/moves/queries.ts
  - apps/api/test/over/move-sole-room.locked.spec.ts
  - apps/operations-android/src/features/f6-overbooking/model.ts
  - apps/operations-android/test/f6-overbooking/create-body.spec.ts
  - docs/08-thi-cong/tickets/HB-268-dieu-chuyen-tu-lay-phong.md
unlock:
  - docs/08-thi-cong/tickets/HB-268-dieu-chuyen-tu-lay-phong.md
---

# HB-268 — Lập điều chuyển từ cảnh báo

> Đặc tả do Claude soạn ngày 19/11/2026 từ máy thật (ca quá tải dựng bằng khoá bảo trì cả loại STD đêm 27/11).

## Vấn đề

- Lễ tân đi theo luồng: cảnh báo quá tải → "Xử lý" → chọn nâng hạng → "Lập điều chuyển". App ném `ZodError` vì `bookingRoomId` rỗng.
- Bản cảnh báo của lễ tân (`overbookingAlertSchema`, `strictObject`) chỉ có `bookingId`. Chi tiết ca có phòng, nhưng chỉ MANAGER/OWNER được đọc.
- Hệ quả: lễ tân, đúng vai được lập và thực hiện điều chuyển, không bao giờ lập được. Ops web cũng chặn nút trong trường hợp này ("needBookingRoom").

## Thay đổi

1. `roomMoveCreateRequestSchema.bookingRoomId` thành optional; hợp đồng không có thay đổi phá vỡ.
2. API: thiếu `bookingRoomId` thì dùng phòng `ACTIVE` **duy nhất** của booking, xác định sau khi đã khoá booking. Không có phòng nào hoặc nhiều hơn một thì 400, client phải chỉ rõ.
3. Android: `createBody` không gửi `bookingRoomId` khi màn được mở từ cảnh báo (chưa có phòng).
4. Không thêm trường vào bản cảnh báo. Lý do: client cũ parse bằng `strictObject` sẽ lỗi khi gặp trường mới.

## Tiêu chí nghiệm thu

1. `apps/api/test/over/move-sole-room.locked.spec.ts`: booking một phòng tự lấy đúng phòng (đỏ trước khi sửa); booking nhiều phòng trả 400. Toàn bộ `test/over` (48 test) xanh.
2. `apps/operations-android/test/f6-overbooking/create-body.spec.ts` (đỏ trước khi sửa).
3. Máy thật, PH-261119-00009 (STD, cả loại bị khoá bảo trì):
   - Lễ tân mở cảnh báo → Xử lý → nâng hạng → lý do và đồng ý → Lập điều chuyển (PROPOSED).
   - Nhập PIN → **EXECUTED**, phòng đích SUP01, giữ giá đã chốt.

## Ngoài phạm vi

- Màn đổi phòng hiện UUID của phòng và của điều chuyển, thay vì mã phòng: hợp đồng phương án/điều chuyển chỉ có id.
- Walk-out (bậc 4) xử lý trên web theo thiết kế (SCR-44).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci`
