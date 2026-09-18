# 00 — Tổng quan dự án

> Tài liệu gốc. Mọi tài liệu khác tham chiếu về đây để lấy định danh, tên thực thể và quyết định công nghệ.

---

## 1. Bối cảnh nghiệp vụ

Chủ chuỗi **Pine Hill** vận hành 3 cơ sở lưu trú tại ba địa điểm, tổng **55 phòng**. Hiện tại việc nhận đặt phòng diễn ra qua **nhiều kênh rời rạc**: khách gọi điện trực tiếp, lễ tân nhận khách vãng lai, và một phần lớn đến từ các **OTA** (Booking.com, Agoda, Airbnb). Mỗi cơ sở tự theo dõi phòng trống bằng sổ/Excel riêng, không có nguồn dữ liệu tồn phòng thống nhất.

Hệ quả quan sát được:

| Vấn đề hiện trạng | Nguyên nhân gốc | Hệ quả định lượng (giả định khảo sát) |
|---|---|---|
| Bán quá phòng (overbooking) | Ba sổ phòng độc lập, cập nhật tay, độ trễ đồng bộ OTA 15–60 phút | ~2–4 vụ/tháng vào cao điểm |
| Khách phải đổi phòng/sang cơ sở khác phút chót | Không có luồng xử lý chuẩn, nhân viên tự thoả thuận | Mất 1–2 giờ/ngày lễ, ảnh hưởng đánh giá OTA |
| Thất thoát doanh thu | Giá đặt thủ công, một giá cho mọi kênh, quên đổi giá cao điểm | Chênh 15–25% giá bán so với mức tối ưu |
| Tranh chấp hoàn cọc | Mốc huỷ quy định miệng, mỗi nhân viên hiểu một khác | 3–5 tranh chấp/tháng, mất uy tín |
| Không đo được hiệu quả kênh | Không tính hoa hồng OTA vào báo cáo | Không biết kênh nào thực sự sinh lời |

## 2. Ba bài toán nghiệp vụ trọng tâm

Đây là ba điểm khó được chủ đầu tư nêu trực tiếp; toàn bộ thiết kế phải chứng minh được cách giải.

### BT-1 — Chính sách huỷ và hoàn cọc theo mốc thời gian

- Mỗi **gói giá (RatePlan)** gắn một **chính sách huỷ (CancellationPolicy)** gồm nhiều **bậc mốc thời gian (CancellationTier)**.
- Mốc được tính bằng **giờ trước thời điểm nhận phòng** (14:00 giờ Việt Nam), không theo "ngày" — tránh tranh chấp kiểu "huỷ sáng nay tính là 1 ngày".
- Mức hoàn phụ thuộc **số tiền đã thực trả**, không phải tổng giá trị đặt phòng.
- Phải xử lý được: huỷ thường, huỷ do bất khả kháng (dịch/thiên tai), trả phòng sớm, đổi ngày, không đến (no-show), và huỷ do khách sạn (walk-out).
- Mọi khoản hoàn vượt ngưỡng phải có **phê duyệt hai cấp** và ghi nhật ký kiểm toán.

### BT-2 — Giá theo mùa cao điểm và theo kênh bán

- Giá = giá cơ bản của loại phòng **× hệ số mùa × hệ số cuối tuần × hệ số công suất × hệ số độ dài kỳ lưu trú × hệ số kênh**, sau đó làm tròn và kẹp trong sàn/trần.
- **Thứ tự áp dụng hệ số là cố định** và phải kiểm thử được — nếu không, hai nhân viên sẽ báo hai giá khác nhau.
- Giá được tính **cho từng đêm** rồi cộng lại (vì một kỳ lưu trú có thể bắc qua mùa cao điểm).
- Kênh OTA phải bán cao hơn kênh trực tiếp để bù **hoa hồng 15–18%**; hệ thống cảnh báo khi cấu hình vi phạm nguyên tắc này.

### BT-3 — Ghép và đổi phòng khi quá tải

- Cần **chặn bán quá ở tầng dữ liệu** (không chỉ ở tầng ứng dụng) — dùng ràng buộc loại trừ của PostgreSQL trên `(room_id, khoảng ngày)`.
- Cho phép **bán vượt có kiểm soát** (oversell) theo hạn mức phần trăm, chỉ trên kênh OTA, kèm hạn chót phải xử lý trước **T−24h**.
- **Thang xử lý khi quá tải:** đổi phòng cùng hạng → nâng hạng miễn phí → sang cơ sở khác (có hỗ trợ di chuyển) → walk-out (hoàn 100% + bồi thường).
- **Ghép phòng** theo nghĩa homestay: ghép hai booking độc lập vào cùng một phòng (giường tầng/phòng dorm), có đồng thuận của cả hai bên và giảm giá 20%; và ghép hai phòng thông nhau thành một đơn vị bán cho gia đình.
- Khách bị đổi phòng **giữ nguyên giá gốc** (`priceLocked = true`).

## 3. Phạm vi

### 3.1. Trong phạm vi

| # | Hạng mục | Ghi chú |
|---|----------|---------|
| 1 | Quản lý cơ sở, loại phòng, phòng vật lý, sơ đồ buồng | 3 cơ sở, 55 phòng |
| 2 | Quản lý tồn phòng tập trung (single source of truth) + allotment theo kênh | Nền tảng chống overbooking |
| 3 | Động cơ giá (mùa, cuối tuần, công suất, kênh, khuyến mãi) | BT-2 |
| 4 | Đặt phòng đa kênh: web khách, điện thoại, khách vãng lai, OTA (webhook) | 7 kênh |
| 5 | Giữ chỗ có thời hạn (hold) và hết hạn tự động | Chống giữ chỗ ảo |
| 6 | Cọc, thanh toán trực tuyến, thu số dư, hoàn tiền | VNPay/MoMo + tiền mặt |
| 7 | Động cơ chính sách huỷ & hoàn cọc | BT-1 |
| 8 | Phát hiện quá tải, đổi phòng/nâng hạng, ghép phòng, walk-out | BT-3 |
| 9 | Check-in / check-out / no-show / buồng phòng | Vận hành hằng ngày |
| 10 | Hồ sơ khách, hạng khách hàng, danh sách đen | CRM tối thiểu |
| 11 | Thông báo (email/SMS/Zalo OA) cho xác nhận, huỷ, đổi phòng | |
| 12 | Báo cáo: công suất, ADR/RevPAR, doanh thu theo kênh, huỷ & hoàn cọc, quá tải | Ban giám đốc |
| 13 | Nhật ký kiểm toán, phân quyền, cấu hình tham số | Toàn hệ thống |
| 14 | Web khách hàng (đặt phòng) + web back-office + ứng dụng Android cho lễ tân/quản lý | Nền tảng giao |

### 3.2. Ngoài phạm vi

| # | Hạng mục | Lý do |
|---|----------|-------|
| 1 | Tích hợp thật với API OTA (chỉ dựng adapter + hợp đồng, dữ liệu mô phỏng) | Không có quyền truy cập đối tác trong phạm vi môn học |
| 2 | Kênh thanh toán quốc tế (Stripe, PayPal) | Thị trường Việt Nam dùng VNPay/MoMo |
| 3 | Chương trình khách hàng thân thiết nâng cao (đổi điểm, đối tác) | Chỉ giữ tích điểm và phân hạng |
| 4 | Kế toán tổng hợp, kê khai thuế, phát hành hoá đơn điện tử | Ngoài biên hệ thống; chỉ xuất dữ liệu |
| 5 | Quản lý tài sản, kho, nhân sự và **xếp ca làm việc** | Không thuộc đề tài; hệ thống chỉ ghi người thu tiền và thời điểm để đối soát (BR-PAY-06) |
| 6 | Ứng dụng iOS | Ưu tiên Android theo yêu cầu; mã nguồn React Native dùng lại được về sau |
| 7 | Doanh thu F&B, dịch vụ spa, tour | Chỉ ghi nhận phụ thu phát sinh đơn giản khi check-out |
| 8 | Kênh đại lý/doanh nghiệp với hợp đồng giá riêng | Chỉ mức kênh `AGENCY` đơn giản |

## 4. Actor

| Mã | Actor | Loại | Mô tả & mục tiêu |
|----|-------|------|------------------|
| ACT-01 | Khách hàng (Guest) | Người | Tìm phòng, đặt, thanh toán, tự huỷ/đổi ngày, xem lịch sử |
| ACT-02 | Lễ tân (Front Desk) | Người | Check-in/out, nhận khách vãng lai, thu tiền, đổi phòng, ghi no-show |
| ACT-03 | Nhân viên đặt phòng (Reservation Agent) | Người | Nhận đặt qua điện thoại, giữ chỗ, nhập cọc |
| ACT-04 | Quản lý cơ sở (Property Manager) | Người | Duyệt ngoại lệ, xử lý quá tải, chốt giá cao điểm, xếp buồng phòng |
| ACT-05 | Chủ chuỗi (Owner) | Người | Cấu hình mùa/giá/kênh/chính sách huỷ, xem báo cáo toàn chuỗi |
| ACT-06 | Kế toán (Accountant) | Người | Đối soát cọc, hoàn tiền, hoa hồng OTA, công nợ |
| ACT-07 | Nhân viên buồng phòng (Housekeeping) | Người | Nhận & cập nhật trạng thái dọn phòng (trên Android) |
| ACT-08 | Cổng thanh toán (PSP) | Hệ thống ngoài | VNPay / MoMo: tạo giao dịch, callback kết quả |
| ACT-09 | Kênh OTA | Hệ thống ngoài | Booking.com / Agoda / Airbnb: đẩy đặt phòng, kéo tồn phòng & giá |
| ACT-10 | Dịch vụ thông báo | Hệ thống ngoài | Email (Resend), SMS, Zalo OA |
| ACT-11 | Dịch vụ lập lịch (Scheduler) | Hệ thống nội bộ | Hết hạn hold, quét quá tải T−24h, đánh dấu no-show, đồng bộ kênh |
| ACT-12 | Quản trị hệ thống (SysAdmin) | Người | Cấu hình tham số, phân quyền, sao lưu, xem nhật ký kiểm toán |

Trong sơ đồ use case, ACT-08/09/10/11 là **actor phụ (secondary)**; các actor còn lại là **actor chính**.

## 5. Sơ đồ module nghiệp vụ

Hệ thống chia thành 13 module. Mã module dùng trong định danh yêu cầu, use case, bảng, và gói mã nguồn.

| Mã | Module | Trách nhiệm chính | Bài toán |
|----|--------|-------------------|----------|
| AUTH | Định danh & phân quyền | Người dùng, vai trò, phạm vi cơ sở, phiên đăng nhập | |
| PROP | Cơ sở & buồng phòng | Cơ sở, loại phòng, phòng vật lý, trạng thái buồng, bảo trì | |
| INV | Tồn phòng | Lịch phòng, allotment theo kênh, khoá phòng, kiểm tra trống | BT-3 |
| RATE | Giá & mùa | Lịch giá, mùa, hệ số kênh, khuyến mãi, báo giá | BT-2 |
| BOOK | Đặt phòng | Tạo/sửa/huỷ đặt phòng, giữ chỗ, đổi ngày, vòng đời booking | BT-1, BT-3 |
| PAY | Thanh toán & hoàn tiền | Cọc, thanh toán, số dư, hoàn tiền, đối soát, hoa hồng | BT-1 |
| CHAN | Kênh bán | Cấu hình kênh, đồng bộ tồn/giá, nhận booking OTA | BT-3 |
| OVER | Quá tải & điều chuyển | Phát hiện quá tải, đổi phòng, nâng hạng, ghép phòng, walk-out | BT-3 |
| FO | Tiền sảnh | Check-in, check-out, no-show, buồng phòng | |
| CRM | Khách hàng | Hồ sơ khách, hạng, điểm, danh sách đen | |
| NOTI | Thông báo | Mẫu và hàng đợi thông báo đa kênh | |
| REP | Báo cáo | Công suất, ADR/RevPAR, doanh thu kênh, huỷ/hoàn, quá tải | |
| SYS | Nền tảng | Nhật ký kiểm toán, tham số hệ thống, việc nền, sao lưu | |

**Lưu ý về độ phủ quy tắc nghiệp vụ:** 13 nhóm BR không trùng khít 13 module. Hai module **không có nhóm BR riêng** và điều này là chủ đích:

- **NOTI** — hành vi gửi thông báo do `BR-SYS-06` (ghi vết, thử lại 3 lần) và các BR nghiệp vụ yêu cầu thông báo (`BR-OVER-10`, `BR-CANCEL-12`, `BR-BOOK-09`) quy định.
- **REP** — không có nhiều quy tắc nghiệp vụ riêng vì báo cáo là **dẫn xuất**; định nghĩa chỉ số nằm ở **`BR-REP-01`** (ADR, RevPAR, công suất, tỷ lệ huỷ, chi phí xử lý quá tải), còn số liệu lấy từ `BR-RATE-08`, `BR-OVER-15`, `BR-CANCEL-01…19`. Báo cáo sai số là lỗi tính toán, không phải lỗi quy tắc.

## 6. Quy ước định danh

| Tiền tố | Dùng cho | Định dạng | Ví dụ |
|---------|----------|-----------|-------|
| `BR-<MOD>-<nn>` | Quy tắc nghiệp vụ | số 2 chữ số, tăng dần | `BR-CANCEL-07` |
| `FR-<MOD>-<nn>` | Yêu cầu chức năng | | `FR-BOOK-03` |
| `NFR-<NHÓM>-<nn>` | Yêu cầu phi chức năng | nhóm: PERF, REL, SEC, USE, MAIN, COMP, OBS, LOC | `NFR-PERF-02` |
| `UC-<MOD>-<nn>` | Use case | | `UC-OVER-02` |
| `ACT-nn` | Actor | | `ACT-04` |
| `ENT-<Name>` | Thực thể miền | PascalCase | `ENT-CancellationTier` |
| `ADR-nnn` | Quyết định kiến trúc | | `ADR-004` |
| `TC-<MOD>-<nn>` | Ca kiểm thử | | `TC-CANCEL-05` |
| `RSK-nn` | Rủi ro | | `RSK-03` |
| `CRF-nn` | Phiếu yêu cầu thay đổi | | `CRF-05` |
| `TD-nn` | Mục nợ kỹ thuật | | `TD-02` |
| `BB-YYMMDD` | Biên bản họp | | `BB-261012` |
| `QĐ-nn` | Quyết định không thuộc phạm vi ADR | | `QĐ-04` |
| `E_<MOD>-<TÊN>` | Mã lỗi nghiệp vụ | định dạng `E_<MOD>_<TÊN>`; viết HOA, gạch dưới. **Nguồn chân lý đầy đủ: `docs/04-thiet-ke/api.md` §4.2** | `E_INV_ROOM_TAKEN` |
| `BT-n` | Bài toán nghiệp vụ trọng tâm | | `BT-2` |
| `PO/BA` · `ARCH` · `BE` · `FE` · `QA` | Mã 5 vai trò nhóm phát triển (không phải `UserRole` của hệ thống) | chữ hoa, cố định | `ARCH` |

**Quy tắc vàng:** một mã chỉ có một định nghĩa. Khi cần đổi nội dung, đổi nội dung tại định nghĩa gốc; mọi nơi khác chỉ tham chiếu mã.

## 7. Từ điển thực thể (nguồn chân lý về định danh)

Tên trường viết `camelCase` theo ngôn ngữ lập trình; cột CSDL là `snake_case` của cùng tên. Mọi tài liệu phân tích/thiết kế **chỉ được dùng đúng các tên dưới đây**. Muốn thêm trường mới → bổ sung vào bảng này trước.

### 7.1. Cơ sở & buồng phòng (PROP)

| Thực thể | Trường chính |
|----------|--------------|
| `Property` | `id`, `code`, `name`, `address`, `phone`, `checkInTime`, `checkOutTime`, `timezone`, `overbookLimitPct`, `status` |
| `RoomType` | `id`, `propertyId`, `code`, `name`, `capacityAdults`, `capacityChildren`, `bedCount`, `basePrice`, `minPrice`, `maxPrice`, `allowShared`, `status` |
| `Room` | `id`, `propertyId`, `roomTypeId`, `code`, `name`, `floor`, `bedCount`, `status`, `connectingRoomId`, `note` |
| `RoomBlock` | `id`, `roomId`, `startDate`, `endDate`, `reason`, `createdBy` |
| `HousekeepingTask` | `id`, `roomId`, `businessDate`, `status`, `assignedTo`, `note`, `completedAt` |

### 7.2. Giá & mùa (RATE)

| Thực thể | Trường chính |
|----------|--------------|
| `RatePlan` | `id`, `code`, `name`, `depositPercent`, `cancellationPolicyId`, `minNights`, `maxNights`, `losDiscountEnabled`, `rescheduleAllowed`, `fixedNightlyPrice` (rỗng = không dùng giá cố định), `status` |
| `RateCalendar` | `id`, `roomTypeId`, `propertyId`, `date`, `price`, `source` (`BASE`/`SEASON`/`OVERRIDE`/`RATE_PLAN`), `priority`, `channelCode` (rỗng = mọi kênh), `seasonId`, `reason`, `createdBy`, `createdAt` — dòng có `priority` cao nhất khớp `(roomTypeId, date, channelCode)` thắng (BR-RATE-02) |
| `Season` | `id`, `code` (SE-NY, SE-TET, SE-REUN, SE-NAT, SE-SUM, SE-SHO, SE-LOW), `propertyId` (rỗng = toàn chuỗi), `name`, `startDate`, `endDate`, `multiplier`, `priority`, `weekendSurchargeEnabled`, `createdAt`, `status` |
| `Channel` | `id`, `code`, `name`, `multiplier`, `commissionPct` (mặc định toàn chuỗi — BR-RATE-18), `holdMinutes`, `overbookAllowed`, `syncStatus` (`OK`/`DEGRADED`, BR-CHAN-07), `consecutiveSyncFailures`, `lastSyncAt`, `lastSyncError`, `status` |
| `ChannelPropertySetting` | `id`, `channelId`, `propertyId`, `commissionPct`, `multiplierOverride` (rỗng = dùng hệ số chuỗi), `effectiveFrom` — ghi đè hoa hồng/hệ số theo từng cơ sở (BR-RATE-18) |
| `ChannelAllotment` | `id`, `channelId`, `roomTypeId`, `date`, `allotment`, `used` |
| `Promotion` | `id`, `code`, `name`, `type`, `value`, `minNights`, `channelScope`, `roomTypeScope`, `validFrom`, `validTo`, `maxUses`, `usedCount`, `stackable`, `status` |
| `PriceQuote` | `id`, `propertyId`, `roomTypeId`, `ratePlanCode`, `channelCode`, `checkIn`, `checkOut`, `nights[]`, `subtotal`, `discountAmount`, `total`, `depositAmount`, `currency`, `quotedAt`, `expiresAt`, `engineVersion`. Mỗi phần tử `nights[]` = `{ date, basePrice, seasonMultiplier, weekendMultiplier, occupancyMultiplier, losMultiplier, channelMultiplier, clamped, nightlyPrice }`. `id` dùng để tra cứu lại báo giá trong 15 phút (BR-RATE-15) |
| `ChannelMapping` | `id`, `channelId`, `roomTypeId`, `externalRoomCode`, `externalRatePlanCode`, `status` — ánh xạ loại phòng ↔ mã phòng của kênh ngoài (BR-CHAN-08) |
| `OccupancySnapshot` | `id`, `propertyId`, `roomTypeId` (**rỗng = dòng tổng hợp cấp cơ sở — đây là dòng BR-RATE §4.3 đọc**), `date`, `physicalRooms` (= số phòng `ACTIVE` của cơ sở **sau khi trừ `RoomBlock` đang hiệu lực**), `soldRooms`, `occupancyPct`, `capturedAt` — ảnh chụp công suất, cập nhật mỗi 5 phút |

### 7.3. Đặt phòng (BOOK)

| Thực thể | Trường chính |
|----------|--------------|
| `Booking` | `id`, `seq` (số thứ tự tăng đơn điệu toàn hệ thống, dùng phá hoà BR-OVER-11), `code`, `guestId`, `propertyId`, `roomTypeId` (**loại phòng chủ đạo** — dùng cho tra cứu, báo cáo và booking một phòng; khi `roomCount > 1` nguồn chân lý là `BookingRoom.roomTypeId`), `ratePlanId`, `channelId`, `checkIn`, `checkOut`, `nights`, `adults`, `children`, `status`, `roomCount`, `totalAmount`, `depositPercent`, `depositAmount`, `paidAmount`, `refundedAmount`, `balanceDue`, `penaltyAmount`, `currency`, `holdExpiresAt`, `oversold`, `duplicateSuspected`, `rescheduleCount`, `channelPolicyCode` (mã chính sách huỷ của kênh ngoài, dùng khi `cancelReason = OTA_CANCELLATION`), `externalRef` (mã đặt phòng của kênh ngoài — khoá chống trùng và đối soát OTA, BR-CHAN-03/04), `priceLocked`, `note`, `createdBy`, `createdAt`, `cancelledAt`, `cancelReason` |
| `BookingRoom` | `id`, `bookingId`, `roomTypeId`, `adults`, `children`, `pricePerNight`, `status` (`ACTIVE`/`CANCELLED`), `cancelledAt` (phục vụ huỷ một phần — BR-CANCEL-19) |
| `RoomAssignment` | `id`, `bookingRoomId`, `roomId`, `bedNo` (**`0` = cả phòng** với loại bán theo phòng; `1..bedCount` với DOR — NOT NULL, mặc định 0), `startDate`, `endDate`, `validRange` (cột sinh), `releasedAt`. Khoá của ràng buộc loại trừ BR-INV-03 là bộ ba `(room_id, bed_no, valid_range)` |
| `BookingStatusHistory` | `id`, `bookingId`, `fromStatus`, `toStatus`, `reason`, `actorId`, `at` |
| `PriceSnapshot` | `id`, `bookingId`, `seq` (thứ tự tăng trong một booking), `kind` (`ORIGINAL`/`RESCHEDULE`/`PARTIAL_CANCEL` — BR-RATE-16, BR-CANCEL-19), `payloadJson`, `engineVersion`, `capturedAt` |
| `Hold` | `id`, `bookingId`, `channelId`, `expiresAt`, `status` (`ACTIVE`/`RELEASED`/`EXPIRED`), `releasedAt` — **bản ghi phụ trợ trong Redis để đếm nhanh; nguồn chân lý vẫn là `Booking.holdExpiresAt`** |

### 7.4. Điều chuyển phòng (OVER)

| Thực thể | Trường chính |
|----------|--------------|
| `OverbookingCase` | `id`, `propertyId`, `date`, `roomTypeId`, `shortageCount`, `status`, `detectedAt`, `resolvedAt`, `resolvedBy`, `delayReason` (lý do xử lý trễ khi quá T−24h, BR-OVER-16), `escalatedAt`, `resolvedNote` |
| `RoomMove` | `id`, `bookingId`, `bookingRoomId`, `moveType`, `fromRoomId`, `toRoomId`, `fromPropertyId`, `toPropertyId`, `reason`, `keepScore`, `priceLocked`, `compensationAmount`, `transportCost`, `approvedBy`, `status` (`PROPOSED`/`APPROVED`/`EXECUTED`/`REJECTED`/`CANCELLED`), `walkOutDocNo`, `guestSignatureRef`, `staffSignatureRef` (chỉ dùng cho `WALK_OUT`), `createdAt` |
| `RoomMerge` | `id`, `primaryBookingId`, `secondaryBookingId`, `roomId`, `consentPrimary`, `consentSecondary`, `discountPct`, `discountAmount`, `approvedBy`, `status` (`PENDING_CONSENT`/`APPROVED`/`ACTIVE`/`CANCELLED`), `createdAt` |

### 7.5. Thanh toán (PAY) & chính sách huỷ

| Thực thể | Trường chính |
|----------|--------------|
| `Payment` | `id`, `bookingId`, `type`, `method`, `amount`, `status`, `providerTxnId`, `idempotencyKey`, `paidAt`, `createdBy`, `note` |
| `RefundRequest` | `id`, `bookingId`, `paymentId`, `policyId`, `hoursBeforeCheckIn`, `appliedTierId`, `refundPercent`, `requestedAmount`, `approvedAmount`, `refundFee`, `netRefund` (cột sinh `refund_amount − refund_fee`, cơ sở mọi ngưỡng phê duyệt — BR-CANCEL-05/15), `status`, `isForceMajeure`, `evidenceRefs[]` (đường dẫn minh chứng bất khả kháng, BR-CANCEL-13), `reason` (**ràng buộc theo enum `CancelReason`**, không phải chuỗi tự do — BR-CANCEL-13/18 đối soát theo mã), `requestedBy`, `approvedBy`, `decidedAt`, `paidAt` |
| `CancellationPolicy` | `id`, `code`, `name`, `isDefault`, `earlyCheckoutFreeHours` (FLEX7/SAVER3 = 72 · LONGSTAY14 = 168 · NONREF = null, BR-CANCEL-09), `earlyCheckoutRefundPct` (50 · NONREF = 0), `status` |
| `CancellationTier` | `id`, `policyId`, `offsetHours`, `refundPercent`, `chargeFirstNight`, `label`, `sortOrder` |

### 7.6. Khách hàng (CRM) & hệ thống (SYS)

| Thực thể | Trường chính |
|----------|--------------|
| `Guest` | `id`, `fullName`, `gender` (`MALE`/`FEMALE`/`OTHER`/`UNSPECIFIED`), `phone`, `email`, `idNumber`, `dob`, `nationality`, `loyaltyTier`, `loyaltyPoints`, `totalStays`, `blacklisted`, `blacklistReason`, `notes`, `consentMarketing`, `consentAt`, `consentVersion`, `anonymizedAt` (mốc ẩn danh hoá thay cho xoá cứng — BR-CRM-05, NFR-COMP-01), `createdAt` |
| `GuestNote` | `id`, `guestId`, `content`, `authorId`, `createdAt` |
| `LoyaltyTransaction` | `id`, `guestId`, `bookingId`, `points`, `type`, `reason`, `createdAt` |
| `User` | `id`, `username`, `passwordHash`, `fullName`, `role`, `propertyScope[]`, `phone`, `isActive`, `failedLoginCount`, `lockedUntil`, `lastLoginAt` |
| `Notification` | `id`, `bookingId`, `recipient`, `channel`, `template`, `payloadJson`, `status`, `sentAt`, `retryCount`, `errorMessage` |
| `AuditLog` | `id`, `actorId`, `actorRole`, `action`, `entityType`, `entityId`, `beforeJson`, `afterJson`, `reason`, `ipAddress`, `at` |
| `SystemSetting` | `id`, `key`, `value`, `valueType`, `description`, `updatedBy`, `updatedAt` |
| `OutboxEvent` | `id`, `eventType`, `aggregateType`, `aggregateId`, `payloadJson`, `status`, `attempts`, `createdAt`, `processedAt` |
| `IdempotencyKey` | `id`, `key`, `actorId`, `requestHash`, `responseStatus`, `responseBodyJson`, `createdAt`, `expiresAt` — lưu kết quả thao tác ghi trong 24 giờ (BR-GEN-08) |

### 7.7. Giá trị miền (Value Object — bất biến, so sánh theo giá trị)

| VO | Trường | Bất biến cần giữ |
|----|--------|------------------|
| `Money` | `amount` (số nguyên VND), `currency` | Không dùng số thực; làm tròn tường minh |
| `StayPeriod` | `checkIn`, `checkOut` | `checkOut > checkIn`; tối thiểu 1 đêm |
| `DateRange` | `start`, `end` | Nửa mở `[start, end)` |
| `CancellationTierRule` | `offsetHours`, `refundPercent`, `chargeFirstNight` | `offsetHours` giảm dần, `refundPercent` trong `[0,100]`. **Đây là giá trị miền dùng khi tính toán; thực thể lưu trữ tương ứng là `CancellationTier` ở §7.5** |
| `ChannelContext` | `channelCode`, `commissionPct`, `multiplier` | Hoa hồng trong `[0,50]` |
| `PhoneNumber` | `raw`, `normalized` | Chuẩn hoá `+84…` |

### 7.8. Enum canonical

```
BookingStatus     = DRAFT | HELD | PENDING_PAYMENT | CONFIRMED | CHECKED_IN | CHECKED_OUT
                  | CANCELLED | NO_SHOW | EXPIRED
CancelReason      = GUEST_REQUEST | FORCE_MAJEURE | HOTEL_RELOCATION | PAYMENT_TIMEOUT
                  | DUPLICATE | NO_SHOW | SYSTEM | OTA_CANCELLATION | EARLY_CHECKOUT
RoomStatus        = ACTIVE | MAINTENANCE | INACTIVE
RoomBlockReason   = MAINTENANCE | RENOVATION | OWNER_USE | DEEP_CLEAN
HousekeepingStatus= PENDING | IN_PROGRESS | DONE | INSPECTED
ChannelCode       = WEB | PHONE | WALKIN | OTA_BOOKING | OTA_AGODA | OTA_AIRBNB | AGENCY
RatePlanCode      = FLEX7 | SAVER3 | NONREF | LONGSTAY14
RateSource        = BASE | SEASON | OVERRIDE | RATE_PLAN
PromotionType     = PERCENT | AMOUNT
PaymentType       = DEPOSIT | BALANCE | REFUND | PENALTY | EXTRA_SERVICE
                  | COMPENSATION | RESCHEDULE_FEE
PaymentMethod     = VNPAY | MOMO | CASH | BANK_TRANSFER | OTA_COLLECT
PaymentStatus     = PENDING | SUCCEEDED | FAILED | REVERSED
RefundStatus      = PENDING | APPROVED | REJECTED | PAID | CANCELLED
OverbookingCaseStatus = OPEN | PROPOSED | RESOLVED | ESCALATED
ChannelSyncStatus = OK | DEGRADED
PropertyStatus    = ACTIVE | INACTIVE
HoldStatus        = ACTIVE | RELEASED | EXPIRED
PriceSnapshotKind = ORIGINAL | RESCHEDULE | PARTIAL_CANCEL
BookingRoomStatus = ACTIVE | CANCELLED
NotificationStatus= PENDING | SENT | FAILED
LoyaltyTxnType    = EARN | REDEEM | EXPIRE | ADJUST
MoveType          = SAME_TYPE_SAME_PROPERTY | UPGRADE_SAME_PROPERTY | SAME_TYPE_CROSS_PROPERTY
                  | UPGRADE_CROSS_PROPERTY | WALK_OUT | SPLIT_ROOMS | MERGE_SHARE | MERGE_CONNECTING
LoyaltyTier       = GUEST | MEMBER | SILVER | GOLD | PLATINUM
UserRole          = OWNER | MANAGER | FRONT_DESK | RESERVATION_AGENT | ACCOUNTANT | HOUSEKEEPING
NotificationChannel = EMAIL | SMS | ZALO_OA | PUSH
```

Quan hệ `BookingStatus` hợp lệ — xem [03/mô hình động](03-phan-tich/mo-hinh-dong.md) §2.

## 8. Danh mục Use Case

Danh mục dưới đây là **nguồn chân lý về mã UC** cho ma trận truy vết. Đặc tả chi tiết ở [01/mô hình use case](01-yeu-cau/mo-hinh-use-case.md).

| Nhóm | Mã | Tên use case | Actor chính |
|-------|----|--------------|-------------|
| AUTH | UC-AUTH-01 | Đăng nhập hệ thống | Tất cả người dùng nội bộ |
| AUTH | UC-AUTH-02 | Quản lý người dùng & vai trò | ACT-05, ACT-12 |
| AUTH | UC-AUTH-03 | Đăng ký & đăng nhập khách hàng | ACT-01 |
| PROP | UC-PROP-01 | Quản lý cơ sở | ACT-05 |
| PROP | UC-PROP-02 | Quản lý loại phòng | ACT-05, ACT-04 |
| PROP | UC-PROP-03 | Quản lý phòng & sơ đồ buồng | ACT-04, ACT-02 |
| PROP | UC-PROP-04 | Khoá phòng bảo trì / ngừng bán | ACT-04 |
| INV | UC-INV-01 | Xem lịch tồn phòng (grid theo ngày) | ACT-02, ACT-03, ACT-04 |
| INV | UC-INV-02 | Kiểm tra phòng trống & báo giá | ACT-01, ACT-03, ACT-09 |
| INV | UC-INV-03 | Quản lý allotment theo kênh | ACT-05, ACT-04 |
| RATE | UC-RATE-01 | Cấu hình gói giá, chính sách huỷ, giá cơ bản & lịch giá | ACT-05 |
| RATE | UC-RATE-02 | Cấu hình mùa & hệ số mùa | ACT-05 |
| RATE | UC-RATE-03 | Cấu hình hệ số & hoa hồng theo kênh | ACT-05 |
| RATE | UC-RATE-04 | Quản lý khuyến mãi | ACT-05, ACT-04 |
| RATE | UC-RATE-05 | Xem trước báo giá đa kênh | ACT-04, ACT-05 |
| BOOK | UC-BOOK-01 | Tạo đặt phòng trên web | ACT-01 |
| BOOK | UC-BOOK-02 | Tạo đặt phòng tại quầy (khách vãng lai) | ACT-02 |
| BOOK | UC-BOOK-03 | Tạo đặt phòng qua điện thoại | ACT-03 |
| BOOK | UC-BOOK-04 | Giữ chỗ tạm thời và tự động hết hạn | ACT-01, ACT-11 |
| BOOK | UC-BOOK-05 | Sửa đổi đặt phòng | ACT-02, ACT-03, ACT-04 |
| BOOK | UC-BOOK-06 | Đổi ngày lưu trú (reschedule) | ACT-01, ACT-03 |
| BOOK | UC-BOOK-07 | Tra cứu & xem chi tiết đặt phòng | ACT-01..04 |
| BOOK | UC-BOOK-08 | Huỷ đặt phòng (toàn phần hoặc một phần) & tính hoàn cọc | ACT-01..04 |
| PAY | UC-PAY-01 | Ghi nhận tiền cọc | ACT-02, ACT-03, ACT-06 |
| PAY | UC-PAY-02 | Thanh toán trực tuyến qua cổng thanh toán | ACT-01, ACT-08 |
| PAY | UC-PAY-03 | Thu số dư khi check-in | ACT-02 |
| PAY | UC-PAY-04 | Duyệt và chi hoàn tiền | ACT-04, ACT-06 |
| PAY | UC-PAY-05 | Đối soát doanh thu, hoa hồng & công nợ | ACT-06 |
| CHAN | UC-CHAN-01 | Cấu hình kênh bán | ACT-05 |
| CHAN | UC-CHAN-02 | Đồng bộ tồn phòng & giá lên OTA | ACT-11 |
| CHAN | UC-CHAN-03 | Nhận đặt phòng từ OTA | ACT-09 |
| OVER | UC-OVER-01 | Phát hiện & cảnh báo nguy cơ quá tải | ACT-11, ACT-04 |
| OVER | UC-OVER-02 | Đổi phòng / nâng hạng cho khách | ACT-02, ACT-04 |
| OVER | UC-OVER-03 | Ghép phòng cho hai booking | ACT-02, ACT-04 |
| OVER | UC-OVER-04 | Walk-out và bồi thường khách | ACT-04 |
| OVER | UC-OVER-05 | Duyệt ngoại lệ chính sách (bất khả kháng, hoàn 100%) | ACT-04, ACT-05 |
| FO | UC-FO-01 | Check-in khách | ACT-02 |
| FO | UC-FO-02 | Check-out, trả phòng sớm & thu phát sinh | ACT-02 |
| FO | UC-FO-03 | Cập nhật trạng thái buồng phòng | ACT-07, ACT-02 |
| FO | UC-FO-04 | Ghi nhận khách không đến (no-show) | ACT-02, ACT-11 |
| CRM | UC-CRM-01 | Quản lý hồ sơ khách | ACT-02, ACT-03 |
| CRM | UC-CRM-02 | Tích điểm & phân hạng khách hàng | ACT-11, ACT-06 |
| CRM | UC-CRM-03 | Quản lý danh sách đen | ACT-04, ACT-05 |
| NOTI | UC-NOTI-01 | Gửi xác nhận đặt phòng & nhắc hẹn | ACT-11 |
| NOTI | UC-NOTI-02 | Thông báo thay đổi, huỷ, hoàn tiền | ACT-11 |
| REP | UC-REP-01 | Báo cáo công suất, ADR, RevPAR | ACT-05, ACT-04 |
| REP | UC-REP-02 | Báo cáo doanh thu theo kênh | ACT-05, ACT-06 |
| REP | UC-REP-03 | Báo cáo huỷ phòng & hoàn cọc | ACT-05, ACT-06 |
| REP | UC-REP-04 | Báo cáo quá tải & điều chuyển phòng | ACT-04, ACT-05 |
| SYS | UC-SYS-01 | Xem nhật ký kiểm toán | ACT-05, ACT-12 |
| SYS | UC-SYS-02 | Cấu hình tham số hệ thống | ACT-12, ACT-05 |
| SYS | UC-SYS-03 | Sao lưu & phục hồi dữ liệu | ACT-12 |

**Tổng: 52 use case** (3 AUTH · 4 PROP · 3 INV · 5 RATE · 8 BOOK · 5 PAY · 3 CHAN · 5 OVER · 4 FO · 3 CRM · 2 NOTI · 4 REP · 3 SYS).

## 9. Quyết định công nghệ đã chốt

| Lớp | Lựa chọn | Lý do | ADR |
|-----|----------|-------|-----|
| Ngôn ngữ | TypeScript 5.x, `strict: true` | Chia sẻ miền nghiệp vụ giữa web, mobile và API | ADR-001 |
| API | NestJS 11 (Node 22 LTS) + Fastify adapter | DI + module rõ ràng, phù hợp trình diễn nguyên lý thiết kế hướng đối tượng | ADR-002 |
| CSDL | PostgreSQL 16 | Cần ràng buộc loại trừ `btree_gist` để chống trùng phòng ở tầng dữ liệu | ADR-003 |
| ORM | Prisma 6 + migration SQL thủ công cho ràng buộc đặc biệt | Sinh kiểu an toàn; migration thủ công cho phần Prisma chưa hỗ trợ | ADR-003 |
| Cache & khoá | Redis 7 | Giữ chỗ, khoá phân tán, hàng đợi việc nền (BullMQ) | ADR-004 |
| Web | Next.js 15 (App Router) + Tailwind + shadcn/ui | Một codebase cho cả trang khách và back-office | ADR-005 |
| Mobile | Expo (React Native) + Expo Router, phát hành Android | Một mã nguồn, phát hành APK/EAS, không cần Xcode | ADR-006 |
| Chia sẻ mã | `packages/domain` (thuần, không phụ thuộc I/O) + `packages/contracts` (zod) | Động cơ giá và chính sách huỷ phải cho cùng kết quả trên mọi giao diện | ADR-007 |
| Giao tiếp API | REST/JSON + OpenAPI 3.1 sinh từ zod | Dễ vẽ sequence, dễ mô phỏng OTA, dễ chấm điểm. Quy ước bao hình danh sách (`data` + `meta{limit,nextCursor,hasMore,total}`), phân trang con trỏ, và toàn bộ 45 mã lỗi `E_*` do [04/api.md](04-thiet-ke/api.md) quy định | ADR-008 |
| Thanh toán | VNPay + MoMo (sandbox) + tiền mặt/chuyển khoản | Thị trường Việt Nam | ADR-009 |
| Xác thực | JWT (access 15 phút + refresh 7 ngày), RBAC + phạm vi cơ sở | Yêu cầu phân quyền theo cơ sở | ADR-010 |
| Kiểm thử | Vitest + fast-check (miền), Testcontainers + Supertest (tích hợp), Playwright (web), Maestro (Android), **k6 (tải)** | Bao phủ bất biến quan trọng và chứng minh ngưỡng hiệu năng | ADR-011 |
| Quan sát | Log JSON có mã tương quan, **OpenTelemetry + Prometheus + Grafana**, cảnh báo theo SLO | NFR-OBS-01…04 yêu cầu đo được 4 tín hiệu vàng và ngưỡng nghiệp vụ | ADR-012 |
| CI/CD | GitHub Actions → Docker (API) + Vercel (web) + EAS Build (Android) | | ADR-012 |
| Tài liệu | Mermaid trong Markdown, lưu cùng mã nguồn | Diff được, không lệch khỏi mã | ADR-013 |

## 10. Cấu trúc repository đích

```
ooad-homestay/
├── apps/
│   ├── api/                     # NestJS: HTTP, use case, hạ tầng
│   │   └── src/modules/{auth,prop,inv,rate,book,pay,chan,over,fo,crm,noti,rep,sys}/
│   ├── web/                     # Next.js: (guest) đặt phòng + (admin) back-office
│   └── mobile/                  # Expo: Android cho lễ tân / quản lý / buồng phòng
│       └── src/{app,components,screens,hooks,api}/
├── packages/
│   ├── domain/                  # THUẦN: price-engine, cancellation-policy, availability,
│   │                            #        overbooking-planner, value-objects, errors
│   ├── contracts/               # zod schema + kiểu DTO + OpenAPI
│   └── config/                  # tsconfig, eslint, prettier dùng chung
├── infra/
│   ├── docker-compose.yml       # postgres, redis, mailhog
│   └── sql/                     # migration thủ công (ràng buộc loại trừ, chỉ mục riêng)
├── docs/                        # chính tài liệu này
│   └── 05-ke-hoach/nhat-ky/     # BB- (biên bản họp), CRF- (phiếu đổi yêu cầu), TD- (nợ kỹ thuật)
└── .github/workflows/           # ci.yml, e2e-nightly.yml, eas-build.yml
```

**Quy tắc bất di bất dịch:** `packages/domain` **không được** import Prisma, Nest, HTTP, `Date.now()` hay bất kỳ I/O nào. Thời gian, mã định danh, và tỷ giá đều truyền vào qua tham số. Đây là điều kiện để kiểm thử bất biến nghiệp vụ bằng hàm thuần.

## 11. Câu hỏi mở cần chủ đầu tư xác nhận

Chặn tiến độ nếu chưa trả lời trước **hết Tuần 2**. Giá trị mặc định dưới đây được dùng tạm để thiết kế không bị nghẽn.

| Mã | Câu hỏi | Mặc định tạm dùng | Chặn gì |
|----|---------|-------------------|---------|
| Q-01 | Mức cọc mặc định cho từng gói giá? | FLEX7 30%, SAVER3 50%, NONREF 100%, LONGSTAY14 30% | BR-CANCEL-02 |
| Q-02 | Có thu phí xử lý khi hoàn tiền không? | Không thu (`refundFee = 0`), nhưng cấu hình được | BR-CANCEL-11 |
| Q-03 | Tỷ lệ hoa hồng thực tế của từng OTA? | Booking 18%, Agoda 17%, Airbnb 15% | BR-RATE-18 |
| Q-04 | Cho phép bán vượt bao nhiêu phần trăm? | 0% mặc định; Owner có thể bật tối đa 5% cho kênh OTA | BR-OVER-02 |
| Q-05 | Quy tắc ghép phòng: có cho ghép khác giới tính không? | Không. Ngoại lệ đòi hỏi **đồng thời** hai khách đồng ý trên hệ thống **và** `MANAGER`+ duyệt kèm lý do | BR-OVER-13, BR-OVER-14 |
| Q-06 | Có phụ thu trẻ em / thêm giường không? | Trẻ dưới 6 tuổi miễn phí (tối đa 2 trẻ/phòng); 6–11 tuổi 50% giá người lớn; từ 12 tuổi tính người lớn | BR-BOOK-05 |
| Q-07 | Có xuất hoá đơn VAT cho khách doanh nghiệp không? | Có ghi nhận yêu cầu, không phát hành trong hệ thống | Ngoài phạm vi |
| Q-08 | Giờ nhận/trả phòng chuẩn? | Nhận 14:00, trả 12:00 | BR-GEN-04 |
| Q-09 | Thời hạn hoàn tiền cam kết với khách? | Xử lý trong 3 ngày làm việc, tối đa 7 ngày | BR-CANCEL-12 |
| Q-10 | Ba cơ sở đặt tại địa điểm nào? | CS-01 Đà Lạt (24 phòng), CS-02 Vũng Tàu (18), CS-03 Phan Thiết (13) | Toàn bộ tài liệu |
| Q-11 | Quy trình xử lý khi khách trả phòng sớm? | Cơ sở tính = `min(paidAmount, tổng giá các đêm chưa ở theo PriceSnapshot)`; `FLEX7` và `SAVER3` báo trước ≥ 72h → hoàn 50%; `LONGSTAY14` ≥ 168h → 50%; `NONREF` → 0%; dưới ngưỡng → 0%; lý do ghi nhận `EARLY_CHECKOUT` | BR-CANCEL-09 |
| Q-12 | Có cho phép đổi ngày miễn phí không? | 1 lần miễn phí khi ≥168h với FLEX7/SAVER3/LONGSTAY14 | BR-BOOK-12 |

## 12. Tiêu chí thành công của dự án

| # | Tiêu chí | Cách đo |
|---|----------|---------|
| 1 | Không còn bán trùng phòng trên cùng một phòng cùng một đêm | Kiểm thử tải 200 yêu cầu đồng thời, 0 vụ trùng; ràng buộc CSDL từ chối mọi trường hợp |
| 2 | Mọi khoản hoàn cọc tính đúng theo bậc mốc thời gian | 100% ca kiểm thử bảng quyết định ở [02/chính sách huỷ](02-nghiep-vu/chinh-sach-huy-hoan-coc.md) §6 đạt |
| 3 | Giá báo cho khách trên web, mobile và quầy luôn khớp | Kiểm thử đối chiếu 3 nền tảng trên cùng đầu vào |
| 4 | Quá tải được phát hiện trước 24 giờ | 100% ca quá tải có bản ghi `OverbookingCase` trước T−24h |
| 5 | Thời gian lễ tân xử lý một khách vãng lai < 3 phút | Đo trên bản dựng thử với 20 lượt |
| 6 | Ban giám đốc tự xem được báo cáo doanh thu theo kênh | UC-REP-02 hoạt động không cần hỗ trợ kỹ thuật |
| 7 | Truy vết đầy đủ | 100% BR có ít nhất một UC và một ca kiểm thử trong [06/ma trận truy vết](06-truy-vet/ma-tran-truy-vet.md) |

> **Lưu ý về đường cơ sở:** các số liệu hiện trạng ở §1 (2–4 vụ quá tải/tháng, chênh giá 15–25%, 3–5 tranh chấp/tháng) là **giả định khảo sát**, chưa phải số đo. Trước khi dùng chúng làm mốc so sánh cho tiêu chí 1–6, nhóm PHẢI thay bằng số liệu thật thu thập ở GĐ-0 và ghi lại trong báo cáo khảo sát (M1). Tiêu chí 1–4 là ngưỡng tuyệt đối nên không phụ thuộc đường cơ sở.
