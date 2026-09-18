# 06 — Ma trận truy vết BR → UC → API → Entity → Test

> Tài liệu truy vết của đồ án **Hệ thống đặt phòng khách sạn – homestay Pine Hill** (3 cơ sở · 55 phòng · 7 kênh bán).
> Ma trận nối **136 quy tắc nghiệp vụ** ([02/quy tắc nghiệp vụ](../02-nghiep-vu/quy-tac-nghiep-vu.md) §14 + §15) với **134 mã yêu cầu chức năng** `FR-*`, **52 use case** ([00 §8](../00-tong-quan.md#8-danh-mục-use-case)), **81 endpoint trên 76 đường dẫn** ([04/api](../04-thiet-ke/api.md) §2 — 13 module), **43 thực thể** trong từ điển ([00 §7](../00-tong-quan.md#7-từ-điển-thực-thể-nguồn-chân-lý-về-định-danh)) và **205 ca kiểm thử** (`TC-*` do [05/kế hoạch kiểm thử](../05-ke-hoach/ke-hoach-kiem-thu.md) cấp mã, cộng dải `TC-CANCEL-01…55` của [02/chính sách huỷ](../02-nghiep-vu/chinh-sach-huy-hoan-coc.md)).
>
> **Không định nghĩa lại giá trị nghiệp vụ.** Mọi con số nằm ở tài liệu nguồn; tài liệu này chỉ giữ **mã** và quan hệ truy vết.

---

## 1. Cách đọc

### 1.1. Bảy cột của ma trận chính (§2)

| Cột | Nội dung | Nguồn của cột |
|-----|----------|---------------|
| **Mã BR** | Định danh quy tắc `BR-<MOD>-<nn>` | [02/quy tắc nghiệp vụ](../02-nghiep-vu/quy-tac-nghiep-vu.md) §1–§13; bảng tra nhanh §14 và nhóm `BR-REP` ở §15 |
| **Tóm tắt quy tắc** | Một dòng ≤ 12 từ, chỉ để định vị; **không** phải giá trị nghiệp vụ | Diễn giải từ chính câu quy tắc ở [02](../02-nghiep-vu/quy-tac-nghiep-vu.md) |
| **FR** | Yêu cầu chức năng phủ quy tắc, mã `FR-<MOD>-<nn>` | [01/yêu cầu chức năng](../01-yeu-cau/yeu-cau-chuc-nang.md) **§17.1 — Truy vết ngược đầy đủ BR → FR** |
| **UC** | Use case thực hiện quy tắc, mã `UC-<MOD>-<nn>` | Hợp của (a) cột **BR chính** ở §4 và dòng **BR áp dụng** ở §6 của [01/mô hình use case](../01-yeu-cau/mo-hinh-use-case.md), và (b) cột *Use case* của các FR phủ quy tắc ở [01/yêu cầu chức năng](../01-yeu-cau/yeu-cau-chuc-nang.md); danh mục mã UC: [00 §8](../00-tong-quan.md#8-danh-mục-use-case) |
| **API** | Đường dẫn endpoint mang quy tắc | [04/api](../04-thiet-ke/api.md) **§2 — Danh mục endpoint theo module**; bổ sung từ §3 khi quy tắc chỉ được nêu trong đặc tả chi tiết của đúng endpoint đó. Ô chỉ chứa đường dẫn có thật trong §2 |
| **Entity** | Thực thể miền chịu quy tắc | [03/mô hình miền](../03-phan-tich/mo-hinh-mien.md) **§8 — Truy vết thực thể → quy tắc nghiệp vụ**, hợp nhất với tên thực thể được nêu **trong chính câu quy tắc**; danh mục tên: [00 §7](../00-tong-quan.md#7-từ-điển-thực-thể-nguồn-chân-lý-về-định-danh) |
| **TC** | Ca kiểm thử chứng minh quy tắc, mã `TC-<MOD>-<nn>` | [05/kế hoạch kiểm thử](../05-ke-hoach/ke-hoach-kiem-thu.md) — mọi bảng có cột **Mã BR** — và [02/chính sách huỷ](../02-nghiep-vu/chinh-sach-huy-hoan-coc.md) §1 (bảng BR ↔ ca kiểm thử) |

### 1.2. Quy ước `—`

| Ký hiệu | Nghĩa |
|---------|-------|
| `—` | **Không có mã tương ứng trong tài liệu nguồn.** Đây không phải lỗi định dạng mà là một **phát hiện truy vết**: mọi ô `—` được liệt kê đầy đủ ở §6 kèm lý do chấp nhận được hoặc việc cần làm |
| `·` | Ngăn cách nhiều mã trong cùng một ô |
| `…` | Ô có nhiều hơn 6 mã: 6 mã đầu in theo thứ tự tài liệu nguồn, phần còn lại xem ở mục truy vết ngược §4 |

### 1.3. Ánh xạ là **n-n**, không phải 1-1

- **BR → UC là n-n.** Một BR được nhiều UC thực hiện (`BR-INV-02` có mặt ở `UC-INV-02`, `UC-BOOK-01`, `UC-BOOK-04`, `UC-BOOK-06`, `UC-CHAN-03`) và một UC thực hiện nhiều BR (`UC-BOOK-08` thực hiện `BR-CANCEL-01…07`, `BR-CANCEL-19`, `BR-BOOK-11`, `BR-BOOK-14`, `BR-BOOK-17`, `BR-PAY-02`).
- **BR → API là n-n.** Một quy tắc chạm nhiều endpoint (`BR-INV-02` ở cả `GET /api/v1/inventory/availability` và `POST /api/v1/holds`); một endpoint mang nhiều quy tắc (`POST /api/v1/bookings` mang `BR-BOOK-01…16`).
- **BR → Entity là n-n.** Một quy tắc điều phối nhiều thực thể (`BR-REP-01` đọc `Booking`, `Payment`, `RoomMove`, `RoomMerge`, `RoomBlock`, `IdempotencyKey`); một thực thể chịu nhiều quy tắc (`Booking` chịu `BR-BOOK-01…17` cùng `BR-PAY-*`, `BR-OVER-*`, `BR-FO-*`, `BR-CRM-04`).
- **BR → FR** và **BR → TC** cũng n-n theo cùng cách; cột FR ở §2 lấy **nguyên văn** bảng §17.1 của tài liệu yêu cầu chức năng (136/136 quy tắc đều có FR).

### 1.4. Bốn điểm cần lưu ý khi đọc

1. **Cột FR là quan hệ phủ, không phải quan hệ cài đặt.** Một BR có thể chỉ được phủ bởi 1–2 FR (`BR-REP-01` ← `FR-REP-01`, `FR-REP-07`) nhưng được bốn UC dùng chung.
2. **Cột UC gộp hai đường truy vết** đã nêu ở §1.1 để không bỏ sót UC nào thực hiện quy tắc.
3. **Cột API không chứa endpoint ngoài §2**: hai endpoint `/integrations/ota/{channel}/bookings` và `/integrations/psp/{provider}/callback` nằm ở §5 của 04/api nên không dùng; endpoint minh hoạ trong ví dụ JSON cũng không dùng.
4. **Cột Entity dùng đúng tên trong từ điển 00 §7**, kể cả giá trị miền (`Money`, `StayPeriod`, `DateRange`, `ChannelContext`, `PhoneNumber`, `CancellationTierRule`).

---

## 2. Ma trận chính — 136 quy tắc nghiệp vụ

Mười bốn bảng con theo nhóm BR, đúng thứ tự bảng tra nhanh §14 và nhóm `BR-REP` §15 của [02/quy tắc nghiệp vụ](../02-nghiep-vu/quy-tac-nghiep-vu.md). Cột *Tóm tắt* ngắn để định vị, không thay thế câu quy tắc.

### 2.1. BR-GEN — Quy tắc chung (8 quy tắc)

| Mã BR | Tóm tắt quy tắc (≤ 12 từ) | FR | UC | API | Entity | TC |
|-------|---------------------------|----|----|-----|--------|----|
| BR-GEN-01 | Tiền là số nguyên VND, cấm số thực ở mọi tầng | FR-SYS-06 | UC-BOOK-01 · UC-SYS-02 | — | Payment · IdempotencyKey · Money · StayPeriod · DateRange · ChannelContext · … | TC-RATE-22 |
| BR-GEN-02 | Mốc thời gian lưu UTC, đổi giờ VN khi hiển thị | FR-SYS-07 | UC-CHAN-03 · UC-SYS-02 | — | — | — |
| BR-GEN-03 | Làm tròn lên 1.000 cho giá bán, cọc; xuống cho hoàn | FR-RATE-03 · FR-PAY-01 · FR-PAY-08 | UC-RATE-05 · UC-BOOK-01 · UC-PAY-01 · UC-PAY-04 | /api/v1/quotes | Payment · IdempotencyKey · Money · StayPeriod · DateRange · ChannelContext · … | TC-PAY-01 · TC-RATE-12 |
| BR-GEN-04 | Nhận phòng 14:00, trả phòng 12:00 giờ VN theo từng cơ sở | FR-PROP-07 | UC-PROP-01 · UC-BOOK-08 | /api/v1/properties/{propertyId} · /api/v1/bookings/{bookingId}/cancel | Property · Money · StayPeriod · DateRange · ChannelContext · PhoneNumber | TC-BOOK-02 |
| BR-GEN-05 | Múi giờ nghiệp vụ duy nhất Asia/Ho_Chi_Minh | FR-SYS-07 | UC-BOOK-08 · UC-SYS-02 | — | Property | — |
| BR-GEN-06 | Mã đặt phòng PH-YYMMDD-5 ký tự, duy nhất toàn hệ thống | FR-BOOK-18 | UC-BOOK-01 · UC-BOOK-02 · UC-BOOK-07 | /api/v1/bookings | Booking | TC-BOOK-13 |
| BR-GEN-07 | Thao tác ghi đổi Booking/Payment/RefundRequest/RoomMove/SystemSetting tạo AuditLog cùng transaction | FR-SYS-02 | UC-OVER-02 · UC-PROP-04 · UC-BOOK-02 · UC-BOOK-04 · UC-BOOK-06 · UC-BOOK-08 · … | /api/v1/refund-requests/{refundRequestId}/approve · /api/v1/system-settings/{key} | Booking · RoomMove · Payment · RefundRequest · User · Notification · … | TC-BOOK-24 · TC-PAY-18 · TC-SYS-02 · TC-SYS-03 |
| BR-GEN-08 | Thao tác ghi mang Idempotency-Key, hiệu lực 24 giờ | FR-PAY-03 · FR-SYS-08 | UC-AUTH-03 · UC-BOOK-01 · UC-BOOK-02 · UC-BOOK-08 · UC-PAY-02 · UC-PAY-04 · … | — | Payment · IdempotencyKey | TC-BOOK-20 · TC-PAY-04 · TC-PAY-12 · TC-CHAN-09 |

### 2.2. BR-PROP — Cơ sở & buồng phòng (6 quy tắc)

| Mã BR | Tóm tắt quy tắc (≤ 12 từ) | FR | UC | API | Entity | TC |
|-------|---------------------------|----|----|-----|--------|----|
| BR-PROP-01 | Chuỗi có đúng 3 cơ sở hoạt động, tổng 55 phòng ACTIVE | FR-PROP-01 | UC-PROP-01 | /api/v1/properties | Property | TC-PROP-01 |
| BR-PROP-02 | Phân bổ phòng CS-01 24, CS-02 18, CS-03 13 | FR-PROP-01 | UC-PROP-01 | /api/v1/properties | Property | TC-PROP-01 |
| BR-PROP-03 | Phân bổ theo loại phòng có ma trận riêng từng cơ sở | FR-PROP-02 | UC-PROP-02 | /api/v1/room-types · /api/v1/inventory/availability · /api/v1/reports/occupancy | RoomType | TC-PROP-01 |
| BR-PROP-04 | Sức chứa, đơn vị bán theo loại phòng; DOR bán theo giường | FR-PROP-02 | UC-OVER-02 · UC-PROP-02 · UC-OVER-03 | /api/v1/room-types · /api/v1/inventory/availability | RoomType | TC-INV-01 · TC-PROP-02 |
| BR-PROP-05 | Mã cơ sở CS01–CS03; mã phòng duy nhất trong một cơ sở | FR-PROP-03 | UC-PROP-03 | /api/v1/rooms | Room | TC-PROP-02 |
| BR-PROP-06 | Phòng MAINTENANCE/INACTIVE không vào tìm phòng và tồn khả dụng | FR-PROP-05 · FR-PROP-06 | UC-OVER-02 · UC-PROP-03 · UC-PROP-04 · UC-INV-02 · UC-OVER-01 · UC-FO-01 | /api/v1/room-blocks · /api/v1/inventory/availability | Room · RoomBlock · HousekeepingTask | TC-PROP-03 |

### 2.3. BR-INV — Tồn phòng (7 quy tắc)

| Mã BR | Tóm tắt quy tắc (≤ 12 từ) | FR | UC | API | Entity | TC |
|-------|---------------------------|----|----|-----|--------|----|
| BR-INV-01 | Tồn khả dụng hai tầng: chung và kênh, chống đếm trùng | FR-INV-01 | UC-INV-01 · UC-INV-02 · UC-BOOK-01 · UC-CHAN-03 · UC-OVER-01 · UC-REP-01 | /api/v1/inventory/grid · /api/v1/inventory/availability · /api/v1/reports/occupancy | Room · RoomBlock · HousekeepingTask · ChannelAllotment · RoomAssignment · Hold | TC-INV-05 · TC-INV-08 |
| BR-INV-02 | Kiểm tra tồn và giữ chỗ trong một transaction khoá bi quan | FR-INV-03 | UC-INV-02 · UC-BOOK-01 · UC-BOOK-04 · UC-BOOK-06 · UC-CHAN-03 | /api/v1/inventory/availability · /api/v1/bookings · /api/v1/holds | RoomAssignment · Hold | TC-INV-02 · TC-INV-03 |
| BR-INV-03 | Bất biến CSDL: tối đa một RoomAssignment mỗi đơn vị bán, đêm | FR-INV-04 | UC-OVER-02 · UC-BOOK-01 · UC-BOOK-04 · UC-BOOK-06 · UC-OVER-03 · UC-FO-01 | /api/v1/bookings · /api/v1/holds | Room · RoomAssignment · Hold · Money · StayPeriod · DateRange · … | TC-BOOK-18 · TC-INV-01 · TC-INV-03 · TC-INV-09 · TC-BOOK-14 |
| BR-INV-04 | Hold hết hạn được giải phóng trong vòng 60 giây | FR-INV-05 | UC-BOOK-04 | /api/v1/holds · /api/v1/holds/{holdId} | RoomAssignment · Hold | TC-INV-04 |
| BR-INV-05 | Allotment của ngày không vượt số phòng ACTIVE của loại | FR-INV-06 | UC-INV-03 | /api/v1/channel-allotments | RoomType · RoomBlock · ChannelAllotment · Booking | TC-INV-07 · TC-CHAN-06 |
| BR-INV-06 | RoomBlock chồng RoomAssignment cần MANAGER+ và mở OverbookingCase | FR-INV-07 | UC-PROP-01 · UC-PROP-04 · UC-OVER-01 | /api/v1/room-blocks · /api/v1/room-blocks/{roomBlockId} | RoomBlock · HousekeepingTask · Booking · RoomAssignment · OverbookingCase | TC-PROP-04 |
| BR-INV-07 | Kiểm tra tồn từng đêm; thiếu đêm trả E_INV_NO_AVAILABILITY | FR-INV-02 | UC-INV-01 · UC-INV-02 · UC-BOOK-01 · UC-BOOK-04 · UC-BOOK-06 · UC-CHAN-03 | /api/v1/inventory/grid · /api/v1/inventory/availability · /api/v1/holds | Room · RoomBlock · ChannelAllotment · RoomAssignment · Hold | TC-INV-06 · TC-INV-08 |

### 2.4. BR-RATE — Giá, mùa, kênh bán (19 quy tắc)

| Mã BR | Tóm tắt quy tắc (≤ 12 từ) | FR | UC | API | Entity | TC |
|-------|---------------------------|----|----|-----|--------|----|
| BR-RATE-01 | Thứ tự áp hệ số giá cố định; kèm ngưỡng công suất | FR-RATE-03 · FR-RATE-04 · FR-RATE-05 · FR-RATE-06 · FR-RATE-07 · FR-RATE-08 | UC-RATE-02 · UC-RATE-03 · UC-RATE-05 · UC-BOOK-01 · UC-BOOK-06 | /api/v1/quotes | RoomType · RatePlan · RateCalendar · Season · PriceQuote · OccupancySnapshot · … | TC-RATE-01 · TC-RATE-02 · TC-RATE-07 · TC-RATE-08 · TC-RATE-09 · TC-RATE-12 · … |
| BR-RATE-02 | Tra giá cơ bản theo priority OVERRIDE, RATE_PLAN, SEASON, BASE | FR-RATE-02 | UC-RATE-01 | /api/v1/room-types/{roomTypeId}/rate-calendar · /api/v1/quotes | RoomType · RateCalendar · Season | TC-RATE-13 |
| BR-RATE-03 | Giá cơ bản mặc định theo từng loại phòng | FR-RATE-01 | UC-PROP-02 · UC-RATE-01 · UC-BOOK-02 | /api/v1/room-types · /api/v1/room-types/{roomTypeId}/rate-calendar · /api/v1/quotes | RoomType · RateCalendar · Season | TC-RATE-02 |
| BR-RATE-04 | Sàn/trần giá theo loại phòng; kẹp là bảo vệ chủ đích | FR-RATE-01 | UC-PROP-02 · UC-RATE-01 · UC-BOOK-02 | /api/v1/room-types · /api/v1/quotes | RoomType · RateCalendar · Season | TC-RATE-11 · TC-RATE-22 |
| BR-RATE-05 | Hệ số mùa áp mọi kênh; chồng lấn cùng priority cảnh báo | FR-RATE-04 | UC-RATE-02 | /api/v1/seasons · /api/v1/quotes | RateCalendar · Season · AuditLog | TC-RATE-03 · TC-RATE-04 |
| BR-RATE-06 | Hệ số cuối tuần 1,20 cho Thứ Sáu và Thứ Bảy | FR-RATE-05 | UC-RATE-02 | /api/v1/seasons · /api/v1/quotes | RateCalendar · Season | TC-RATE-05 · TC-RATE-06 |
| BR-RATE-07 | WALKIN +10%, AGENCY −5%; ngưỡng sàn hệ số kênh theo hoa hồng | FR-RATE-08 · FR-CHAN-01 | UC-RATE-03 · UC-BOOK-02 · UC-BOOK-03 · UC-CHAN-01 | /api/v1/channels/{channelId} · /api/v1/quotes · /api/v1/quotes/multi-channel | Channel · ChannelPropertySetting · ChannelMapping · Booking | TC-RATE-10 |
| BR-RATE-08 | Doanh thu thuần = totalAmount × (1 − hoa hồng) | FR-RATE-09 · FR-REP-01 · FR-REP-02 · FR-REP-06 | UC-RATE-05 · UC-PAY-05 · UC-CHAN-03 · UC-REP-01 · UC-REP-02 | /api/v1/quotes · /api/v1/quotes/multi-channel · /api/v1/reports/adr-revpar · /api/v1/reports/revenue-by-channel | Channel · ChannelPropertySetting · ChannelMapping · Booking | TC-RATE-23 · TC-REP-01 · TC-REP-02 |
| BR-RATE-09 | Cân bằng giá so sau bước kẹp; cảnh báo không chặn lưu | FR-RATE-10 | UC-RATE-03 · UC-PAY-05 | /api/v1/channels/{channelId} · /api/v1/quotes · /api/v1/quotes/multi-channel | Channel · ChannelPropertySetting · ChannelMapping | TC-RATE-24 |
| BR-RATE-10 | Khuyến mãi PERCENT/AMOUNT áp một lần trên tổng tạm tính | FR-RATE-11 | UC-RATE-04 · UC-BOOK-01 | /api/v1/promotions · /api/v1/quotes | Promotion | TC-RATE-14 |
| BR-RATE-11 | Tổng giảm bị cắt về trần 30% và ghi cảnh báo | FR-RATE-12 | UC-RATE-04 · UC-BOOK-01 | /api/v1/promotions · /api/v1/quotes | Promotion | TC-RATE-15 |
| BR-RATE-12 | Tổng sau giảm không dưới tổng giá sàn: chặn hoặc cảnh báo | FR-RATE-12 | UC-RATE-04 · UC-BOOK-01 | /api/v1/quotes | Promotion · PriceQuote · PriceSnapshot | TC-RATE-16 · TC-RATE-26 |
| BR-RATE-13 | Xếp chồng tối đa hai mã; thứ tự AMOUNT rồi PERCENT | FR-RATE-11 | UC-RATE-04 · UC-BOOK-01 | /api/v1/promotions · /api/v1/quotes | Promotion · Booking | TC-RATE-17 |
| BR-RATE-14 | Khuyến mãi hết hạn/hết lượt bị từ chối khi xác nhận | FR-RATE-13 | UC-RATE-04 · UC-BOOK-01 | /api/v1/quotes | Promotion | TC-RATE-18 |
| BR-RATE-15 | PriceQuote có hiệu lực 15 phút, quá hạn phải tính lại | FR-RATE-14 | UC-INV-02 · UC-RATE-05 · UC-BOOK-01 | /api/v1/quotes | PriceQuote · PriceSnapshot | TC-RATE-19 |
| BR-RATE-16 | PriceSnapshot bất biến được lưu ngay khi booking rời DRAFT | FR-RATE-15 | UC-BOOK-01 · UC-BOOK-02 · UC-BOOK-06 | /api/v1/quotes · /api/v1/bookings · /api/v1/bookings/{bookingId}/cancel | PriceQuote · Booking · PriceSnapshot | TC-RATE-20 · TC-BOOK-07 · TC-BOOK-16 · TC-BOOK-17 |
| BR-RATE-17 | Cùng đầu vào cho cùng kết quả giá trên ba nền tảng | FR-RATE-16 | UC-INV-02 · UC-RATE-05 · UC-BOOK-01 · UC-BOOK-06 | /api/v1/inventory/availability · /api/v1/quotes | PriceQuote · PriceSnapshot | TC-RATE-17 · TC-RATE-20 · TC-RATE-21 |
| BR-RATE-18 | Hoa hồng mặc định theo kênh, ghi đè theo (kênh, cơ sở) | FR-RATE-17 | UC-RATE-03 | /api/v1/channels/{channelId} | Channel · ChannelPropertySetting · ChannelMapping · PriceSnapshot · AuditLog | TC-RATE-10 · TC-RATE-23 |
| BR-RATE-19 | LONGSTAY14 phải có giá riêng; ưu đãi gợi ý tối thiểu 5% | FR-RATE-18 | UC-RATE-01 | /api/v1/room-types/{roomTypeId}/rate-calendar | RatePlan · RateCalendar · Season | TC-RATE-25 · TC-CANCEL-27 · TC-CANCEL-28 · TC-CANCEL-29 · TC-CANCEL-30 · TC-CANCEL-31 · … |

### 2.5. BR-BOOK — Đặt phòng (17 quy tắc)

| Mã BR | Tóm tắt quy tắc (≤ 12 từ) | FR | UC | API | Entity | TC |
|-------|---------------------------|----|----|-----|--------|----|
| BR-BOOK-01 | Booking cần đủ khách, cơ sở, loại phòng, ngày, kênh, gói giá | FR-BOOK-01 · FR-BOOK-02 · FR-BOOK-03 | UC-BOOK-01 · UC-BOOK-02 · UC-BOOK-03 · UC-CHAN-03 | /api/v1/bookings | Booking | TC-BOOK-01 · TC-BOOK-16 · TC-BOOK-17 |
| BR-BOOK-02 | checkIn không ở quá khứ và không xa hơn 365 ngày | FR-BOOK-01 | UC-BOOK-01 · UC-BOOK-02 | /api/v1/bookings | Booking · Money · StayPeriod · DateRange · ChannelContext · PhoneNumber | TC-BOOK-02 |
| BR-BOOK-03 | Số đêm trong khoảng minNights–maxNights của gói giá | FR-BOOK-04 | UC-BOOK-01 · UC-BOOK-02 · UC-BOOK-06 | /api/v1/bookings | RatePlan · Booking · Money · StayPeriod · DateRange · ChannelContext · … | TC-RATE-08 · TC-BOOK-03 |
| BR-BOOK-04 | Số khách tối đa bằng sức chứa nhân số phòng | FR-BOOK-05 | UC-BOOK-01 · UC-BOOK-02 · UC-OVER-03 | /api/v1/bookings · /api/v1/holds | RoomType · Booking · BookingRoom | TC-BOOK-04 |
| BR-BOOK-05 | Phụ thu trẻ em: dưới 6 tuổi miễn phí, 6–11 tuổi 50% | FR-BOOK-06 | UC-BOOK-01 · UC-BOOK-02 | /api/v1/bookings | Booking | TC-BOOK-05 |
| BR-BOOK-06 | Chuyển trạng thái theo máy trạng thái, ghi BookingStatusHistory | FR-BOOK-07 | UC-BOOK-07 · UC-FO-04 | /api/v1/bookings | Booking · BookingStatusHistory | TC-BOOK-21 · TC-BOOK-06 · TC-BOOK-15 |
| BR-BOOK-07 | HELD có holdExpiresAt bằng thời điểm tạo cộng holdMinutes của kênh | FR-BOOK-08 | UC-BOOK-01 · UC-BOOK-03 · UC-BOOK-04 | /api/v1/bookings · /api/v1/holds | Channel · ChannelPropertySetting · ChannelMapping · Booking · RoomAssignment · Hold | TC-BOOK-07 |
| BR-BOOK-08 | Hết hạn hold chuyển EXPIRED và giải phóng RoomAssignment | FR-BOOK-09 | UC-BOOK-01 · UC-BOOK-04 | /api/v1/bookings · /api/v1/holds | Booking · RoomAssignment · Hold | TC-INV-04 · TC-CANCEL-50 |
| BR-BOOK-09 | Chỉ CONFIRMED khi đã trả đủ cọc, trừ OTA_COLLECT và ghi nợ | FR-BOOK-10 | UC-BOOK-01 · UC-BOOK-02 · UC-BOOK-03 · UC-PAY-02 · UC-CHAN-03 | /api/v1/bookings · /api/v1/bookings/{bookingId}/confirm | Booking · Payment · IdempotencyKey | TC-PAY-02 · TC-PAY-03 |
| BR-BOOK-10 | Nhiều phòng: mỗi phòng một BookingRoom, mỗi đêm một RoomAssignment | FR-BOOK-11 | UC-BOOK-01 · UC-BOOK-02 · UC-BOOK-05 | /api/v1/bookings | Booking · BookingRoom · RoomAssignment · Hold | TC-BOOK-08 · TC-BOOK-14 |
| BR-BOOK-11 | Huỷ booking giải phóng mọi RoomAssignment trong cùng transaction | FR-BOOK-12 | UC-BOOK-08 | /api/v1/bookings · /api/v1/bookings/{bookingId}/cancel · /api/v1/room-moves · /api/v1/room-moves/{roomMoveId}/execute | Booking · RoomAssignment · Hold | TC-BOOK-18 · TC-BOOK-26 · TC-CANCEL-01 · TC-CANCEL-02 · TC-CANCEL-03 · TC-CANCEL-04 · … |
| BR-BOOK-12 | Đổi ngày: 1 lần miễn phí khi ≥ 168h; NONREF phí 10% | FR-BOOK-13 | UC-BOOK-06 | /api/v1/bookings · /api/v1/bookings/{bookingId}/reschedule | RatePlan · Booking · PriceSnapshot · AuditLog | TC-BOOK-22 · TC-BOOK-09 · TC-CANCEL-53 |
| BR-BOOK-13 | Booking CHECKED_IN không được sửa ngày | FR-BOOK-14 | UC-BOOK-05 · UC-BOOK-06 · UC-BOOK-08 | /api/v1/bookings · /api/v1/bookings/{bookingId}/reschedule | Booking | TC-BOOK-10 |
| BR-BOOK-14 | Cấm xoá cứng booking CONFIRMED; DRAFT/HELD chưa trả thì được | FR-BOOK-15 | UC-BOOK-05 · UC-BOOK-08 | /api/v1/bookings · /api/v1/bookings/{bookingId} · /api/v1/bookings/{bookingId}/cancel | Booking · RefundRequest | TC-BOOK-19 · TC-CANCEL-01 · TC-CANCEL-02 · TC-CANCEL-03 · TC-CANCEL-04 · TC-CANCEL-05 · … |
| BR-BOOK-15 | Khách trong danh sách đen không tạo được booking mới | FR-BOOK-16 | UC-BOOK-01 · UC-CRM-03 | /api/v1/bookings | Booking · Guest · GuestNote · LoyaltyTransaction | TC-BOOK-12 |
| BR-BOOK-16 | Chống đặt trùng trong 24 giờ, trả booking cũ kèm cờ | FR-BOOK-17 | UC-BOOK-01 · UC-BOOK-02 · UC-CHAN-03 | /api/v1/bookings | Booking | TC-BOOK-11 |
| BR-BOOK-17 | Xoá cứng booking phải ghi AuditLog beforeJson trước khi xoá | FR-BOOK-20 | UC-BOOK-05 · UC-BOOK-08 | /api/v1/bookings/{bookingId} | Booking · AuditLog | TC-BOOK-24 · TC-CANCEL-50 |

### 2.6. BR-CANCEL — Huỷ phòng & hoàn cọc (19 quy tắc)

| Mã BR | Tóm tắt quy tắc (≤ 12 từ) | FR | UC | API | Entity | TC |
|-------|---------------------------|----|----|-----|--------|----|
| BR-CANCEL-01 | Mức hoàn chọn theo bậc dữ liệu hoá; bậc −1 bắt tất | FR-BOOK-19 | UC-BOOK-08 | /api/v1/bookings/{bookingId}/cancel-preview · /api/v1/bookings/{bookingId}/cancel · /api/v1/refund-requests · /api/v1/reports/cancellations | RatePlan · CancellationPolicy · CancellationTier · CancellationTierRule | TC-BOOK-23 · TC-BOOK-25 · TC-CANCEL-01 · TC-CANCEL-02 · TC-CANCEL-03 · TC-CANCEL-04 · … |
| BR-CANCEL-02 | Tỷ lệ cọc theo gói giá, làm tròn lên bội 1.000 | FR-PAY-01 | UC-BOOK-08 · UC-PAY-01 | /api/v1/bookings/{bookingId}/cancel-preview · /api/v1/bookings/{bookingId}/cancel · /api/v1/refund-requests · /api/v1/reports/cancellations | RatePlan | TC-BOOK-23 · TC-PAY-01 · TC-CANCEL-01 · TC-CANCEL-02 · TC-CANCEL-03 · TC-CANCEL-04 · … |
| BR-CANCEL-03 | hoursBeforeCheckIn tính từ thời điểm nhận phòng danh nghĩa | FR-BOOK-19 | UC-BOOK-08 | /api/v1/bookings/{bookingId}/cancel-preview · /api/v1/bookings/{bookingId}/cancel · /api/v1/refund-requests | Booking · CancellationPolicy · CancellationTier · CancellationTierRule | TC-BOOK-23 · TC-CANCEL-15 · TC-CANCEL-35 · TC-CANCEL-36 · TC-CANCEL-37 · TC-CANCEL-38 · … |
| BR-CANCEL-04 | Cơ sở tính hoàn là paidAmount, không phải totalAmount | FR-PAY-08 | UC-BOOK-08 · UC-PAY-04 · UC-REP-03 | /api/v1/bookings/{bookingId}/cancel-preview · /api/v1/bookings/{bookingId}/cancel · /api/v1/refund-requests | RefundRequest | TC-BOOK-23 · TC-BOOK-26 · TC-CANCEL-05 · TC-CANCEL-14 · TC-CANCEL-44 · TC-CANCEL-45 · … |
| BR-CANCEL-05 | refundAmount làm tròn xuống; netRefund trừ phí xử lý | FR-PAY-08 | UC-BOOK-08 · UC-PAY-04 · UC-REP-03 | /api/v1/bookings/{bookingId}/cancel-preview · /api/v1/bookings/{bookingId}/cancel · /api/v1/refund-requests | RefundRequest · CancellationPolicy · CancellationTier | TC-BOOK-23 · TC-CANCEL-03 · TC-CANCEL-18 · TC-CANCEL-44 · TC-CANCEL-45 · TC-CANCEL-46 · … |
| BR-CANCEL-06 | Bậc phụ thu đêm đầu tạo Payment PENALTY ở trạng thái PENDING | FR-PAY-09 | UC-BOOK-08 · UC-PAY-04 | /api/v1/bookings · /api/v1/bookings/{bookingId}/cancel-preview · /api/v1/bookings/{bookingId}/cancel · /api/v1/refund-requests | PriceQuote · PriceSnapshot · Payment · CancellationPolicy · CancellationTier · IdempotencyKey | TC-CANCEL-11 · TC-CANCEL-12 · TC-CANCEL-13 · TC-CANCEL-14 · TC-CANCEL-48 |
| BR-CANCEL-07 | NONREF không bao giờ hoàn tiền, chỉ đổi ngày với phí 10% | FR-BOOK-19 | UC-BOOK-08 | /api/v1/bookings/{bookingId}/cancel · /api/v1/refund-requests | RatePlan · CancellationPolicy · CancellationTier | TC-CANCEL-23 · TC-CANCEL-24 · TC-CANCEL-25 · TC-CANCEL-26 |
| BR-CANCEL-08 | Đổi ngày không tạo RefundRequest | FR-BOOK-13 | UC-BOOK-06 | /api/v1/bookings/{bookingId}/reschedule · /api/v1/bookings/{bookingId}/cancel · /api/v1/refund-requests | RefundRequest | TC-BOOK-22 · TC-CANCEL-53 |
| BR-CANCEL-09 | Trả phòng sớm hoàn theo ngưỡng báo trước của từng gói giá | FR-FO-07 | UC-BOOK-08 · UC-FO-02 | /api/v1/bookings/{bookingId}/cancel · /api/v1/front-office/check-out | PriceSnapshot · RefundRequest | TC-BOOK-25 · TC-CANCEL-52 |
| BR-CANCEL-10 | No-show đánh dấu 23:59 ngày nhận phòng và áp bậc cuối | FR-FO-06 | UC-BOOK-08 · UC-FO-04 | /api/v1/bookings/{bookingId}/cancel · /api/v1/front-office/no-show | Booking | TC-BOOK-21 · TC-FO-07 · TC-CANCEL-15 · TC-CANCEL-34 · TC-CANCEL-35 |
| BR-CANCEL-11 | Phí xử lý hoàn tiền mặc định 0, trừ vào tiền hoàn | FR-PAY-10 | UC-PAY-04 · UC-SYS-02 | /api/v1/bookings/{bookingId}/cancel · /api/v1/refund-requests | RefundRequest · User · Notification · AuditLog · SystemSetting | TC-PAY-19 · TC-CANCEL-44 · TC-CANCEL-45 · TC-CANCEL-46 · TC-CANCEL-47 · TC-CANCEL-48 · … |
| BR-CANCEL-12 | Cam kết hoàn trong 3 ngày làm việc, tối đa 7 ngày | FR-PAY-11 | UC-PAY-04 · UC-NOTI-02 | /api/v1/bookings/{bookingId}/cancel · /api/v1/refund-requests/{refundRequestId}/approve · /api/v1/refund-requests/{refundRequestId}/pay | RefundRequest | TC-CANCEL-52 |
| BR-CANCEL-13 | Bất khả kháng hoàn 100%; MANAGER+ tạo kèm minh chứng | FR-OVER-16 · FR-REP-05 | UC-BOOK-08 · UC-PAY-04 · UC-OVER-05 · UC-REP-03 | /api/v1/bookings/{bookingId}/cancel · /api/v1/refund-requests · /api/v1/reports/force-majeure | RefundRequest | TC-PAY-20 · TC-REP-03 · TC-CANCEL-50 |
| BR-CANCEL-14 | Huỷ do khách sạn hoàn 100% và bồi thường theo walk-out | FR-OVER-08 | UC-OVER-02 · UC-BOOK-08 · UC-OVER-04 · UC-REP-04 | /api/v1/bookings/{bookingId}/cancel · /api/v1/room-moves | RoomMove · RoomMerge · RefundRequest | TC-OVER-07 · TC-CANCEL-51 |
| BR-CANCEL-15 | Phê duyệt hai cấp khi netRefund trên 5.000.000; người khác duyệt | FR-PAY-07 | UC-PAY-04 · UC-OVER-05 | /api/v1/bookings/{bookingId}/cancel · /api/v1/refund-requests/{refundRequestId}/approve | RefundRequest | TC-PAY-15 · TC-PAY-16 · TC-CANCEL-52 |
| BR-CANCEL-16 | Chỉ chi hoàn sau khi RefundRequest ở APPROVED; ghi AuditLog | FR-PAY-07 | UC-BOOK-08 · UC-PAY-04 | /api/v1/bookings/{bookingId}/cancel · /api/v1/refund-requests/{refundRequestId}/approve · /api/v1/refund-requests/{refundRequestId}/pay | Payment · RefundRequest · AuditLog · IdempotencyKey | TC-BOOK-20 · TC-PAY-17 · TC-PAY-18 · TC-CANCEL-52 |
| BR-CANCEL-17 | Tổng hoàn luỹ kế của booking không vượt paidAmount | FR-PAY-12 · FR-REP-03 | UC-BOOK-08 · UC-PAY-04 · UC-REP-03 | /api/v1/bookings/{bookingId}/cancel · /api/v1/refund-requests | Booking · RefundRequest | TC-PAY-16 · TC-PAY-21 · TC-CANCEL-44 |
| BR-CANCEL-18 | Yêu cầu PENDING chuyển CANCELLED khi rút hoặc khôi phục booking | FR-PAY-16 | UC-PAY-04 | /api/v1/bookings/{bookingId}/cancel · /api/v1/refund-requests · /api/v1/refund-requests/{refundRequestId}/cancel | Booking · RefundRequest | TC-PAY-14 · TC-CANCEL-52 |
| BR-CANCEL-19 | Huỷ một phần phân bổ tiền theo tỷ lệ giá phòng huỷ | FR-BOOK-21 | UC-BOOK-08 · UC-PAY-04 | /api/v1/bookings/{bookingId}/cancel | Booking · BookingRoom · RoomAssignment · PriceSnapshot · RefundRequest | TC-BOOK-26 · TC-CANCEL-54 |

### 2.7. BR-PAY — Thanh toán (10 quy tắc)

| Mã BR | Tóm tắt quy tắc (≤ 12 từ) | FR | UC | API | Entity | TC |
|-------|---------------------------|----|----|-----|--------|----|
| BR-PAY-01 | depositAmount làm tròn lên 1.000 của tỷ lệ cọc | FR-PAY-01 | UC-BOOK-02 · UC-PAY-01 · UC-PAY-02 | /api/v1/payments · /api/v1/payments/online | Booking · Payment · IdempotencyKey | TC-PAY-01 |
| BR-PAY-02 | Thu balanceDue trước khi giao phòng | FR-PAY-05 | UC-BOOK-02 · UC-BOOK-06 · UC-BOOK-08 · UC-PAY-01 · UC-PAY-02 · UC-PAY-03 · … | /api/v1/payments · /api/v1/payments/online · /api/v1/bookings/{bookingId}/balance | Booking · Payment · IdempotencyKey | TC-PAY-09 · TC-PAY-11 |
| BR-PAY-03 | Callback cổng thanh toán idempotent theo idempotencyKey | FR-PAY-03 | UC-PAY-02 | /api/v1/payments/online | Payment · IdempotencyKey | TC-PAY-04 · TC-PAY-11 · TC-PAY-12 · TC-PAY-13 |
| BR-PAY-04 | Không lưu số thẻ, ngày hết hạn hay CVV | FR-PAY-02 | UC-PAY-02 | /api/v1/payments/online | Payment · IdempotencyKey | TC-PAY-06 |
| BR-PAY-05 | Giao dịch quá 15 phút không callback chuyển FAILED | FR-PAY-04 | UC-BOOK-04 · UC-PAY-02 | /api/v1/payments/online · /api/v1/payments/{paymentId}/status | RoomAssignment · Hold · Payment · IdempotencyKey | TC-PAY-05 · TC-CANCEL-50 |
| BR-PAY-06 | Tiền mặt ghi createdBy và paidAt để đối soát | FR-PAY-06 | UC-BOOK-02 · UC-PAY-01 · UC-PAY-03 · UC-PAY-05 · UC-FO-01 | /api/v1/payments · /api/v1/reconciliation/daily/close | Payment · IdempotencyKey | TC-PAY-10 |
| BR-PAY-07 | Tổng hoàn luỹ kế của booking không vượt paidAmount | FR-PAY-12 | UC-BOOK-08 · UC-PAY-04 · UC-REP-03 | /api/v1/payments · /api/v1/refund-requests | Booking · Payment · RefundRequest · IdempotencyKey | TC-PAY-21 · TC-CANCEL-44 |
| BR-PAY-08 | Hoàn về phương thức gốc; tiền mặt thì chuyển khoản | FR-PAY-13 | UC-PAY-04 | /api/v1/refund-requests/{refundRequestId}/pay | Payment · RefundRequest · IdempotencyKey | TC-PAY-07 · TC-CANCEL-52 |
| BR-PAY-09 | Hoàn ghi bằng Payment loại REFUND, không sửa hay xoá Payment gốc | FR-PAY-14 | UC-BOOK-08 · UC-PAY-04 | /api/v1/refund-requests/{refundRequestId}/pay | Payment · RefundRequest · IdempotencyKey | TC-PAY-08 · TC-CANCEL-52 |
| BR-PAY-10 | Đối soát cuối ngày theo cặp (người thu, ngày VN) | FR-PAY-15 | UC-PAY-01 · UC-PAY-04 · UC-PAY-05 · UC-REP-02 | /api/v1/reconciliation/daily/close | Payment · IdempotencyKey | TC-PAY-10 |

### 2.8. BR-CHAN — Kênh bán (8 quy tắc)

| Mã BR | Tóm tắt quy tắc (≤ 12 từ) | FR | UC | API | Entity | TC |
|-------|---------------------------|----|----|-----|--------|----|
| BR-CHAN-01 | OTA hạn mức 80% phòng; kênh trực tiếp chia tồn chung | FR-CHAN-02 | UC-INV-03 · UC-CHAN-01 · UC-CHAN-03 | /api/v1/inventory/availability · /api/v1/channel-allotments · /api/v1/channels/{channelId}/mappings | RoomType · Channel · ChannelPropertySetting · ChannelAllotment · ChannelMapping | TC-CHAN-01 · TC-CHAN-06 |
| BR-CHAN-02 | Đồng bộ tồn, giá ngay khi đổi và chậm nhất 5 phút | FR-CHAN-03 | UC-BOOK-04 · UC-CHAN-02 · UC-CHAN-03 | /api/v1/channels/{channelId}/sync | OutboxEvent | TC-CHAN-02 · TC-CHAN-11 |
| BR-CHAN-03 | Booking OTA ghi CONFIRMED kể cả hết phòng, mở OverbookingCase | FR-CHAN-04 | UC-CHAN-03 · UC-OVER-01 | /api/v1/bookings · /api/v1/channels/{channelId}/ota-bookings | Channel · ChannelPropertySetting · ChannelMapping · Booking · OverbookingCase | TC-PAY-03 · TC-CHAN-03 · TC-CHAN-08 · TC-CHAN-09 · TC-CHAN-11 |
| BR-CHAN-04 | Booking OTA huỷ theo chính sách OTA, không tạo RefundRequest | FR-CHAN-05 · FR-REP-06 | UC-BOOK-08 · UC-CHAN-03 · UC-REP-02 | /api/v1/channels/{channelId}/ota-bookings | Booking · RefundRequest | TC-CHAN-07 · TC-CANCEL-55 |
| BR-CHAN-05 | Tồn ≤ 2 thì đóng bán trên mọi kênh OTA | FR-CHAN-06 | UC-CHAN-01 · UC-CHAN-02 | /api/v1/inventory/availability · /api/v1/channels/{channelId}/sales-closure | RoomBlock · Channel · ChannelPropertySetting · ChannelMapping | TC-CHAN-04 |
| BR-CHAN-06 | Mọi thay đổi giá hoặc tồn ghi OutboxEvent trong cùng transaction | FR-CHAN-03 | UC-OVER-02 · UC-RATE-03 · UC-BOOK-01 · UC-BOOK-04 · UC-BOOK-06 · UC-BOOK-08 · … | /api/v1/channel-allotments · /api/v1/channels/{channelId}/sync | OutboxEvent | TC-CHAN-02 |
| BR-CHAN-07 | Đồng bộ lỗi 3 lần liên tiếp: cảnh báo MANAGER, kênh DEGRADED | FR-CHAN-07 | UC-CHAN-02 · UC-CHAN-03 | /api/v1/channels/{channelId}/sync | Channel · ChannelPropertySetting · ChannelMapping · OutboxEvent | TC-CHAN-05 |
| BR-CHAN-08 | Số phòng bán trên OTA không vượt allotment còn lại của ngày | FR-CHAN-08 | UC-INV-03 · UC-CHAN-03 | /api/v1/channel-allotments · /api/v1/channels/{channelId}/mappings | Channel · ChannelPropertySetting · ChannelAllotment · ChannelMapping | TC-CHAN-10 |

### 2.9. BR-OVER — Quá tải, ghép phòng & điều chuyển (16 quy tắc)

| Mã BR | Tóm tắt quy tắc (≤ 12 từ) | FR | UC | API | Entity | TC |
|-------|---------------------------|----|----|-----|--------|----|
| BR-OVER-01 | Trần bán vượt mặc định bằng 0 — không bán vượt | FR-OVER-01 | UC-CHAN-01 · UC-CHAN-03 · UC-OVER-01 | /api/v1/properties/{propertyId} | Property | TC-OVER-03 · TC-OVER-05 · TC-OVER-11 · TC-OVER-12 |
| BR-OVER-02 | Bán vượt chỉ khi kênh cho phép và trong trần cơ sở | FR-OVER-01 | UC-CHAN-01 · UC-CHAN-03 · UC-OVER-01 | /api/v1/properties/{propertyId} · /api/v1/channels/{channelId} · /api/v1/bookings | Property · Booking | TC-OVER-03 |
| BR-OVER-03 | Booking tạo khi hết phòng đặt oversold và tự mở OverbookingCase | FR-OVER-02 | UC-CHAN-03 · UC-OVER-01 | /api/v1/bookings · /api/v1/overbooking-cases | Booking · OverbookingCase | TC-CHAN-03 · TC-CHAN-11 · TC-OVER-04 |
| BR-OVER-04 | Ca quá tải phải RESOLVED trước T−24h, quá hạn leo thang OWNER | FR-OVER-03 | UC-OVER-01 · UC-REP-04 | /api/v1/overbooking-cases · /api/v1/overbooking-cases/{caseId}/resolve · /api/v1/reports/overbooking | OverbookingCase | TC-OVER-02 · TC-OVER-16 · TC-OVER-17 |
| BR-OVER-05 | Job quét quá tải chạy mỗi giờ, 30 ngày tới | FR-OVER-04 | UC-OVER-01 | /api/v1/overbooking-cases · /api/v1/reports/overbooking | OverbookingCase | TC-OVER-01 · TC-OVER-16 |
| BR-OVER-06 | Chi phí bồi thường, đưa đón ghi vào RoomMove; MANAGER+ duyệt | FR-OVER-05 · FR-OVER-06 · FR-OVER-08 | UC-OVER-02 · UC-OVER-04 · UC-REP-04 | /api/v1/overbooking-cases · /api/v1/overbooking-cases/{caseId}/relocation-plan · /api/v1/room-moves · /api/v1/room-moves/{roomMoveId}/approve | RoomMove · RoomMerge | TC-OVER-06 · TC-OVER-07 · TC-REP-03 · TC-CANCEL-51 |
| BR-OVER-07 | Sang cơ sở khác thành phố cần khách đồng ý, MANAGER+ duyệt | FR-OVER-07 | UC-OVER-02 · UC-OVER-05 | /api/v1/room-moves · /api/v1/room-moves/{roomMoveId}/approve | RoomMove · RoomMerge | TC-OVER-06 |
| BR-OVER-08 | RoomMove giữ nguyên đơn giá đã chốt cho toàn kỳ | FR-OVER-09 · FR-OVER-15 | UC-OVER-02 · UC-OVER-03 · UC-FO-01 | /api/v1/room-moves · /api/v1/room-moves/{roomMoveId}/execute | RoomAssignment · Hold · RoomMove · RoomMerge | TC-OVER-08 · TC-OVER-15 |
| BR-OVER-09 | Khách CHECKED_IN không được điều chuyển, trừ bất khả kháng | FR-OVER-10 | UC-OVER-02 | /api/v1/room-moves | RoomMove · RoomMerge | TC-OVER-09 |
| BR-OVER-10 | RoomMove phải ghi AuditLog và thông báo khách trong 15 phút | FR-OVER-11 · FR-NOTI-02 | UC-OVER-02 · UC-OVER-03 · UC-NOTI-02 | /api/v1/room-moves · /api/v1/room-moves/{roomMoveId}/execute | RoomMove · RoomMerge · User · Notification · AuditLog · SystemSetting | TC-OVER-08 · TC-OVER-15 |
| BR-OVER-11 | Thứ tự điều chuyển: keepScore tăng, createdAt giảm, Booking.seq tăng | FR-OVER-12 | UC-OVER-02 · UC-OVER-01 · UC-OVER-03 · UC-OVER-04 · UC-FO-01 | /api/v1/overbooking-cases · /api/v1/overbooking-cases/{caseId} · /api/v1/overbooking-cases/{caseId}/relocation-plan | Booking · RoomMove · RoomMerge · Guest · GuestNote · LoyaltyTransaction | TC-OVER-10 · TC-OVER-16 |
| BR-OVER-12 | WALKIN chưa trả và HELD không ưu tiên hơn booking đã cọc | FR-OVER-12 | UC-OVER-02 · UC-OVER-01 | /api/v1/overbooking-cases · /api/v1/overbooking-cases/{caseId} · /api/v1/overbooking-cases/{caseId}/relocation-plan | Booking · RoomMove · RoomMerge | TC-OVER-10 |
| BR-OVER-13 | MERGE_SHARE cần đủ hai cờ đồng thuận, chỉ loại allowShared | FR-OVER-13 | UC-OVER-03 | /api/v1/room-moves · /api/v1/room-merges · /api/v1/room-merges/{roomMergeId}/consent | Room · Booking · RoomMove · RoomMerge · Guest | TC-OVER-11 · TC-OVER-13 |
| BR-OVER-14 | Không ghép khác giới trừ khi đủ đồng thuận và MANAGER+ duyệt | FR-OVER-13 | UC-OVER-03 | /api/v1/room-moves · /api/v1/room-merges · /api/v1/room-merges/{roomMergeId}/approve | Room · RoomMove · RoomMerge | TC-OVER-13 |
| BR-OVER-15 | Ghép phòng không đổi doanh thu; chiết khấu ghi riêng vào RoomMerge | FR-PROP-04 · FR-OVER-14 · FR-OVER-15 · FR-REP-04 | UC-PROP-03 · UC-OVER-03 · UC-REP-04 | /api/v1/rooms/{roomId}/connecting-room · /api/v1/room-moves · /api/v1/room-merges · /api/v1/reports/overbooking | RoomMove · RoomMerge | TC-OVER-14 · TC-REP-03 |
| BR-OVER-16 | Ca quá tải quá hạn chuyển ESCALATED, không tự đóng | FR-OVER-17 | UC-OVER-01 | /api/v1/overbooking-cases · /api/v1/reports/overbooking | OverbookingCase · RoomMove · RoomMerge | TC-OVER-17 |

### 2.10. BR-FO — Tiền sảnh (7 quy tắc)

| Mã BR | Tóm tắt quy tắc (≤ 12 từ) | FR | UC | API | Entity | TC |
|-------|---------------------------|----|----|-----|--------|----|
| BR-FO-01 | Check-in khi CONFIRMED, hết nợ, đúng ngày; ghi nợ cần MANAGER+ | FR-FO-01 · FR-FO-08 | UC-PAY-03 · UC-FO-01 | /api/v1/front-office/check-in | Booking · AuditLog | TC-PAY-09 · TC-FO-01 · TC-FO-06 |
| BR-FO-02 | Check-in sau 23:59 ngày nhận phòng bị từ chối | FR-FO-01 | UC-FO-01 | /api/v1/front-office/check-in | Booking | TC-FO-02 |
| BR-FO-03 | Check-out muộn: 12:00–18:00 thu 50%, sau 18:00 thu 100% giá đêm cuối | FR-FO-03 | UC-FO-02 | /api/v1/front-office/check-out | Booking | TC-FO-03 |
| BR-FO-04 | Check-in sớm: 08:00–12:00 miễn phí, 12:00–14:00 thu 30% giá đêm đầu | FR-FO-04 | UC-FO-01 | /api/v1/front-office/check-in | Booking | TC-FO-04 |
| BR-FO-05 | Check-out chốt balanceDue về 0 trước khi in hoá đơn | FR-FO-02 | UC-FO-02 | /api/v1/front-office/check-out | Booking | TC-FO-05 |
| BR-FO-06 | Sau check-out tạo HousekeepingTask với businessDate là ngày trả phòng | FR-FO-05 | UC-FO-01 · UC-FO-02 · UC-FO-03 | /api/v1/front-office/check-out · /api/v1/housekeeping/tasks · /api/v1/housekeeping/tasks/{taskId} | Room · RoomBlock · HousekeepingTask | TC-FO-05 |
| BR-FO-07 | Phòng chưa DONE/INSPECTED không được giao cho khách khi check-in | FR-FO-05 | UC-PROP-03 · UC-FO-01 · UC-FO-03 | /api/v1/housekeeping/tasks/{taskId} | Property · Room · RoomBlock · HousekeepingTask | TC-FO-05 |

### 2.11. BR-CRM — Khách hàng (6 quy tắc)

| Mã BR | Tóm tắt quy tắc (≤ 12 từ) | FR | UC | API | Entity | TC |
|-------|---------------------------|----|----|-----|--------|----|
| BR-CRM-01 | Khách nhận diện duy nhất theo số điện thoại chuẩn hoá | FR-AUTH-07 · FR-CRM-01 | UC-AUTH-03 · UC-BOOK-01 · UC-BOOK-02 · UC-CHAN-03 · UC-FO-01 · UC-CRM-01 | /api/v1/guest-auth/register · /api/v1/guest-auth/login · /api/v1/guests | Guest · GuestNote · LoyaltyTransaction · Money · StayPeriod · DateRange · … | TC-CRM-01 |
| BR-CRM-02 | Hạng theo số đêm tích luỹ 12 tháng: MEMBER, SILVER, GOLD, PLATINUM | FR-CRM-02 | UC-CRM-02 | /api/v1/guests/{guestId}/loyalty | Guest · GuestNote · LoyaltyTransaction | TC-CRM-02 |
| BR-CRM-03 | Điểm thưởng 5% giá trị booking; 1 điểm = 1.000 VND | FR-CRM-03 | UC-CRM-02 | /api/v1/guests/{guestId}/loyalty | Booking · Guest · GuestNote · LoyaltyTransaction | TC-CRM-03 |
| BR-CRM-04 | Danh sách đen chặn tạo booking mới; MANAGER+ override có lý do | FR-CRM-04 | UC-BOOK-02 · UC-FO-01 · UC-CRM-03 | /api/v1/guests/{guestId}/blacklist | Booking · Guest · GuestNote · LoyaltyTransaction | TC-BOOK-12 |
| BR-CRM-05 | Hồ sơ khách không xoá cứng, chỉ ẩn danh hoá | FR-CRM-05 | UC-CRM-01 | /api/v1/guests/{guestId}/anonymize | Guest · GuestNote · LoyaltyTransaction | TC-CRM-04 · TC-CRM-05 |
| BR-CRM-06 | Booking huỷ/no-show không cộng điểm; đêm đã ở vẫn tính hạng | FR-CRM-06 | UC-FO-04 · UC-CRM-02 | /api/v1/guests/{guestId}/loyalty | Booking · Guest · GuestNote · LoyaltyTransaction | TC-CRM-03 |

### 2.12. BR-RBAC — Phân quyền (6 quy tắc)

| Mã BR | Tóm tắt quy tắc (≤ 12 từ) | FR | UC | API | Entity | TC |
|-------|---------------------------|----|----|-----|--------|----|
| BR-RBAC-01 | Sáu vai trò: OWNER, MANAGER, FRONT_DESK, RESERVATION_AGENT, ACCOUNTANT, HOUSEKEEPING | FR-AUTH-02 | UC-AUTH-01 · UC-AUTH-02 | /api/v1/users/{userId}/access | User · Notification · AuditLog · SystemSetting | — |
| BR-RBAC-02 | propertyScope giới hạn dữ liệu thấy và thao tác; OWNER toàn chuỗi | FR-AUTH-03 | UC-AUTH-01 · UC-AUTH-02 · UC-INV-01 · UC-BOOK-02 · UC-BOOK-07 · UC-FO-01 | /api/v1/users/{userId}/access · /api/v1/bookings · /api/v1/overbooking-cases | User · Notification · AuditLog · SystemSetting | TC-AUTH-04 · TC-AUTH-05 |
| BR-RBAC-03 | Quyền tối thiểu theo từng thao tác | FR-AUTH-04 | UC-AUTH-02 · UC-BOOK-02 · UC-PAY-04 · UC-FO-01 | /api/v1/overbooking-cases | User · Notification · AuditLog · SystemSetting | TC-PAY-16 · TC-PAY-20 · TC-AUTH-06 · TC-AUTH-07 · TC-AUTH-08 |
| BR-RBAC-04 | Thay đổi giá vượt ±20% cần OWNER xác nhận lại | FR-AUTH-05 | UC-RATE-01 | /api/v1/room-types/{roomTypeId}/rate-calendar | User · Notification · AuditLog · SystemSetting | TC-AUTH-09 |
| BR-RBAC-05 | Phiên quản trị 15 phút; Android 7 ngày, tài chính cần PIN | FR-AUTH-01 | UC-AUTH-01 · UC-FO-01 | /api/v1/auth/refresh · /api/v1/auth/pin/verify | User · Notification · AuditLog · SystemSetting | TC-FO-06 · TC-AUTH-02 · TC-AUTH-03 |
| BR-RBAC-06 | Đăng nhập sai 5 lần liên tiếp khoá tài khoản 15 phút | FR-AUTH-06 | UC-AUTH-01 | /api/v1/auth/login | User · Notification · AuditLog · SystemSetting | TC-AUTH-01 |

### 2.13. BR-SYS — Nền tảng & tuân thủ (6 quy tắc)

| Mã BR | Tóm tắt quy tắc (≤ 12 từ) | FR | UC | API | Entity | TC |
|-------|---------------------------|----|----|-----|--------|----|
| BR-SYS-01 | AuditLog append-only, thu hồi UPDATE/DELETE ở tầng CSDL | FR-SYS-02 | UC-SYS-01 | /api/v1/audit-logs | User · Notification · AuditLog · SystemSetting | TC-SYS-01 |
| BR-SYS-02 | Tham số nghiệp vụ đọc từ SystemSetting, đổi không cần triển khai | FR-PAY-10 · FR-SYS-03 | UC-BOOK-04 · UC-PAY-04 · UC-SYS-02 | /api/v1/inventory/availability · /api/v1/quotes · /api/v1/holds · /api/v1/refund-requests/{refundRequestId}/approve · /api/v1/overbooking-cases · /api/v1/system-settings/{key} | Channel · Booking · Hold · User · Notification · AuditLog · … | TC-BOOK-25 · TC-PAY-16 · TC-PAY-19 · TC-RATE-04 · TC-RATE-07 · TC-RATE-09 · … |
| BR-SYS-03 | Sao lưu PITR, RPO ≤ 15 phút, RTO ≤ 4 giờ | FR-SYS-04 | UC-SYS-03 | /api/v1/system/backups · /api/v1/system/backups/{backupId}/restore | — | TC-SYS-07 |
| BR-SYS-04 | Lưu booking và thanh toán 10 năm, nhật ký 5 năm | FR-SYS-05 | UC-AUTH-03 · UC-PAY-05 · UC-CRM-01 · UC-SYS-02 · UC-SYS-03 | — | Booking · Payment · AuditLog | TC-SYS-08 |
| BR-SYS-05 | AuditLog ghi ai, làm gì, đối tượng, trước/sau, lý do, IP | FR-SYS-01 | UC-SYS-01 | /api/v1/refund-requests/{refundRequestId}/approve · /api/v1/guests/{guestId}/blacklist · /api/v1/audit-logs | User · Notification · AuditLog · SystemSetting | TC-PAY-18 · TC-SYS-02 · TC-SYS-04 · TC-SYS-05 |
| BR-SYS-06 | Thông báo ghi Notification; gửi lại tối đa 3 lần | FR-NOTI-01 · FR-NOTI-02 · FR-NOTI-03 · FR-NOTI-04 | UC-OVER-02 · UC-BOOK-01 · UC-BOOK-04 · UC-BOOK-08 · UC-PAY-02 · UC-OVER-03 · … | /api/v1/notifications · /api/v1/notifications/{notificationId}/resend | User · Notification · AuditLog · SystemSetting | TC-BOOK-23 · TC-PAY-11 · TC-BOOK-16 · TC-NOTI-01 · TC-NOTI-02 |

### 2.14. BR-REP — Định nghĩa chỉ số báo cáo (1 quy tắc)

| Mã BR | Tóm tắt quy tắc (≤ 12 từ) | FR | UC | API | Entity | TC |
|-------|---------------------------|----|----|-----|--------|----|
| BR-REP-01 | Định nghĩa ADR, RevPAR, công suất, tỷ lệ huỷ | FR-REP-01 · FR-REP-07 | UC-REP-01 · UC-REP-02 · UC-REP-03 · UC-REP-04 | /api/v1/reports/occupancy · /api/v1/reports/adr-revpar · /api/v1/reports/cancellations · /api/v1/reports/overbooking | RoomBlock · Booking · RoomMove · RoomMerge · Payment · IdempotencyKey | TC-REP-01 · TC-REP-03 · TC-CANCEL-50 · TC-CANCEL-52 |

## 3. Thống kê độ phủ

Đếm theo nhóm BR: một quy tắc được coi là **có phủ** khi ô tương ứng ở §2 khác `—`.

| Nhóm BR | Số BR | ≥ 1 FR | ≥ 1 UC | ≥ 1 API | ≥ 1 Entity | ≥ 1 TC | Bài toán |
|---------|-------|--------|--------|---------|------------|--------|----------|
| BR-GEN | 8 | 8 | 8 | 4 | 7 | 6 | Nền tảng chung |
| BR-PROP | 6 | 6 | 6 | 6 | 6 | 6 | — |
| BR-INV | 7 | 7 | 7 | 7 | 7 | 7 | BT-3 |
| BR-RATE | 19 | 19 | 19 | 19 | 19 | 19 | BT-2 |
| BR-BOOK | 17 | 17 | 17 | 17 | 17 | 17 | BT-1, BT-3 |
| BR-CANCEL | 19 | 19 | 19 | 19 | 19 | 19 | BT-1 |
| BR-PAY | 10 | 10 | 10 | 10 | 10 | 10 | BT-1 |
| BR-CHAN | 8 | 8 | 8 | 8 | 8 | 8 | BT-3 |
| BR-OVER | 16 | 16 | 16 | 16 | 16 | 16 | BT-3 |
| BR-FO | 7 | 7 | 7 | 7 | 7 | 7 | — |
| BR-CRM | 6 | 6 | 6 | 6 | 6 | 6 | — |
| BR-RBAC | 6 | 6 | 6 | 6 | 6 | 5 | — |
| BR-SYS | 6 | 6 | 6 | 5 | 5 | 6 | — |
| BR-REP | 1 | 1 | 1 | 1 | 1 | 1 | — |
| **Tổng** | **136** | **136** | **136** | **131** | **134** | **133** | |

**Kết luận.** Trong 136 quy tắc: **toàn bộ 136** quy tắc có ≥ 1 FR và ≥ 1 UC; cột endpoint còn ô `—` ở **5** quy tắc, cột thực thể ở **2** quy tắc, cột ca kiểm thử ở **3** quy tắc (đối chiếu dòng **Tổng** của bảng trên và danh sách đầy đủ ở §6). Nhóm `BR-GEN` là nhóm duy nhất chưa đủ ở cả ba cột — đúng với bản chất quy tắc nền áp xuyên suốt hệ thống.

Như vậy còn **3 BR chưa có ca kiểm thử**: BR-GEN-02, BR-GEN-05, BR-RBAC-01 — kỳ vọng là **0** vì `TC-SYS-06` (script đối chiếu BR ↔ TC chạy trong CI, gắn với RSK-19) chặn ma trận có ô trống. Cả ba đều **không phải quy tắc rủi ro cao**: chúng là quy tắc nền về múi giờ và quy tắc liệt kê vai trò. Việc cần làm để đưa về 0 nêu ở §6 — chỉ cần **bổ sung mã BR vào ô "Mã BR" của ca đã tồn tại**, không cần viết ca mới:

| BR chưa có TC | Ca đã kiểm chứng hành vi tương đương | Việc cần làm |
|---------------|--------------------------------------|--------------|
| BR-RBAC-01 | `TC-AUTH-08` (sáu vai trò × 8 thao tác trong bảng quyền) | Bổ sung `BR-RBAC-01` vào cột *Mã BR* của `TC-AUTH-08` |
| BR-GEN-02 | `TC-BOOK-21`, `TC-CANCEL-35…43` (biên múi giờ UTC ↔ giờ VN) | Bổ sung `BR-GEN-02` vào cột *Mã BR* của `TC-BOOK-21` |
| BR-GEN-05 | `TC-BOOK-21`, `TC-CANCEL-35…43` (biên múi giờ UTC ↔ giờ VN) | Bổ sung `BR-GEN-05` vào cột *Mã BR* của `TC-BOOK-21` |

Đối chiếu phạm vi mã: 136 mã BR đúng bằng cột *Số lượng* của bảng §14 cộng thêm quy tắc `BR-REP-01` ở §15 (8+6+7+19+17+19+10+8+16+7+6+6+6 quy tắc trong 13 nhóm, cộng 1 quy tắc nhóm BR-REP).

---

## 4. Truy vết ngược

### 4.1. Use case → BR (đủ 52 UC)

Mỗi dòng liệt kê **mọi** quy tắc mà use case đó thực hiện, hợp nhất từ cột *BR chính* (§4) và dòng *BR áp dụng* (§6) của [01/mô hình use case](../01-yeu-cau/mo-hinh-use-case.md). Tên UC giữ nguyên theo [00 §8](../00-tong-quan.md#8-danh-mục-use-case).

| # | Mã UC | Tên use case | BR thực hiện | Số BR |
|---|-------|--------------|--------------|-------|
| 1 | UC-OVER-02 | Đổi phòng / nâng hạng cho khách | BR-GEN-07 · BR-PROP-04 · BR-PROP-06 · BR-INV-03 · BR-CANCEL-14 · BR-CHAN-06 · BR-OVER-06 · BR-OVER-07 · BR-OVER-08 · BR-OVER-09 · BR-OVER-10 · BR-OVER-11 · BR-OVER-12 · BR-SYS-06 | 14 |
| 2 | UC-AUTH-01 | Đăng nhập hệ thống | BR-RBAC-01 · BR-RBAC-02 · BR-RBAC-05 · BR-RBAC-06 | 4 |
| 3 | UC-AUTH-02 | Quản lý người dùng & vai trò | BR-RBAC-01 · BR-RBAC-02 · BR-RBAC-03 | 3 |
| 4 | UC-AUTH-03 | Đăng ký & đăng nhập khách hàng | BR-GEN-08 · BR-CRM-01 · BR-SYS-04 | 3 |
| 5 | UC-PROP-01 | Quản lý cơ sở | BR-PROP-01 · BR-PROP-02 · BR-INV-06 | 3 |
| 6 | UC-PROP-02 | Quản lý loại phòng | BR-PROP-03 · BR-PROP-04 · BR-RATE-03 · BR-RATE-04 | 4 |
| 7 | UC-PROP-03 | Quản lý phòng & sơ đồ buồng | BR-PROP-05 · BR-PROP-06 · BR-FO-07 | 3 |
| 8 | UC-PROP-04 | Khoá phòng bảo trì / ngừng bán | BR-GEN-07 · BR-PROP-06 · BR-INV-06 | 3 |
| 9 | UC-INV-01 | Xem lịch tồn phòng (grid theo ngày) | BR-INV-01 · BR-INV-07 · BR-RBAC-02 | 3 |
| 10 | UC-INV-02 | Kiểm tra phòng trống & báo giá | BR-INV-01 · BR-INV-02 · BR-INV-07 · BR-RATE-17 | 4 |
| 11 | UC-INV-03 | Quản lý allotment theo kênh | BR-INV-05 · BR-CHAN-01 · BR-CHAN-08 | 3 |
| 12 | UC-RATE-01 | Cấu hình gói giá, chính sách huỷ, giá cơ bản & lịch giá | BR-RATE-02 · BR-RATE-03 · BR-RATE-04 · BR-RATE-19 · BR-RBAC-04 | 5 |
| 13 | UC-RATE-02 | Cấu hình mùa & hệ số mùa | BR-RATE-05 · BR-RATE-06 | 2 |
| 14 | UC-RATE-03 | Cấu hình hệ số & hoa hồng theo kênh | BR-RATE-07 · BR-RATE-09 · BR-RATE-18 · BR-CHAN-06 | 4 |
| 15 | UC-RATE-04 | Quản lý khuyến mãi | BR-RATE-10 · BR-RATE-11 · BR-RATE-12 · BR-RATE-13 · BR-RATE-14 | 5 |
| 16 | UC-RATE-05 | Xem trước báo giá đa kênh | BR-RATE-01 · BR-RATE-08 · BR-RATE-15 · BR-RATE-17 | 4 |
| 17 | UC-BOOK-01 | Tạo đặt phòng trên web | BR-GEN-01 · BR-GEN-03 · BR-GEN-06 · BR-GEN-08 · BR-INV-01 · BR-INV-02 · BR-INV-03 · BR-INV-07 · BR-RATE-01 · BR-RATE-10 · BR-RATE-11 · BR-RATE-12 · BR-RATE-13 · BR-RATE-14 · BR-RATE-15 · BR-RATE-16 · BR-RATE-17 · BR-BOOK-01 · BR-BOOK-02 · BR-BOOK-03 · BR-BOOK-04 · BR-BOOK-05 · BR-BOOK-07 · BR-BOOK-08 · BR-BOOK-09 · BR-BOOK-10 · BR-BOOK-15 · BR-BOOK-16 · BR-CHAN-06 · BR-CRM-01 · BR-SYS-06 | 31 |
| 18 | UC-BOOK-02 | Tạo đặt phòng tại quầy (khách vãng lai) | BR-GEN-06 · BR-GEN-07 · BR-GEN-08 · BR-RATE-03 · BR-RATE-04 · BR-RATE-07 · BR-RATE-16 · BR-BOOK-01 · BR-BOOK-02 · BR-BOOK-03 · BR-BOOK-04 · BR-BOOK-05 · BR-BOOK-09 · BR-BOOK-10 · BR-BOOK-16 · BR-PAY-01 · BR-PAY-02 · BR-PAY-06 · BR-CRM-01 · BR-CRM-04 · BR-RBAC-02 · BR-RBAC-03 | 22 |
| 19 | UC-BOOK-03 | Tạo đặt phòng qua điện thoại | BR-RATE-07 · BR-BOOK-01 · BR-BOOK-07 · BR-BOOK-09 | 4 |
| 20 | UC-BOOK-04 | Giữ chỗ tạm thời và tự động hết hạn | BR-GEN-07 · BR-INV-02 · BR-INV-03 · BR-INV-04 · BR-INV-07 · BR-BOOK-07 · BR-BOOK-08 · BR-PAY-05 · BR-CHAN-02 · BR-CHAN-06 · BR-SYS-02 · BR-SYS-06 | 12 |
| 21 | UC-BOOK-05 | Sửa đổi đặt phòng | BR-BOOK-10 · BR-BOOK-13 · BR-BOOK-14 · BR-BOOK-17 | 4 |
| 22 | UC-BOOK-06 | Đổi ngày lưu trú (reschedule) | BR-GEN-07 · BR-INV-02 · BR-INV-03 · BR-INV-07 · BR-RATE-01 · BR-RATE-16 · BR-RATE-17 · BR-BOOK-03 · BR-BOOK-12 · BR-BOOK-13 · BR-CANCEL-08 · BR-PAY-02 · BR-CHAN-06 | 13 |
| 23 | UC-BOOK-07 | Tra cứu & xem chi tiết đặt phòng | BR-GEN-06 · BR-BOOK-06 · BR-RBAC-02 | 3 |
| 24 | UC-BOOK-08 | Huỷ đặt phòng (toàn phần hoặc một phần) & tính hoàn cọc | BR-GEN-04 · BR-GEN-05 · BR-GEN-07 · BR-GEN-08 · BR-BOOK-11 · BR-BOOK-13 · BR-BOOK-14 · BR-BOOK-17 · BR-CANCEL-01 · BR-CANCEL-02 · BR-CANCEL-03 · BR-CANCEL-04 · BR-CANCEL-05 · BR-CANCEL-06 · BR-CANCEL-07 · BR-CANCEL-09 · BR-CANCEL-10 · BR-CANCEL-13 · BR-CANCEL-14 · BR-CANCEL-16 · BR-CANCEL-17 · BR-CANCEL-19 · BR-PAY-02 · BR-PAY-07 · BR-PAY-09 · BR-CHAN-04 · BR-CHAN-06 · BR-SYS-06 | 28 |
| 25 | UC-PAY-01 | Ghi nhận tiền cọc | BR-PAY-01 · BR-PAY-02 · BR-PAY-06 · BR-PAY-10 | 4 |
| 26 | UC-PAY-02 | Thanh toán trực tuyến qua cổng thanh toán | BR-GEN-08 · BR-BOOK-09 · BR-PAY-01 · BR-PAY-02 · BR-PAY-03 · BR-PAY-04 · BR-PAY-05 · BR-CHAN-06 · BR-SYS-06 | 9 |
| 27 | UC-PAY-03 | Thu số dư khi check-in | BR-PAY-02 · BR-PAY-06 · BR-FO-01 | 3 |
| 28 | UC-PAY-04 | Duyệt và chi hoàn tiền | BR-GEN-07 · BR-GEN-08 · BR-CANCEL-05 · BR-CANCEL-11 · BR-CANCEL-12 · BR-CANCEL-13 · BR-CANCEL-15 · BR-CANCEL-16 · BR-CANCEL-17 · BR-CANCEL-18 · BR-CANCEL-19 · BR-PAY-07 · BR-PAY-08 · BR-PAY-09 · BR-PAY-10 · BR-RBAC-03 | 16 |
| 29 | UC-PAY-05 | Đối soát doanh thu, hoa hồng & công nợ | BR-RATE-08 · BR-RATE-09 · BR-PAY-06 · BR-PAY-10 · BR-SYS-04 | 5 |
| 30 | UC-CHAN-01 | Cấu hình kênh bán | BR-RATE-07 · BR-CHAN-01 · BR-CHAN-05 | 3 |
| 31 | UC-CHAN-02 | Đồng bộ tồn phòng & giá lên OTA | BR-CHAN-02 · BR-CHAN-06 · BR-CHAN-07 | 3 |
| 32 | UC-CHAN-03 | Nhận đặt phòng từ OTA | BR-GEN-02 · BR-GEN-07 · BR-GEN-08 · BR-INV-01 · BR-INV-02 · BR-INV-07 · BR-RATE-08 · BR-BOOK-01 · BR-BOOK-09 · BR-BOOK-16 · BR-CHAN-01 · BR-CHAN-02 · BR-CHAN-03 · BR-CHAN-04 · BR-CHAN-06 · BR-CHAN-07 · BR-CHAN-08 · BR-OVER-01 · BR-OVER-02 · BR-OVER-03 · BR-CRM-01 | 21 |
| 33 | UC-OVER-01 | Phát hiện & cảnh báo nguy cơ quá tải | BR-PROP-06 · BR-INV-01 · BR-INV-06 · BR-CHAN-03 · BR-OVER-01 · BR-OVER-02 · BR-OVER-03 · BR-OVER-04 · BR-OVER-05 · BR-OVER-11 · BR-OVER-12 · BR-OVER-16 | 12 |
| 34 | UC-OVER-03 | Ghép phòng cho hai booking | BR-GEN-07 · BR-PROP-04 · BR-INV-03 · BR-BOOK-04 · BR-OVER-08 · BR-OVER-10 · BR-OVER-11 · BR-OVER-13 · BR-OVER-14 · BR-OVER-15 · BR-SYS-06 | 11 |
| 35 | UC-OVER-04 | Walk-out và bồi thường khách | BR-CANCEL-14 · BR-OVER-06 · BR-OVER-11 | 3 |
| 36 | UC-OVER-05 | Duyệt ngoại lệ chính sách (bất khả kháng, hoàn 100%) | BR-CANCEL-13 · BR-CANCEL-15 · BR-OVER-07 | 3 |
| 37 | UC-FO-01 | Check-in khách | BR-GEN-07 · BR-PROP-06 · BR-INV-03 · BR-PAY-02 · BR-PAY-06 · BR-OVER-08 · BR-OVER-11 · BR-FO-01 · BR-FO-02 · BR-FO-04 · BR-FO-06 · BR-FO-07 · BR-CRM-01 · BR-CRM-04 · BR-RBAC-02 · BR-RBAC-03 · BR-RBAC-05 · BR-SYS-06 | 18 |
| 38 | UC-FO-02 | Check-out, trả phòng sớm & thu phát sinh | BR-CANCEL-09 · BR-FO-03 · BR-FO-05 · BR-FO-06 | 4 |
| 39 | UC-FO-03 | Cập nhật trạng thái buồng phòng | BR-FO-06 · BR-FO-07 | 2 |
| 40 | UC-FO-04 | Ghi nhận khách không đến (no-show) | BR-BOOK-06 · BR-CANCEL-10 · BR-CRM-06 | 3 |
| 41 | UC-CRM-01 | Quản lý hồ sơ khách | BR-CRM-01 · BR-CRM-05 · BR-SYS-04 | 3 |
| 42 | UC-CRM-02 | Tích điểm & phân hạng khách hàng | BR-CRM-02 · BR-CRM-03 · BR-CRM-06 | 3 |
| 43 | UC-CRM-03 | Quản lý danh sách đen | BR-BOOK-15 · BR-CRM-04 | 2 |
| 44 | UC-NOTI-01 | Gửi xác nhận đặt phòng & nhắc hẹn | BR-GEN-07 · BR-SYS-06 | 2 |
| 45 | UC-NOTI-02 | Thông báo thay đổi, huỷ, hoàn tiền | BR-CANCEL-12 · BR-OVER-10 · BR-SYS-06 | 3 |
| 46 | UC-REP-01 | Báo cáo công suất, ADR, RevPAR | BR-INV-01 · BR-RATE-08 · BR-REP-01 | 3 |
| 47 | UC-REP-02 | Báo cáo doanh thu theo kênh | BR-RATE-08 · BR-PAY-10 · BR-REP-01 | 3 |
| 48 | UC-REP-03 | Báo cáo huỷ phòng & hoàn cọc | BR-CANCEL-04 · BR-CANCEL-05 · BR-CANCEL-13 · BR-PAY-07 · BR-REP-01 | 5 |
| 49 | UC-REP-04 | Báo cáo quá tải & điều chuyển phòng | BR-CANCEL-14 · BR-OVER-04 · BR-OVER-06 · BR-OVER-15 · BR-REP-01 | 5 |
| 50 | UC-SYS-01 | Xem nhật ký kiểm toán | BR-GEN-07 · BR-SYS-01 · BR-SYS-05 | 3 |
| 51 | UC-SYS-02 | Cấu hình tham số hệ thống | BR-CANCEL-11 · BR-SYS-02 | 2 |
| 52 | UC-SYS-03 | Sao lưu & phục hồi dữ liệu | BR-SYS-03 · BR-SYS-04 | 2 |

**Kiểm tra:** 52/52 use case có ≥ 1 mã BR thật; 0 UC rỗng.

### 4.2. Thực thể → BR (các thực thể chính ở [00 §7](../00-tong-quan.md#7-từ-điển-thực-thể-nguồn-chân-lý-về-định-danh))

| Thực thể | BR liên quan | Số BR |
|----------|--------------|-------|
| `Property` | BR-GEN-04 · BR-GEN-05 · BR-PROP-01 · BR-PROP-02 · BR-OVER-01 · BR-OVER-02 · BR-FO-07 | 7 |
| `RoomType` | BR-PROP-03 · BR-PROP-04 · BR-INV-05 · BR-RATE-01 · BR-RATE-02 · BR-RATE-03 · BR-RATE-04 · BR-BOOK-04 · BR-CHAN-01 | 9 |
| `Room` | BR-PROP-05 · BR-PROP-06 · BR-INV-01 · BR-INV-03 · BR-INV-07 · BR-OVER-13 · BR-OVER-14 · BR-FO-06 · BR-FO-07 | 9 |
| `RoomBlock` | BR-PROP-06 · BR-INV-01 · BR-INV-05 · BR-INV-06 · BR-INV-07 · BR-CHAN-05 · BR-FO-06 · BR-FO-07 · BR-REP-01 | 9 |
| `HousekeepingTask` | BR-PROP-06 · BR-INV-01 · BR-INV-06 · BR-FO-06 · BR-FO-07 | 5 |
| `RatePlan` | BR-RATE-01 · BR-RATE-19 · BR-BOOK-03 · BR-BOOK-12 · BR-CANCEL-01 · BR-CANCEL-02 · BR-CANCEL-07 | 7 |
| `RateCalendar` | BR-RATE-01 · BR-RATE-02 · BR-RATE-03 · BR-RATE-04 · BR-RATE-05 · BR-RATE-06 · BR-RATE-19 | 7 |
| `Season` | BR-RATE-01 · BR-RATE-02 · BR-RATE-03 · BR-RATE-04 · BR-RATE-05 · BR-RATE-06 · BR-RATE-19 | 7 |
| `Channel` | BR-RATE-07 · BR-RATE-08 · BR-RATE-09 · BR-RATE-18 · BR-BOOK-07 · BR-CHAN-01 · BR-CHAN-03 · BR-CHAN-05 · BR-CHAN-07 · BR-CHAN-08 · BR-SYS-02 | 11 |
| `ChannelPropertySetting` | BR-RATE-07 · BR-RATE-08 · BR-RATE-09 · BR-RATE-18 · BR-BOOK-07 · BR-CHAN-01 · BR-CHAN-03 · BR-CHAN-05 · BR-CHAN-07 · BR-CHAN-08 | 10 |
| `ChannelAllotment` | BR-INV-01 · BR-INV-05 · BR-INV-07 · BR-CHAN-01 · BR-CHAN-08 | 5 |
| `Promotion` | BR-RATE-10 · BR-RATE-11 · BR-RATE-12 · BR-RATE-13 · BR-RATE-14 | 5 |
| `PriceQuote` | BR-RATE-01 · BR-RATE-12 · BR-RATE-15 · BR-RATE-16 · BR-RATE-17 · BR-CANCEL-06 | 6 |
| `ChannelMapping` | BR-RATE-07 · BR-RATE-08 · BR-RATE-09 · BR-RATE-18 · BR-BOOK-07 · BR-CHAN-01 · BR-CHAN-03 · BR-CHAN-05 · BR-CHAN-07 · BR-CHAN-08 | 10 |
| `OccupancySnapshot` | BR-RATE-01 | 1 |
| `Booking` | BR-GEN-06 · BR-GEN-07 · BR-INV-05 · BR-INV-06 · BR-RATE-07 · BR-RATE-08 · BR-RATE-13 · BR-RATE-16 · BR-BOOK-01 · BR-BOOK-02 · BR-BOOK-03 · BR-BOOK-04 · BR-BOOK-05 · BR-BOOK-06 · BR-BOOK-07 · BR-BOOK-08 · BR-BOOK-09 · BR-BOOK-10 · BR-BOOK-11 · BR-BOOK-12 · BR-BOOK-13 · BR-BOOK-14 · BR-BOOK-15 · BR-BOOK-16 · BR-BOOK-17 · BR-CANCEL-03 · BR-CANCEL-10 · BR-CANCEL-17 · BR-CANCEL-18 · BR-CANCEL-19 · BR-PAY-01 · BR-PAY-02 · BR-PAY-07 · BR-CHAN-03 · BR-CHAN-04 · BR-OVER-02 · BR-OVER-03 · BR-OVER-11 · BR-OVER-12 · BR-OVER-13 · BR-FO-01 · BR-FO-02 · BR-FO-03 · BR-FO-04 · BR-FO-05 · BR-CRM-03 · BR-CRM-04 · BR-CRM-06 · BR-SYS-02 · BR-SYS-04 · BR-REP-01 | 51 |
| `BookingRoom` | BR-BOOK-04 · BR-BOOK-10 · BR-CANCEL-19 | 3 |
| `RoomAssignment` | BR-INV-01 · BR-INV-02 · BR-INV-03 · BR-INV-04 · BR-INV-06 · BR-INV-07 · BR-BOOK-07 · BR-BOOK-08 · BR-BOOK-10 · BR-BOOK-11 · BR-CANCEL-19 · BR-PAY-05 · BR-OVER-08 | 13 |
| `BookingStatusHistory` | BR-BOOK-06 | 1 |
| `PriceSnapshot` | BR-RATE-12 · BR-RATE-15 · BR-RATE-16 · BR-RATE-17 · BR-RATE-18 · BR-BOOK-12 · BR-CANCEL-06 · BR-CANCEL-09 · BR-CANCEL-19 | 9 |
| `Hold` | BR-INV-01 · BR-INV-02 · BR-INV-03 · BR-INV-04 · BR-INV-07 · BR-BOOK-07 · BR-BOOK-08 · BR-BOOK-10 · BR-BOOK-11 · BR-PAY-05 · BR-OVER-08 · BR-SYS-02 | 12 |
| `OverbookingCase` | BR-INV-06 · BR-CHAN-03 · BR-OVER-03 · BR-OVER-04 · BR-OVER-05 · BR-OVER-16 | 6 |
| `RoomMove` | BR-GEN-07 · BR-CANCEL-14 · BR-OVER-06 · BR-OVER-07 · BR-OVER-08 · BR-OVER-09 · BR-OVER-10 · BR-OVER-11 · BR-OVER-12 · BR-OVER-13 · BR-OVER-14 · BR-OVER-15 · BR-OVER-16 · BR-REP-01 | 14 |
| `RoomMerge` | BR-CANCEL-14 · BR-OVER-06 · BR-OVER-07 · BR-OVER-08 · BR-OVER-09 · BR-OVER-10 · BR-OVER-11 · BR-OVER-12 · BR-OVER-13 · BR-OVER-14 · BR-OVER-15 · BR-OVER-16 · BR-REP-01 | 13 |
| `Payment` | BR-GEN-01 · BR-GEN-03 · BR-GEN-07 · BR-GEN-08 · BR-BOOK-09 · BR-CANCEL-06 · BR-CANCEL-16 · BR-PAY-01 · BR-PAY-02 · BR-PAY-03 · BR-PAY-04 · BR-PAY-05 · BR-PAY-06 · BR-PAY-07 · BR-PAY-08 · BR-PAY-09 · BR-PAY-10 · BR-SYS-04 · BR-REP-01 | 19 |
| `RefundRequest` | BR-GEN-07 · BR-BOOK-14 · BR-CANCEL-04 · BR-CANCEL-05 · BR-CANCEL-08 · BR-CANCEL-09 · BR-CANCEL-11 · BR-CANCEL-12 · BR-CANCEL-13 · BR-CANCEL-14 · BR-CANCEL-15 · BR-CANCEL-16 · BR-CANCEL-17 · BR-CANCEL-18 · BR-CANCEL-19 · BR-PAY-07 · BR-PAY-08 · BR-PAY-09 · BR-CHAN-04 | 19 |
| `CancellationPolicy` | BR-CANCEL-01 · BR-CANCEL-03 · BR-CANCEL-05 · BR-CANCEL-06 · BR-CANCEL-07 | 5 |
| `CancellationTier` | BR-CANCEL-01 · BR-CANCEL-03 · BR-CANCEL-05 · BR-CANCEL-06 · BR-CANCEL-07 | 5 |
| `Guest` | BR-BOOK-15 · BR-OVER-11 · BR-OVER-13 · BR-CRM-01 · BR-CRM-02 · BR-CRM-03 · BR-CRM-04 · BR-CRM-05 · BR-CRM-06 | 9 |
| `GuestNote` | BR-BOOK-15 · BR-OVER-11 · BR-CRM-01 · BR-CRM-02 · BR-CRM-03 · BR-CRM-04 · BR-CRM-05 · BR-CRM-06 | 8 |
| `LoyaltyTransaction` | BR-BOOK-15 · BR-OVER-11 · BR-CRM-01 · BR-CRM-02 · BR-CRM-03 · BR-CRM-04 · BR-CRM-05 · BR-CRM-06 | 8 |
| `User` | BR-GEN-07 · BR-CANCEL-11 · BR-OVER-10 · BR-RBAC-01 · BR-RBAC-02 · BR-RBAC-03 · BR-RBAC-04 · BR-RBAC-05 · BR-RBAC-06 · BR-SYS-01 · BR-SYS-02 · BR-SYS-05 · BR-SYS-06 | 13 |
| `Notification` | BR-GEN-07 · BR-CANCEL-11 · BR-OVER-10 · BR-RBAC-01 · BR-RBAC-02 · BR-RBAC-03 · BR-RBAC-04 · BR-RBAC-05 · BR-RBAC-06 · BR-SYS-01 · BR-SYS-02 · BR-SYS-05 · BR-SYS-06 | 13 |
| `AuditLog` | BR-GEN-07 · BR-RATE-05 · BR-RATE-18 · BR-BOOK-12 · BR-BOOK-17 · BR-CANCEL-11 · BR-CANCEL-16 · BR-OVER-10 · BR-FO-01 · BR-RBAC-01 · BR-RBAC-02 · BR-RBAC-03 · BR-RBAC-04 · BR-RBAC-05 · BR-RBAC-06 · BR-SYS-01 · BR-SYS-02 · BR-SYS-04 · BR-SYS-05 · BR-SYS-06 | 20 |
| `SystemSetting` | BR-GEN-07 · BR-RATE-01 · BR-CANCEL-11 · BR-OVER-10 · BR-RBAC-01 · BR-RBAC-02 · BR-RBAC-03 · BR-RBAC-04 · BR-RBAC-05 · BR-RBAC-06 · BR-SYS-01 · BR-SYS-02 · BR-SYS-05 · BR-SYS-06 | 14 |
| `OutboxEvent` | BR-CHAN-02 · BR-CHAN-06 · BR-CHAN-07 | 3 |
| `IdempotencyKey` | BR-GEN-01 · BR-GEN-03 · BR-GEN-08 · BR-BOOK-09 · BR-CANCEL-06 · BR-CANCEL-16 · BR-PAY-01 · BR-PAY-02 · BR-PAY-03 · BR-PAY-04 · BR-PAY-05 · BR-PAY-06 · BR-PAY-07 · BR-PAY-08 · BR-PAY-09 · BR-PAY-10 · BR-REP-01 | 17 |
| `Money` | BR-GEN-01 · BR-GEN-03 · BR-GEN-04 · BR-INV-03 · BR-BOOK-02 · BR-BOOK-03 · BR-CRM-01 | 7 |
| `StayPeriod` | BR-GEN-01 · BR-GEN-03 · BR-GEN-04 · BR-INV-03 · BR-BOOK-02 · BR-BOOK-03 · BR-CRM-01 | 7 |
| `DateRange` | BR-GEN-01 · BR-GEN-03 · BR-GEN-04 · BR-INV-03 · BR-BOOK-02 · BR-BOOK-03 · BR-CRM-01 | 7 |
| `CancellationTierRule` | BR-CANCEL-01 · BR-CANCEL-03 | 2 |
| `ChannelContext` | BR-GEN-01 · BR-GEN-03 · BR-GEN-04 · BR-INV-03 · BR-BOOK-02 · BR-BOOK-03 · BR-CRM-01 | 7 |
| `PhoneNumber` | BR-GEN-01 · BR-GEN-03 · BR-GEN-04 · BR-INV-03 · BR-BOOK-02 · BR-BOOK-03 · BR-CRM-01 | 7 |

> Năm giá trị miền `Money`, `StayPeriod`, `DateRange`, `ChannelContext`, `PhoneNumber` nằm chung **một dòng** trong bảng nguồn [03/mô hình miền](../03-phan-tich/mo-hinh-mien.md) §8 nên danh sách BR của chúng trùng nhau theo dòng đó. `CancellationTierRule` không có dòng riêng trong §8; quan hệ của nó với `BR-CANCEL-01` và `BR-CANCEL-03` lấy từ quyết định tách thực thể/VO ở [03/mô hình miền](../03-phan-tich/mo-hinh-mien.md) §7.

**Không thực thể nào rỗng:** cả 43 tên trong [00 §7](../00-tong-quan.md#7-từ-điển-thực-thể-nguồn-chân-lý-về-định-danh) đều truy được về ít nhất một quy tắc.

---

## 5. Truy vết ba bài toán trọng tâm

Ba bài toán ở [00 §2](../00-tong-quan.md#2-ba-bài-toán-nghiệp-vụ-trọng-tâm) là điểm khó chủ đầu tư nêu trực tiếp. Mỗi bảng dưới đây giới hạn ở các quy tắc **trực tiếp** giải bài toán đó; định nghĩa tập hàng ghi ngay dưới tiêu đề từng bảng.

### 5.1. BT-1 — Chính sách huỷ và hoàn cọc theo mốc thời gian (36 quy tắc)

Nhóm BR-CANCEL và BR-PAY (bảng §14 ghi BT-1), cộng các quy tắc vòng đời huỷ/đổi ngày ở BR-BOOK (BR-BOOK-11…14, BR-BOOK-17; §14 ghi BR-BOOK là BT-1 + BT-3) và hai quy tắc nền trực tiếp quyết định số tiền hoàn: BR-GEN-03 (chiều làm tròn) và BR-GEN-04 (thời điểm nhận phòng danh nghĩa để tính hoursBeforeCheckIn).

| Mã BR | Tóm tắt | UC | API | Entity | TC |
|-------|---------|----|-----|--------|----|
| BR-CANCEL-01 | Mức hoàn chọn theo bậc dữ liệu hoá; bậc −1 bắt tất | UC-BOOK-08 | /api/v1/bookings/{bookingId}/cancel-preview · /api/v1/bookings/{bookingId}/cancel · /api/v1/refund-requests · /api/v1/reports/cancellations | RatePlan · CancellationPolicy · CancellationTier · CancellationTierRule | TC-BOOK-23 · TC-BOOK-25 · TC-CANCEL-01 · TC-CANCEL-02 · TC-CANCEL-03 · TC-CANCEL-04 · … |
| BR-CANCEL-02 | Tỷ lệ cọc theo gói giá, làm tròn lên bội 1.000 | UC-BOOK-08 · UC-PAY-01 | /api/v1/bookings/{bookingId}/cancel-preview · /api/v1/bookings/{bookingId}/cancel · /api/v1/refund-requests · /api/v1/reports/cancellations | RatePlan | TC-BOOK-23 · TC-PAY-01 · TC-CANCEL-01 · TC-CANCEL-02 · TC-CANCEL-03 · TC-CANCEL-04 · … |
| BR-CANCEL-03 | hoursBeforeCheckIn tính từ thời điểm nhận phòng danh nghĩa | UC-BOOK-08 | /api/v1/bookings/{bookingId}/cancel-preview · /api/v1/bookings/{bookingId}/cancel · /api/v1/refund-requests | Booking · CancellationPolicy · CancellationTier · CancellationTierRule | TC-BOOK-23 · TC-CANCEL-15 · TC-CANCEL-35 · TC-CANCEL-36 · TC-CANCEL-37 · TC-CANCEL-38 · … |
| BR-CANCEL-04 | Cơ sở tính hoàn là paidAmount, không phải totalAmount | UC-BOOK-08 · UC-PAY-04 · UC-REP-03 | /api/v1/bookings/{bookingId}/cancel-preview · /api/v1/bookings/{bookingId}/cancel · /api/v1/refund-requests | RefundRequest | TC-BOOK-23 · TC-BOOK-26 · TC-CANCEL-05 · TC-CANCEL-14 · TC-CANCEL-44 · TC-CANCEL-45 · … |
| BR-CANCEL-05 | refundAmount làm tròn xuống; netRefund trừ phí xử lý | UC-BOOK-08 · UC-PAY-04 · UC-REP-03 | /api/v1/bookings/{bookingId}/cancel-preview · /api/v1/bookings/{bookingId}/cancel · /api/v1/refund-requests | RefundRequest · CancellationPolicy · CancellationTier | TC-BOOK-23 · TC-CANCEL-03 · TC-CANCEL-18 · TC-CANCEL-44 · TC-CANCEL-45 · TC-CANCEL-46 · … |
| BR-CANCEL-06 | Bậc phụ thu đêm đầu tạo Payment PENALTY ở trạng thái PENDING | UC-BOOK-08 · UC-PAY-04 | /api/v1/bookings · /api/v1/bookings/{bookingId}/cancel-preview · /api/v1/bookings/{bookingId}/cancel · /api/v1/refund-requests | PriceQuote · PriceSnapshot · Payment · CancellationPolicy · CancellationTier · IdempotencyKey | TC-CANCEL-11 · TC-CANCEL-12 · TC-CANCEL-13 · TC-CANCEL-14 · TC-CANCEL-48 |
| BR-CANCEL-07 | NONREF không bao giờ hoàn tiền, chỉ đổi ngày với phí 10% | UC-BOOK-08 | /api/v1/bookings/{bookingId}/cancel · /api/v1/refund-requests | RatePlan · CancellationPolicy · CancellationTier | TC-CANCEL-23 · TC-CANCEL-24 · TC-CANCEL-25 · TC-CANCEL-26 |
| BR-CANCEL-08 | Đổi ngày không tạo RefundRequest | UC-BOOK-06 | /api/v1/bookings/{bookingId}/reschedule · /api/v1/bookings/{bookingId}/cancel · /api/v1/refund-requests | RefundRequest | TC-BOOK-22 · TC-CANCEL-53 |
| BR-CANCEL-09 | Trả phòng sớm hoàn theo ngưỡng báo trước của từng gói giá | UC-BOOK-08 · UC-FO-02 | /api/v1/bookings/{bookingId}/cancel · /api/v1/front-office/check-out | PriceSnapshot · RefundRequest | TC-BOOK-25 · TC-CANCEL-52 |
| BR-CANCEL-10 | No-show đánh dấu 23:59 ngày nhận phòng và áp bậc cuối | UC-BOOK-08 · UC-FO-04 | /api/v1/bookings/{bookingId}/cancel · /api/v1/front-office/no-show | Booking | TC-BOOK-21 · TC-FO-07 · TC-CANCEL-15 · TC-CANCEL-34 · TC-CANCEL-35 |
| BR-CANCEL-11 | Phí xử lý hoàn tiền mặc định 0, trừ vào tiền hoàn | UC-PAY-04 · UC-SYS-02 | /api/v1/bookings/{bookingId}/cancel · /api/v1/refund-requests | RefundRequest · User · Notification · AuditLog · SystemSetting | TC-PAY-19 · TC-CANCEL-44 · TC-CANCEL-45 · TC-CANCEL-46 · TC-CANCEL-47 · TC-CANCEL-48 · … |
| BR-CANCEL-12 | Cam kết hoàn trong 3 ngày làm việc, tối đa 7 ngày | UC-PAY-04 · UC-NOTI-02 | /api/v1/bookings/{bookingId}/cancel · /api/v1/refund-requests/{refundRequestId}/approve · /api/v1/refund-requests/{refundRequestId}/pay | RefundRequest | TC-CANCEL-52 |
| BR-CANCEL-13 | Bất khả kháng hoàn 100%; MANAGER+ tạo kèm minh chứng | UC-BOOK-08 · UC-PAY-04 · UC-OVER-05 · UC-REP-03 | /api/v1/bookings/{bookingId}/cancel · /api/v1/refund-requests · /api/v1/reports/force-majeure | RefundRequest | TC-PAY-20 · TC-REP-03 · TC-CANCEL-50 |
| BR-CANCEL-14 | Huỷ do khách sạn hoàn 100% và bồi thường theo walk-out | UC-OVER-02 · UC-BOOK-08 · UC-OVER-04 · UC-REP-04 | /api/v1/bookings/{bookingId}/cancel · /api/v1/room-moves | RoomMove · RoomMerge · RefundRequest | TC-OVER-07 · TC-CANCEL-51 |
| BR-CANCEL-15 | Phê duyệt hai cấp khi netRefund trên 5.000.000; người khác duyệt | UC-PAY-04 · UC-OVER-05 | /api/v1/bookings/{bookingId}/cancel · /api/v1/refund-requests/{refundRequestId}/approve | RefundRequest | TC-PAY-15 · TC-PAY-16 · TC-CANCEL-52 |
| BR-CANCEL-16 | Chỉ chi hoàn sau khi RefundRequest ở APPROVED; ghi AuditLog | UC-BOOK-08 · UC-PAY-04 | /api/v1/bookings/{bookingId}/cancel · /api/v1/refund-requests/{refundRequestId}/approve · /api/v1/refund-requests/{refundRequestId}/pay | Payment · RefundRequest · AuditLog · IdempotencyKey | TC-BOOK-20 · TC-PAY-17 · TC-PAY-18 · TC-CANCEL-52 |
| BR-CANCEL-17 | Tổng hoàn luỹ kế của booking không vượt paidAmount | UC-BOOK-08 · UC-PAY-04 · UC-REP-03 | /api/v1/bookings/{bookingId}/cancel · /api/v1/refund-requests | Booking · RefundRequest | TC-PAY-16 · TC-PAY-21 · TC-CANCEL-44 |
| BR-CANCEL-18 | Yêu cầu PENDING chuyển CANCELLED khi rút hoặc khôi phục booking | UC-PAY-04 | /api/v1/bookings/{bookingId}/cancel · /api/v1/refund-requests · /api/v1/refund-requests/{refundRequestId}/cancel | Booking · RefundRequest | TC-PAY-14 · TC-CANCEL-52 |
| BR-CANCEL-19 | Huỷ một phần phân bổ tiền theo tỷ lệ giá phòng huỷ | UC-BOOK-08 · UC-PAY-04 | /api/v1/bookings/{bookingId}/cancel | Booking · BookingRoom · RoomAssignment · PriceSnapshot · RefundRequest | TC-BOOK-26 · TC-CANCEL-54 |
| BR-PAY-01 | depositAmount làm tròn lên 1.000 của tỷ lệ cọc | UC-BOOK-02 · UC-PAY-01 · UC-PAY-02 | /api/v1/payments · /api/v1/payments/online | Booking · Payment · IdempotencyKey | TC-PAY-01 |
| BR-PAY-02 | Thu balanceDue trước khi giao phòng | UC-BOOK-02 · UC-BOOK-06 · UC-BOOK-08 · UC-PAY-01 · UC-PAY-02 · UC-PAY-03 · … | /api/v1/payments · /api/v1/payments/online · /api/v1/bookings/{bookingId}/balance | Booking · Payment · IdempotencyKey | TC-PAY-09 · TC-PAY-11 |
| BR-PAY-03 | Callback cổng thanh toán idempotent theo idempotencyKey | UC-PAY-02 | /api/v1/payments/online | Payment · IdempotencyKey | TC-PAY-04 · TC-PAY-11 · TC-PAY-12 · TC-PAY-13 |
| BR-PAY-04 | Không lưu số thẻ, ngày hết hạn hay CVV | UC-PAY-02 | /api/v1/payments/online | Payment · IdempotencyKey | TC-PAY-06 |
| BR-PAY-05 | Giao dịch quá 15 phút không callback chuyển FAILED | UC-BOOK-04 · UC-PAY-02 | /api/v1/payments/online · /api/v1/payments/{paymentId}/status | RoomAssignment · Hold · Payment · IdempotencyKey | TC-PAY-05 · TC-CANCEL-50 |
| BR-PAY-06 | Tiền mặt ghi createdBy và paidAt để đối soát | UC-BOOK-02 · UC-PAY-01 · UC-PAY-03 · UC-PAY-05 · UC-FO-01 | /api/v1/payments · /api/v1/reconciliation/daily/close | Payment · IdempotencyKey | TC-PAY-10 |
| BR-PAY-07 | Tổng hoàn luỹ kế của booking không vượt paidAmount | UC-BOOK-08 · UC-PAY-04 · UC-REP-03 | /api/v1/payments · /api/v1/refund-requests | Booking · Payment · RefundRequest · IdempotencyKey | TC-PAY-21 · TC-CANCEL-44 |
| BR-PAY-08 | Hoàn về phương thức gốc; tiền mặt thì chuyển khoản | UC-PAY-04 | /api/v1/refund-requests/{refundRequestId}/pay | Payment · RefundRequest · IdempotencyKey | TC-PAY-07 · TC-CANCEL-52 |
| BR-PAY-09 | Hoàn ghi bằng Payment loại REFUND, không sửa hay xoá Payment gốc | UC-BOOK-08 · UC-PAY-04 | /api/v1/refund-requests/{refundRequestId}/pay | Payment · RefundRequest · IdempotencyKey | TC-PAY-08 · TC-CANCEL-52 |
| BR-PAY-10 | Đối soát cuối ngày theo cặp (người thu, ngày VN) | UC-PAY-01 · UC-PAY-04 · UC-PAY-05 · UC-REP-02 | /api/v1/reconciliation/daily/close | Payment · IdempotencyKey | TC-PAY-10 |
| BR-BOOK-11 | Huỷ booking giải phóng mọi RoomAssignment trong cùng transaction | UC-BOOK-08 | /api/v1/bookings · /api/v1/bookings/{bookingId}/cancel · /api/v1/room-moves · /api/v1/room-moves/{roomMoveId}/execute | Booking · RoomAssignment · Hold | TC-BOOK-18 · TC-BOOK-26 · TC-CANCEL-01 · TC-CANCEL-02 · TC-CANCEL-03 · TC-CANCEL-04 · … |
| BR-BOOK-12 | Đổi ngày: 1 lần miễn phí khi ≥ 168h; NONREF phí 10% | UC-BOOK-06 | /api/v1/bookings · /api/v1/bookings/{bookingId}/reschedule | RatePlan · Booking · PriceSnapshot · AuditLog | TC-BOOK-22 · TC-BOOK-09 · TC-CANCEL-53 |
| BR-BOOK-13 | Booking CHECKED_IN không được sửa ngày | UC-BOOK-05 · UC-BOOK-06 · UC-BOOK-08 | /api/v1/bookings · /api/v1/bookings/{bookingId}/reschedule | Booking | TC-BOOK-10 |
| BR-BOOK-14 | Cấm xoá cứng booking CONFIRMED; DRAFT/HELD chưa trả thì được | UC-BOOK-05 · UC-BOOK-08 | /api/v1/bookings · /api/v1/bookings/{bookingId} · /api/v1/bookings/{bookingId}/cancel | Booking · RefundRequest | TC-BOOK-19 · TC-CANCEL-01 · TC-CANCEL-02 · TC-CANCEL-03 · TC-CANCEL-04 · TC-CANCEL-05 · … |
| BR-BOOK-17 | Xoá cứng booking phải ghi AuditLog beforeJson trước khi xoá | UC-BOOK-05 · UC-BOOK-08 | /api/v1/bookings/{bookingId} | Booking · AuditLog | TC-BOOK-24 · TC-CANCEL-50 |
| BR-GEN-03 | Làm tròn lên 1.000 cho giá bán, cọc; xuống cho hoàn | UC-RATE-05 · UC-BOOK-01 · UC-PAY-01 · UC-PAY-04 | /api/v1/quotes | Payment · IdempotencyKey · Money · StayPeriod · DateRange · ChannelContext · … | TC-PAY-01 · TC-RATE-12 |
| BR-GEN-04 | Nhận phòng 14:00, trả phòng 12:00 giờ VN theo từng cơ sở | UC-PROP-01 · UC-BOOK-08 | /api/v1/properties/{propertyId} · /api/v1/bookings/{bookingId}/cancel | Property · Money · StayPeriod · DateRange · ChannelContext · PhoneNumber | TC-BOOK-02 |

**Kết luận: đã đóng.** Cả 36/36 quy tắc của bài toán đều có ≥ 1 UC, ≥ 1 endpoint, ≥ 1 thực thể và ≥ 1 ca kiểm thử; không còn ô `—`.

### 5.2. BT-2 — Giá theo mùa cao điểm và theo kênh bán (21 quy tắc)

Chuỗi BR-RATE-01…19 (§14 ghi BT-2) cộng BR-GEN-03 (làm tròn lên theo đêm, xuống cho tổng sau giảm) và BR-BOOK-03 (số đêm quyết định hệ số LOS).

| Mã BR | Tóm tắt | UC | API | Entity | TC |
|-------|---------|----|-----|--------|----|
| BR-RATE-01 | Thứ tự áp hệ số giá cố định; kèm ngưỡng công suất | UC-RATE-02 · UC-RATE-03 · UC-RATE-05 · UC-BOOK-01 · UC-BOOK-06 | /api/v1/quotes | RoomType · RatePlan · RateCalendar · Season · PriceQuote · OccupancySnapshot · … | TC-RATE-01 · TC-RATE-02 · TC-RATE-07 · TC-RATE-08 · TC-RATE-09 · TC-RATE-12 · … |
| BR-RATE-02 | Tra giá cơ bản theo priority OVERRIDE, RATE_PLAN, SEASON, BASE | UC-RATE-01 | /api/v1/room-types/{roomTypeId}/rate-calendar · /api/v1/quotes | RoomType · RateCalendar · Season | TC-RATE-13 |
| BR-RATE-03 | Giá cơ bản mặc định theo từng loại phòng | UC-PROP-02 · UC-RATE-01 · UC-BOOK-02 | /api/v1/room-types · /api/v1/room-types/{roomTypeId}/rate-calendar · /api/v1/quotes | RoomType · RateCalendar · Season | TC-RATE-02 |
| BR-RATE-04 | Sàn/trần giá theo loại phòng; kẹp là bảo vệ chủ đích | UC-PROP-02 · UC-RATE-01 · UC-BOOK-02 | /api/v1/room-types · /api/v1/quotes | RoomType · RateCalendar · Season | TC-RATE-11 · TC-RATE-22 |
| BR-RATE-05 | Hệ số mùa áp mọi kênh; chồng lấn cùng priority cảnh báo | UC-RATE-02 | /api/v1/seasons · /api/v1/quotes | RateCalendar · Season · AuditLog | TC-RATE-03 · TC-RATE-04 |
| BR-RATE-06 | Hệ số cuối tuần 1,20 cho Thứ Sáu và Thứ Bảy | UC-RATE-02 | /api/v1/seasons · /api/v1/quotes | RateCalendar · Season | TC-RATE-05 · TC-RATE-06 |
| BR-RATE-07 | WALKIN +10%, AGENCY −5%; ngưỡng sàn hệ số kênh theo hoa hồng | UC-RATE-03 · UC-BOOK-02 · UC-BOOK-03 · UC-CHAN-01 | /api/v1/channels/{channelId} · /api/v1/quotes · /api/v1/quotes/multi-channel | Channel · ChannelPropertySetting · ChannelMapping · Booking | TC-RATE-10 |
| BR-RATE-08 | Doanh thu thuần = totalAmount × (1 − hoa hồng) | UC-RATE-05 · UC-PAY-05 · UC-CHAN-03 · UC-REP-01 · UC-REP-02 | /api/v1/quotes · /api/v1/quotes/multi-channel · /api/v1/reports/adr-revpar · /api/v1/reports/revenue-by-channel | Channel · ChannelPropertySetting · ChannelMapping · Booking | TC-RATE-23 · TC-REP-01 · TC-REP-02 |
| BR-RATE-09 | Cân bằng giá so sau bước kẹp; cảnh báo không chặn lưu | UC-RATE-03 · UC-PAY-05 | /api/v1/channels/{channelId} · /api/v1/quotes · /api/v1/quotes/multi-channel | Channel · ChannelPropertySetting · ChannelMapping | TC-RATE-24 |
| BR-RATE-10 | Khuyến mãi PERCENT/AMOUNT áp một lần trên tổng tạm tính | UC-RATE-04 · UC-BOOK-01 | /api/v1/promotions · /api/v1/quotes | Promotion | TC-RATE-14 |
| BR-RATE-11 | Tổng giảm bị cắt về trần 30% và ghi cảnh báo | UC-RATE-04 · UC-BOOK-01 | /api/v1/promotions · /api/v1/quotes | Promotion | TC-RATE-15 |
| BR-RATE-12 | Tổng sau giảm không dưới tổng giá sàn: chặn hoặc cảnh báo | UC-RATE-04 · UC-BOOK-01 | /api/v1/quotes | Promotion · PriceQuote · PriceSnapshot | TC-RATE-16 · TC-RATE-26 |
| BR-RATE-13 | Xếp chồng tối đa hai mã; thứ tự AMOUNT rồi PERCENT | UC-RATE-04 · UC-BOOK-01 | /api/v1/promotions · /api/v1/quotes | Promotion · Booking | TC-RATE-17 |
| BR-RATE-14 | Khuyến mãi hết hạn/hết lượt bị từ chối khi xác nhận | UC-RATE-04 · UC-BOOK-01 | /api/v1/quotes | Promotion | TC-RATE-18 |
| BR-RATE-15 | PriceQuote có hiệu lực 15 phút, quá hạn phải tính lại | UC-INV-02 · UC-RATE-05 · UC-BOOK-01 | /api/v1/quotes | PriceQuote · PriceSnapshot | TC-RATE-19 |
| BR-RATE-16 | PriceSnapshot bất biến được lưu ngay khi booking rời DRAFT | UC-BOOK-01 · UC-BOOK-02 · UC-BOOK-06 | /api/v1/quotes · /api/v1/bookings · /api/v1/bookings/{bookingId}/cancel | PriceQuote · Booking · PriceSnapshot | TC-RATE-20 · TC-BOOK-07 · TC-BOOK-16 · TC-BOOK-17 |
| BR-RATE-17 | Cùng đầu vào cho cùng kết quả giá trên ba nền tảng | UC-INV-02 · UC-RATE-05 · UC-BOOK-01 · UC-BOOK-06 | /api/v1/inventory/availability · /api/v1/quotes | PriceQuote · PriceSnapshot | TC-RATE-17 · TC-RATE-20 · TC-RATE-21 |
| BR-RATE-18 | Hoa hồng mặc định theo kênh, ghi đè theo (kênh, cơ sở) | UC-RATE-03 | /api/v1/channels/{channelId} | Channel · ChannelPropertySetting · ChannelMapping · PriceSnapshot · AuditLog | TC-RATE-10 · TC-RATE-23 |
| BR-RATE-19 | LONGSTAY14 phải có giá riêng; ưu đãi gợi ý tối thiểu 5% | UC-RATE-01 | /api/v1/room-types/{roomTypeId}/rate-calendar | RatePlan · RateCalendar · Season | TC-RATE-25 · TC-CANCEL-27 · TC-CANCEL-28 · TC-CANCEL-29 · TC-CANCEL-30 · TC-CANCEL-31 · … |
| BR-GEN-03 | Làm tròn lên 1.000 cho giá bán, cọc; xuống cho hoàn | UC-RATE-05 · UC-BOOK-01 · UC-PAY-01 · UC-PAY-04 | /api/v1/quotes | Payment · IdempotencyKey · Money · StayPeriod · DateRange · ChannelContext · … | TC-PAY-01 · TC-RATE-12 |
| BR-BOOK-03 | Số đêm trong khoảng minNights–maxNights của gói giá | UC-BOOK-01 · UC-BOOK-02 · UC-BOOK-06 | /api/v1/bookings | RatePlan · Booking · Money · StayPeriod · DateRange · ChannelContext · … | TC-RATE-08 · TC-BOOK-03 |

**Kết luận: đã đóng.** Cả 21/21 quy tắc của bài toán đều có ≥ 1 UC, ≥ 1 endpoint, ≥ 1 thực thể và ≥ 1 ca kiểm thử; không còn ô `—`.

### 5.3. BT-3 — Ghép và đổi phòng khi quá tải (37 quy tắc)

Ba nhóm BR-INV, BR-CHAN, BR-OVER (§14 ghi BT-3) cộng các quy tắc BOOK điều phối tồn và gán phòng (BR-BOOK-04, 07, 08, 10, 16) và BR-PROP-06 (phòng ngừng bán không tính vào tồn).

| Mã BR | Tóm tắt | UC | API | Entity | TC |
|-------|---------|----|-----|--------|----|
| BR-INV-01 | Tồn khả dụng hai tầng: chung và kênh, chống đếm trùng | UC-INV-01 · UC-INV-02 · UC-BOOK-01 · UC-CHAN-03 · UC-OVER-01 · UC-REP-01 | /api/v1/inventory/grid · /api/v1/inventory/availability · /api/v1/reports/occupancy | Room · RoomBlock · HousekeepingTask · ChannelAllotment · RoomAssignment · Hold | TC-INV-05 · TC-INV-08 |
| BR-INV-02 | Kiểm tra tồn và giữ chỗ trong một transaction khoá bi quan | UC-INV-02 · UC-BOOK-01 · UC-BOOK-04 · UC-BOOK-06 · UC-CHAN-03 | /api/v1/inventory/availability · /api/v1/bookings · /api/v1/holds | RoomAssignment · Hold | TC-INV-02 · TC-INV-03 |
| BR-INV-03 | Bất biến CSDL: tối đa một RoomAssignment mỗi đơn vị bán, đêm | UC-OVER-02 · UC-BOOK-01 · UC-BOOK-04 · UC-BOOK-06 · UC-OVER-03 · UC-FO-01 | /api/v1/bookings · /api/v1/holds | Room · RoomAssignment · Hold · Money · StayPeriod · DateRange · … | TC-BOOK-18 · TC-INV-01 · TC-INV-03 · TC-INV-09 · TC-BOOK-14 |
| BR-INV-04 | Hold hết hạn được giải phóng trong vòng 60 giây | UC-BOOK-04 | /api/v1/holds · /api/v1/holds/{holdId} | RoomAssignment · Hold | TC-INV-04 |
| BR-INV-05 | Allotment của ngày không vượt số phòng ACTIVE của loại | UC-INV-03 | /api/v1/channel-allotments | RoomType · RoomBlock · ChannelAllotment · Booking | TC-INV-07 · TC-CHAN-06 |
| BR-INV-06 | RoomBlock chồng RoomAssignment cần MANAGER+ và mở OverbookingCase | UC-PROP-01 · UC-PROP-04 · UC-OVER-01 | /api/v1/room-blocks · /api/v1/room-blocks/{roomBlockId} | RoomBlock · HousekeepingTask · Booking · RoomAssignment · OverbookingCase | TC-PROP-04 |
| BR-INV-07 | Kiểm tra tồn từng đêm; thiếu đêm trả E_INV_NO_AVAILABILITY | UC-INV-01 · UC-INV-02 · UC-BOOK-01 · UC-BOOK-04 · UC-BOOK-06 · UC-CHAN-03 | /api/v1/inventory/grid · /api/v1/inventory/availability · /api/v1/holds | Room · RoomBlock · ChannelAllotment · RoomAssignment · Hold | TC-INV-06 · TC-INV-08 |
| BR-CHAN-01 | OTA hạn mức 80% phòng; kênh trực tiếp chia tồn chung | UC-INV-03 · UC-CHAN-01 · UC-CHAN-03 | /api/v1/inventory/availability · /api/v1/channel-allotments · /api/v1/channels/{channelId}/mappings | RoomType · Channel · ChannelPropertySetting · ChannelAllotment · ChannelMapping | TC-CHAN-01 · TC-CHAN-06 |
| BR-CHAN-02 | Đồng bộ tồn, giá ngay khi đổi và chậm nhất 5 phút | UC-BOOK-04 · UC-CHAN-02 · UC-CHAN-03 | /api/v1/channels/{channelId}/sync | OutboxEvent | TC-CHAN-02 · TC-CHAN-11 |
| BR-CHAN-03 | Booking OTA ghi CONFIRMED kể cả hết phòng, mở OverbookingCase | UC-CHAN-03 · UC-OVER-01 | /api/v1/bookings · /api/v1/channels/{channelId}/ota-bookings | Channel · ChannelPropertySetting · ChannelMapping · Booking · OverbookingCase | TC-PAY-03 · TC-CHAN-03 · TC-CHAN-08 · TC-CHAN-09 · TC-CHAN-11 |
| BR-CHAN-04 | Booking OTA huỷ theo chính sách OTA, không tạo RefundRequest | UC-BOOK-08 · UC-CHAN-03 · UC-REP-02 | /api/v1/channels/{channelId}/ota-bookings | Booking · RefundRequest | TC-CHAN-07 · TC-CANCEL-55 |
| BR-CHAN-05 | Tồn ≤ 2 thì đóng bán trên mọi kênh OTA | UC-CHAN-01 · UC-CHAN-02 | /api/v1/inventory/availability · /api/v1/channels/{channelId}/sales-closure | RoomBlock · Channel · ChannelPropertySetting · ChannelMapping | TC-CHAN-04 |
| BR-CHAN-06 | Mọi thay đổi giá hoặc tồn ghi OutboxEvent trong cùng transaction | UC-OVER-02 · UC-RATE-03 · UC-BOOK-01 · UC-BOOK-04 · UC-BOOK-06 · UC-BOOK-08 · … | /api/v1/channel-allotments · /api/v1/channels/{channelId}/sync | OutboxEvent | TC-CHAN-02 |
| BR-CHAN-07 | Đồng bộ lỗi 3 lần liên tiếp: cảnh báo MANAGER, kênh DEGRADED | UC-CHAN-02 · UC-CHAN-03 | /api/v1/channels/{channelId}/sync | Channel · ChannelPropertySetting · ChannelMapping · OutboxEvent | TC-CHAN-05 |
| BR-CHAN-08 | Số phòng bán trên OTA không vượt allotment còn lại của ngày | UC-INV-03 · UC-CHAN-03 | /api/v1/channel-allotments · /api/v1/channels/{channelId}/mappings | Channel · ChannelPropertySetting · ChannelAllotment · ChannelMapping | TC-CHAN-10 |
| BR-OVER-01 | Trần bán vượt mặc định bằng 0 — không bán vượt | UC-CHAN-01 · UC-CHAN-03 · UC-OVER-01 | /api/v1/properties/{propertyId} | Property | TC-OVER-03 · TC-OVER-05 · TC-OVER-11 · TC-OVER-12 |
| BR-OVER-02 | Bán vượt chỉ khi kênh cho phép và trong trần cơ sở | UC-CHAN-01 · UC-CHAN-03 · UC-OVER-01 | /api/v1/properties/{propertyId} · /api/v1/channels/{channelId} · /api/v1/bookings | Property · Booking | TC-OVER-03 |
| BR-OVER-03 | Booking tạo khi hết phòng đặt oversold và tự mở OverbookingCase | UC-CHAN-03 · UC-OVER-01 | /api/v1/bookings · /api/v1/overbooking-cases | Booking · OverbookingCase | TC-CHAN-03 · TC-CHAN-11 · TC-OVER-04 |
| BR-OVER-04 | Ca quá tải phải RESOLVED trước T−24h, quá hạn leo thang OWNER | UC-OVER-01 · UC-REP-04 | /api/v1/overbooking-cases · /api/v1/overbooking-cases/{caseId}/resolve · /api/v1/reports/overbooking | OverbookingCase | TC-OVER-02 · TC-OVER-16 · TC-OVER-17 |
| BR-OVER-05 | Job quét quá tải chạy mỗi giờ, 30 ngày tới | UC-OVER-01 | /api/v1/overbooking-cases · /api/v1/reports/overbooking | OverbookingCase | TC-OVER-01 · TC-OVER-16 |
| BR-OVER-06 | Chi phí bồi thường, đưa đón ghi vào RoomMove; MANAGER+ duyệt | UC-OVER-02 · UC-OVER-04 · UC-REP-04 | /api/v1/overbooking-cases · /api/v1/overbooking-cases/{caseId}/relocation-plan · /api/v1/room-moves · /api/v1/room-moves/{roomMoveId}/approve | RoomMove · RoomMerge | TC-OVER-06 · TC-OVER-07 · TC-REP-03 · TC-CANCEL-51 |
| BR-OVER-07 | Sang cơ sở khác thành phố cần khách đồng ý, MANAGER+ duyệt | UC-OVER-02 · UC-OVER-05 | /api/v1/room-moves · /api/v1/room-moves/{roomMoveId}/approve | RoomMove · RoomMerge | TC-OVER-06 |
| BR-OVER-08 | RoomMove giữ nguyên đơn giá đã chốt cho toàn kỳ | UC-OVER-02 · UC-OVER-03 · UC-FO-01 | /api/v1/room-moves · /api/v1/room-moves/{roomMoveId}/execute | RoomAssignment · Hold · RoomMove · RoomMerge | TC-OVER-08 · TC-OVER-15 |
| BR-OVER-09 | Khách CHECKED_IN không được điều chuyển, trừ bất khả kháng | UC-OVER-02 | /api/v1/room-moves | RoomMove · RoomMerge | TC-OVER-09 |
| BR-OVER-10 | RoomMove phải ghi AuditLog và thông báo khách trong 15 phút | UC-OVER-02 · UC-OVER-03 · UC-NOTI-02 | /api/v1/room-moves · /api/v1/room-moves/{roomMoveId}/execute | RoomMove · RoomMerge · User · Notification · AuditLog · SystemSetting | TC-OVER-08 · TC-OVER-15 |
| BR-OVER-11 | Thứ tự điều chuyển: keepScore tăng, createdAt giảm, Booking.seq tăng | UC-OVER-02 · UC-OVER-01 · UC-OVER-03 · UC-OVER-04 · UC-FO-01 | /api/v1/overbooking-cases · /api/v1/overbooking-cases/{caseId} · /api/v1/overbooking-cases/{caseId}/relocation-plan | Booking · RoomMove · RoomMerge · Guest · GuestNote · LoyaltyTransaction | TC-OVER-10 · TC-OVER-16 |
| BR-OVER-12 | WALKIN chưa trả và HELD không ưu tiên hơn booking đã cọc | UC-OVER-02 · UC-OVER-01 | /api/v1/overbooking-cases · /api/v1/overbooking-cases/{caseId} · /api/v1/overbooking-cases/{caseId}/relocation-plan | Booking · RoomMove · RoomMerge | TC-OVER-10 |
| BR-OVER-13 | MERGE_SHARE cần đủ hai cờ đồng thuận, chỉ loại allowShared | UC-OVER-03 | /api/v1/room-moves · /api/v1/room-merges · /api/v1/room-merges/{roomMergeId}/consent | Room · Booking · RoomMove · RoomMerge · Guest | TC-OVER-11 · TC-OVER-13 |
| BR-OVER-14 | Không ghép khác giới trừ khi đủ đồng thuận và MANAGER+ duyệt | UC-OVER-03 | /api/v1/room-moves · /api/v1/room-merges · /api/v1/room-merges/{roomMergeId}/approve | Room · RoomMove · RoomMerge | TC-OVER-13 |
| BR-OVER-15 | Ghép phòng không đổi doanh thu; chiết khấu ghi riêng vào RoomMerge | UC-PROP-03 · UC-OVER-03 · UC-REP-04 | /api/v1/rooms/{roomId}/connecting-room · /api/v1/room-moves · /api/v1/room-merges · /api/v1/reports/overbooking | RoomMove · RoomMerge | TC-OVER-14 · TC-REP-03 |
| BR-OVER-16 | Ca quá tải quá hạn chuyển ESCALATED, không tự đóng | UC-OVER-01 | /api/v1/overbooking-cases · /api/v1/reports/overbooking | OverbookingCase · RoomMove · RoomMerge | TC-OVER-17 |
| BR-BOOK-04 | Số khách tối đa bằng sức chứa nhân số phòng | UC-BOOK-01 · UC-BOOK-02 · UC-OVER-03 | /api/v1/bookings · /api/v1/holds | RoomType · Booking · BookingRoom | TC-BOOK-04 |
| BR-BOOK-07 | HELD có holdExpiresAt bằng thời điểm tạo cộng holdMinutes của kênh | UC-BOOK-01 · UC-BOOK-03 · UC-BOOK-04 | /api/v1/bookings · /api/v1/holds | Channel · ChannelPropertySetting · ChannelMapping · Booking · RoomAssignment · Hold | TC-BOOK-07 |
| BR-BOOK-08 | Hết hạn hold chuyển EXPIRED và giải phóng RoomAssignment | UC-BOOK-01 · UC-BOOK-04 | /api/v1/bookings · /api/v1/holds | Booking · RoomAssignment · Hold | TC-INV-04 · TC-CANCEL-50 |
| BR-BOOK-10 | Nhiều phòng: mỗi phòng một BookingRoom, mỗi đêm một RoomAssignment | UC-BOOK-01 · UC-BOOK-02 · UC-BOOK-05 | /api/v1/bookings | Booking · BookingRoom · RoomAssignment · Hold | TC-BOOK-08 · TC-BOOK-14 |
| BR-BOOK-16 | Chống đặt trùng trong 24 giờ, trả booking cũ kèm cờ | UC-BOOK-01 · UC-BOOK-02 · UC-CHAN-03 | /api/v1/bookings | Booking | TC-BOOK-11 |
| BR-PROP-06 | Phòng MAINTENANCE/INACTIVE không vào tìm phòng và tồn khả dụng | UC-OVER-02 · UC-PROP-03 · UC-PROP-04 · UC-INV-02 · UC-OVER-01 · UC-FO-01 | /api/v1/room-blocks · /api/v1/inventory/availability | Room · RoomBlock · HousekeepingTask | TC-PROP-03 |

**Kết luận: đã đóng.** Cả 37/37 quy tắc của bài toán đều có ≥ 1 UC, ≥ 1 endpoint, ≥ 1 thực thể và ≥ 1 ca kiểm thử; không còn ô `—`.

---

## 6. Lỗ hổng truy vết

Toàn bộ ô `—` của ma trận §2: **0** ô ở cột FR · **0** ở cột UC · **5** ở cột API · **2** ở cột Entity · **3** ở cột TC. Mỗi dòng dưới đây nêu lý do chấp nhận được hoặc việc cần làm; **không ô `—` nào là lỗi định dạng**.

| # | Ô trống | BR | Vì sao không có mã | Việc cần làm |
|---|---------|----|--------------------|--------------|
| 1 | API | BR-GEN-01 | Quy tắc nền về kiểu tiền: 04/api §1.1 dòng 2 gắn nó cho **mọi** endpoint có trường tiền, không gắn một đường dẫn cụ thể. | **Chấp nhận**: quy tắc xuyên suốt, được cưỡng chế bằng kiểm thử hợp đồng (T4) chứ không bằng một endpoint. Không cần sửa xương sống. |
| 2 | API | BR-GEN-02 | Quy tắc nền về lưu trữ UTC: 04/api §1.1 dòng 3 gắn nó cho **mọi** trường thời điểm của mọi endpoint. | **Chấp nhận**: quy tắc xuyên suốt, được cưỡng chế bằng kiểm thử hợp đồng (T4) chứ không bằng một endpoint. Không cần sửa xương sống. |
| 3 | API | BR-GEN-05 | Quy tắc nền về múi giờ nghiệp vụ: 04/api §1.1 dòng 3 gắn nó cho toàn bộ hợp đồng API. | **Chấp nhận**: quy tắc xuyên suốt, được cưỡng chế bằng kiểm thử hợp đồng (T4) chứ không bằng một endpoint. Không cần sửa xương sống. |
| 4 | API | BR-GEN-08 | Quy tắc nền về `Idempotency-Key`: 04/api §1.3 gắn nó cho **mọi thao tác ghi**, không có endpoint đại diện. | **Chấp nhận**: quy tắc xuyên suốt, được cưỡng chế bằng kiểm thử hợp đồng (T4) chứ không bằng một endpoint. Không cần sửa xương sống. |
| 5 | API | BR-SYS-04 | Quy tắc lưu trữ dữ liệu (10 năm với booking/thanh toán, 5 năm với nhật ký) là chính sách vòng đời dữ liệu, không có bề mặt HTTP; 04/api §6.1 chỉ ràng buộc quyền trên các endpoint hiện có. | **Chấp nhận**: quy tắc xuyên suốt, được cưỡng chế bằng kiểm thử hợp đồng (T4) chứ không bằng một endpoint. Không cần sửa xương sống. |
| 6 | Entity | BR-GEN-02 | Quy tắc nền về mốc thời gian: áp cho cột thời gian của **mọi** thực thể, không thuộc riêng thực thể nào. | **Chấp nhận.** Muốn hết ô trống thì phải bổ sung một dòng hạ tầng/dữ liệu vào §8 của 03/mô hình miền — đây là thay đổi xương sống, cần chủ trì tài liệu quyết. Giá trị nghiệp vụ của BR-GEN-02 vẫn được kiểm bằng `TC-BOOK-21`. |
| 7 | Entity | BR-SYS-03 | Quy tắc sao lưu/phục hồi (PITR, RPO ≤ 15 phút, RTO ≤ 4 giờ) là thuộc tính hạ tầng dữ liệu; 00 §7 không có thực thể miền nào tương ứng. | **Chấp nhận**: BR-SYS-03 được kiểm chứng bằng ca vận hành (`TC-SYS-*`), không cần thực thể miền. |
| 8 | TC | BR-GEN-02 | Hành vi đã được kiểm chứng gián tiếp nhưng **không ca nào khai mã BR này** ở cột *Mã BR*. | **Cần sửa** để `TC-SYS-06` xanh: bổ sung `BR-GEN-02` vào cột *Mã BR* của `TC-BOOK-21` (ca biên múi giờ) — một dòng sửa, không viết ca mới. |
| 9 | TC | BR-GEN-05 | Hành vi đã được kiểm chứng gián tiếp nhưng **không ca nào khai mã BR này** ở cột *Mã BR*. | **Cần sửa** để `TC-SYS-06` xanh: bổ sung `BR-GEN-05` vào cột *Mã BR* của `TC-BOOK-21` (ca biên múi giờ) — một dòng sửa, không viết ca mới. |
| 10 | TC | BR-RBAC-01 | Hành vi đã được kiểm chứng gián tiếp nhưng **không ca nào khai mã BR này** ở cột *Mã BR*. | **Cần sửa** để `TC-SYS-06` xanh: bổ sung `BR-RBAC-01` vào cột *Mã BR* của `TC-AUTH-08` (sáu vai trò × 8 thao tác) — một dòng sửa, không viết ca mới. |

### 6.1. Ô không phải `—` nhưng vẫn là **suy diễn** cần biết

| BR | Ô | Nội dung suy diễn | Căn cứ |
|----|----|-------------------|--------|
| BR-CHAN-07 | API | `POST /api/v1/channels/{channelId}/sync` — §2.7 chỉ khai `BR-CHAN-02, BR-CHAN-06` cho endpoint này | [04/api](../04-thiet-ke/api.md) §4.2 (`E_CHAN_SYNC_FAILED` sau 3 lần lỗi liên tiếp) và §5.1 (thử lại 5 lần, kênh `DEGRADED`) đều thuộc đường đồng bộ kênh; đây là bề mặt ghi duy nhất của đồng bộ |
| BR-CRM-06 | API | `GET /api/v1/guests/{guestId}/loyalty` — §2.10 chỉ khai `BR-CRM-02, BR-CRM-03` | Điểm và hạng chỉ được đọc/tính ở endpoint này; quy tắc quyết định booking huỷ/no-show không cộng điểm |
| BR-INV-02 · BR-INV-07 | Entity | Bổ sung `RoomAssignment`, `Hold`, `RoomBlock`, `ChannelAllotment`, `Room` ngoài bảng §8 của 03/mô hình miền | Chính câu quy tắc và hai truy vấn `Q1`/`Q2` của [04/csdl](../04-thiet-ke/csdl.md) thao tác trên các thực thể này |
| BR-RATE-01 | Entity | Bổ sung `RateCalendar`, `Season`, `RatePlan`, `RoomType`, `PriceQuote` | Công thức §4.1 của [02/quy tắc nghiệp vụ](../02-nghiep-vu/quy-tac-nghiep-vu.md) đọc đúng các thực thể này ở từng bước |
| BR-GEN-06 | Entity | `Booking` | `Booking.code` là trường mang mã `PH-<YYMMDD>-<5 ký tự>`; ràng buộc `CHECK` + `UNIQUE` ở [04/csdl](../04-thiet-ke/csdl.md) |
| BR-GEN-01 · BR-GEN-03 · BR-GEN-04 · BR-INV-03 · BR-BOOK-02 · BR-BOOK-03 · BR-CRM-01 | Entity | Năm giá trị miền `Money` · `StayPeriod` · `DateRange` · `ChannelContext` · `PhoneNumber` nhận cùng danh sách BR theo dòng gộp ở §8 của 03/mô hình miền | Không suy diễn thêm: giữ nguyên cách gán của bảng nguồn |

### 6.2. Ghi chú mâu thuẫn đã biết (không phải ô trống)

- `BR-INV-01` được gán thực thể `HousekeepingTask` theo dòng gộp ở [03/mô hình miền](../03-phan-tich/mo-hinh-mien.md) §8, nhưng chính §9 mục 2 của tài liệu đó ghi nhận **BR-INV-01 không xét trạng thái buồng phòng** trong khi `BR-FO-06`/`BR-FO-07` buộc dọn xong mới giao phòng. Ma trận giữ nguyên cách gán của bảng nguồn; việc chốt lại thuộc chủ trì tài liệu xương sống.
- `BR-PROP-04` không có dòng riêng trong bảng BR-PROP của [02](../02-nghiep-vu/quy-tac-nghiep-vu.md) (nội dung nằm ở dòng ghi chú ngay dưới `BR-PROP-03`); ma trận lấy mã theo bảng §14 và nội dung theo dòng ghi chú đó.

---

## Tham chiếu

- [00 — Tổng quan dự án](../00-tong-quan.md) — §2 ba bài toán trọng tâm · §4 actor · §6 quy ước định danh · §7 từ điển thực thể · §8 danh mục 52 use case · §12 tiêu chí thành công
- [01 — Yêu cầu chức năng](../01-yeu-cau/yeu-cau-chuc-nang.md) — §17.1 truy vết ngược đầy đủ BR → FR
- [01 — Mô hình use case](../01-yeu-cau/mo-hinh-use-case.md) — §4 cột *BR chính* · §6 đặc tả kèm dòng *BR áp dụng*
- [01 — Yêu cầu phi chức năng](../01-yeu-cau/yeu-cau-phi-chuc-nang.md) — 40 NFR trong 8 nhóm
- [02 — Quy tắc nghiệp vụ](../02-nghiep-vu/quy-tac-nghiep-vu.md) — 136 quy tắc, bảng tra nhanh §14 và nhóm BR-REP §15
- [02 — Chính sách huỷ & hoàn cọc](../02-nghiep-vu/chinh-sach-huy-hoan-coc.md) — dải `TC-CANCEL-01…55` và bảng BR ↔ ca kiểm thử ở §1
- [02 — Động giá](../02-nghiep-vu/dong-gia.md) — ví dụ vàng và ma trận biên của BT-2
- [03 — Mô hình miền](../03-phan-tich/mo-hinh-mien.md) — §7 mô hình miền cho ba bài toán · §8 truy vết thực thể → quy tắc nghiệp vụ
- [03 — Mô hình động](../03-phan-tich/mo-hinh-dong.md) — máy trạng thái booking và luồng sự kiện
- [04 — Hợp đồng API](../04-thiet-ke/api.md) — §2 danh mục endpoint theo 13 module · §3 mười endpoint trọng yếu · §4 mã lỗi
- [04 — Thiết kế CSDL](../04-thiet-ke/csdl.md) — ràng buộc loại trừ và hai truy vấn tồn khả dụng `Q1`/`Q2`
- [05 — Kế hoạch kiểm thử](../05-ke-hoach/ke-hoach-kiem-thu.md) — 150 ca do tài liệu cấp mã cộng 20 hàng bảng quyết định · §12 bảng độ phủ theo module
- [05 — Quy tắc kỹ thuật](../05-ke-hoach/quy-tac-ky-thuat.md) · [05 — Quy tắc nhóm](../05-ke-hoach/quy-tac-nhom.md) · [05 — Quản lý rủi ro](../05-ke-hoach/quan-ly-rui-ro.md) — `RSK-19` gắn với `TC-SYS-06` của ma trận này

