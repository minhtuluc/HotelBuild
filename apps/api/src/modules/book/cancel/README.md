# HB-097 — `cancel-preview` + `cancel` (UC-BOOK-08)

`POST /api/v1/bookings/{bookingId}/cancel-preview` thuần đọc; `POST …/cancel`
đổi trạng thái toàn phần/một phần trong một transaction: kiểm lại neo xem trước
(ETag → `If-Match`, lệch → 412), tính hoàn/phạt bằng engine `@pinehill/domain/cancellation`
(HB-053), nhả assignment + void nghĩa vụ + giữ hạn mức hoàn qua `BookingLedger` (HB-093),
audit cùng transaction. Booking chưa xác nhận hoàn đúng số đã thu (QĐ-05), không làm tròn.

- Quyết định tiền: `context.ts` gom nền (nền phân bổ từ `booking_charges.amount` bất biến,
  chính sách từ `PriceSnapshot.policy_snapshot_json` mới nhất, mốc danh nghĩa BR-GEN-04),
  rồi gọi engine; dịch vụ chỉ **phân phối net cho từng nguồn** (`distribute`).
- Bất khả kháng (BR-CANCEL-13): 100% cơ sở, không phạt/phí, chỉ MANAGER/OWNER + `note` ≥ 20 ký tự.
- Huỷ một phần: `bookingRoomIds[]` khi `roomCount > 1`; trạng thái giữ nguyên, `totalAmount` giảm,
  snapshot `PARTIAL_CANCEL` mới (bản gốc bất biến), hoa hồng theo tỷ lệ gross còn lại.
- `If-Match` tuỳ chọn để tương thích SCR-36 (không gửi): vắng mặt cho qua; `"<v>"` kiểm version;
  `"<v>.<quyết định>"` (ETag của preview) kiểm thêm bậc đã xem.
- Khách tự huỷ (GUEST) chặn ở HB-017 (API chưa có phiên khách): mẫu kiểm dùng vai trò quầy.
