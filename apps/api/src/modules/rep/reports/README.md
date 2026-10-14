# REP — báo cáo đọc (HB-162)

Sáu tuyến `GET /api/v1/reports/*` theo api.md §2.12, đọc số liệu thật và áp phạm vi cơ sở tại tầng
truy vấn (BR-RBAC-02). Xuất báo cáo bất đồng bộ là ticket riêng (HB-163).

| Tuyến | Vai trò | Nguồn số |
| --- | --- | --- |
| `occupancy` | MANAGER, OWNER | phòng-đêm khả dụng (`rooms`/`room_blocks`, DOR theo giường) ÷ đã bán (`booking_rooms`) |
| `adr-revpar` | MANAGER, OWNER | `booking_charges.kind='ROOM'` trừ hoa hồng **theo từng đêm** của snapshot |
| `revenue-by-channel` | ACCOUNTANT, OWNER | mẫu csdl Q5: snapshot mới nhất của booking đã xác nhận/đã ở |
| `cancellations` | ACCOUNTANT, OWNER | `bookings` huỷ theo ngày huỷ + `refund_requests` theo bậc chính sách |
| `force-majeure` | OWNER | `refund_requests.is_force_majeure` |
| `overbooking` | MANAGER, OWNER | `overbooking_cases` + `room_merges` + `room_moves` |

## Quy ước đã chốt trong mã

1. **Chỉ số do một nguồn quyết định**: mọi tỷ lệ (công suất, ADR, RevPAR, tỷ lệ huỷ) đi qua engine
   `@pinehill/domain/reporting` (BR-REP-01); module không viết lại công thức. Tổng (sold/available/net)
   gộp ở CSDL rồi mới dựng fact, nên không kéo dòng thô về ứng dụng.
2. **Khoảng ngày `[from, to)`** theo ngày nghiệp vụ; trần một năm (`MAX_REPORT_DAYS = 366`) do module tự
   chặn vì hợp đồng không khai trần — ghi ở mục "Quyết định tự đưa ra" của PR.
3. **Hoa hồng lấy theo từng dòng đêm** trong `price_snapshots.payload_json->'nights'`
   (`bookingRoomId`/`date`/`grossAmount`/`commissionAmount`, csdl §3.6), phân bổ theo nghĩa vụ thực tế
   của đêm đó rồi làm tròn HALF_UP một lần; **không** nhân tỷ lệ hoa hồng gộp của cả booking và **không**
   đọc cấu hình kênh hiện tại (BR-RATE-08/16). Booking thiếu snapshot coi hoa hồng 0.
4. **Ngày nghiệp vụ từ mốc UTC** (`created_at`, `cancelled_at`) quy bằng `AT TIME ZONE` theo
   `BUSINESS_TIMEZONE` — không trộn `date` với `timestamptz` (api.md §6.4).
5. **Tỷ lệ huỷ** theo `created_at` (đúng nguyên văn BR-REP-01: “÷ tổng booking tạo trong kỳ”) và **mọi
   bộ lọc của báo cáo — kể cả `ratePlanCode` — áp cho cả tử số lẫn mẫu số**. Bảng bậc theo `cancelled_at`.
6. **Bậc chính sách trả nguyên giá trị canonical** (`cancellation_tiers.offset_hours`, bậc bắt tất là
   `-1` theo csdl §3.6); yêu cầu chưa gắn bậc và ca bất khả kháng (báo cáo riêng) không vào bảng bậc.
7. **Chi phí quá tải gắn ca theo (cơ sở, loại phòng, ngày thiếu phòng)**: chỉ tính ghép phòng `ACTIVE`
   và walk-out `EXECUTED` của booking **cùng loại phòng** đang ở trong ngày đó, nên nhiều ca cùng ngày
   khác loại phòng không nhân đôi chi phí. Tổng ba khoản cộng bằng `bigint` rồi mới kiểm miền an toàn.
8. Doanh thu phòng-đêm âm (dữ liệu sai) và tổng vượt `Number.MAX_SAFE_INTEGER` là **lỗi dữ liệu**:
   ném lỗi nội bộ để không trả số đã mất chính xác.

## Khoảng trống đã biết (cần hợp đồng/hạng mục khác — không tự mở rộng)

- Mẫu csdl Q5 còn trả `refunded_of_realized`, `missing_snapshots`, `cancelled_bookings`,
  `refunded_of_cancelled`; hợp đồng HB-160 (`revenueByChannelRowSchema`) chỉ có
  `channelCode/grossAmount/commissionAmount/netAmount/bookings`, nên các cột đó chưa được trả. Booking
  thiếu snapshot hiện đóng góp hoa hồng 0 và **không** được báo riêng — cần sửa hợp đồng trước.
- BR-OVER-16 yêu cầu giữ `resolved_by`/`delay_reason` cho báo cáo quá tải; `overbookingRowSchema` chưa có
  trường tương ứng nên chưa trả.
- Doanh thu/ADR hiện bằng 0 ngoài test cho tới khi có writer ghi `price_snapshots`/`booking_charges`
  (HB-077/HB-096 còn mở).
