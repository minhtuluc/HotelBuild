# 02 — Quy tắc nghiệp vụ (nguồn chân lý)

> Mọi tài liệu khác **tham chiếu mã BR**, không chép lại giá trị. Đổi số ở đây là đổi toàn hệ thống.
> Mỗi quy tắc viết ở dạng kiểm thử được: **điều kiện → hành vi bắt buộc**. Định danh & enum lấy từ [00 §7](../00-tong-quan.md#7-từ-điển-thực-thể-nguồn-chân-lý-về-định-danh).

---

## 0. Quy ước diễn đạt

| Từ | Nghĩa |
|----|-------|
| **PHẢI (MUST)** | Bắt buộc, vi phạm là lỗi |
| **KHÔNG ĐƯỢC (MUST NOT)** | Cấm tuyệt đối |
| **NÊN (SHOULD)** | Khuyến nghị, lệch phải ghi lý do |
| `T−24h` | 24 giờ trước thời điểm nhận phòng của booking |
| `giờ VN` | Múi giờ `Asia/Ho_Chi_Minh` (UTC+7), không có giờ mùa |

`MANAGER+` trong bộ tài liệu chỉ viết tắt tập `{MANAGER, OWNER}` tại **thao tác có nêu quyền đó**, không biểu diễn kế thừa vai trò. Các quyết định tạm ở 00 §11 chưa phải xác nhận của chủ đầu tư.

---

## 1. BR-GEN — Quy tắc chung

| Mã | Quy tắc |
|----|---------|
| BR-GEN-01 | Mọi giá trị tiền tệ PHẢI là **số nguyên VND**. KHÔNG ĐƯỢC dùng số thực (`float`/`number` thập phân) để tính tiền ở bất kỳ tầng nào. |
| BR-GEN-02 | Mọi mốc thời gian PHẢI lưu ở **UTC** trong CSDL và chỉ chuyển sang giờ VN khi hiển thị hoặc khi so mốc nghiệp vụ. |
| BR-GEN-03 | Làm tròn tiền: **lên** bội số 1.000 VND với giá bán và tiền cọc; **xuống** bội số 1.000 VND với tiền hoàn tính theo chính sách huỷ. Ngoại lệ: hoàn tiền của booking **chưa** xác nhận (BR-BOOK-18) trả đúng số đã thu, không làm tròn ([QĐ-05](../05-ke-hoach/nhat-ky/QD-05-chot-engine-f2f3.md)). |
| BR-GEN-04 | Thời điểm nhận phòng danh nghĩa = ngày `checkIn` lúc `Property.checkInTime` (mặc định **14:00 giờ VN**). Thời điểm trả phòng danh nghĩa = ngày `checkOut` lúc `Property.checkOutTime` (mặc định **12:00 giờ VN**). |
| BR-GEN-05 | Múi giờ nghiệp vụ của mọi cơ sở là `Asia/Ho_Chi_Minh`; hệ thống chưa hỗ trợ cơ sở ở múi giờ khác. |
| BR-GEN-06 | Mã đặt phòng sinh theo `PH-<YYMMDD>-<5 ký tự A-Z0-9>`; PHẢI duy nhất toàn hệ thống kể cả khi hai yêu cầu đến cùng mili-giây. |
| BR-GEN-07 | Mọi thao tác ghi làm thay đổi `Booking`, `Payment`, `RefundRequest`, `RoomMove`, `SystemSetting` PHẢI tạo một bản ghi `AuditLog` trong cùng transaction. |
| BR-GEN-08 | Mọi thao tác ghi từ giao diện PHẢI mang `Idempotency-Key`; gửi lại cùng khoá trong 24 giờ trả về đúng kết quả cũ, không tạo bản ghi mới. Khoá gắn principal + thao tác + hash payload; cùng khoá khác payload phải xung đột; đang xử lý trả trạng thái đang xử lý, không chạy lặp. Kiểm tra quyền hiện tại trước trả kết quả lưu. |

---

## 2. BR-PROP — Cơ sở & buồng phòng

| Mã | Quy tắc |
|----|---------|
| BR-PROP-01 | Chuỗi có đúng 3 cơ sở đang hoạt động; tổng số phòng `ACTIVE` là **55**. |
| BR-PROP-02 | Phân bổ phòng: CS-01 Đà Lạt **24**, CS-02 Vũng Tàu **18**, CS-03 Phan Thiết **13**. |
| BR-PROP-03 | Phân bổ theo loại: Standard 20, Superior 13, Deluxe 12, Family 6, Dorm 4 phòng (mỗi phòng 6 giường) — xem ma trận theo từng cơ sở ngay dưới bảng. |
| BR-PROP-04 | Sức chứa: STD 2 · SUP 2 · DLX 3 · FAM 4 · DOR 6 giường. **Đơn vị bán** của DOR là **giường** (`bedCount` = 6), các loại còn lại là **phòng** (`bedCount` = `capacityAdults`). Đơn vị bán là đơn vị tính tồn khả dụng (BR-INV-01/03) và tính giá (BR-RATE-03). |
| BR-PROP-05 | Mã cơ sở dùng trong định danh là `CS01`, `CS02`, `CS03` (**không** có gạch nối; `CS-01` chỉ là nhãn hiển thị). Mã phòng duy nhất trong phạm vi một cơ sở, định dạng `<mã cơ sở>-<tầng><số>`, ví dụ `CS01-201`. |
| BR-PROP-06 | Phòng ở trạng thái `MAINTENANCE` hoặc `INACTIVE` KHÔNG ĐƯỢC xuất hiện trong kết quả tìm phòng và không tính vào tồn khả dụng. |

**Ma trận phân bổ phòng theo cơ sở × loại phòng** (nguồn chân lý của BR-PROP-03):

| Cơ sở | STD | SUP | DLX | FAM | DOR | Tổng phòng | Tổng đơn vị bán |
|-------|-----|-----|-----|-----|-----|-----------|------------------|
| CS-01 Đà Lạt | 8 | 6 | 5 | 3 | 2 | **24** | 24 − 2 + 12 = **34** |
| CS-02 Vũng Tàu | 7 | 4 | 4 | 2 | 1 | **18** | 18 − 1 + 6 = **23** |
| CS-03 Phan Thiết | 5 | 3 | 3 | 1 | 1 | **13** | 13 − 1 + 6 = **18** |
| **Toàn chuỗi** | **20** | **13** | **12** | **6** | **4** | **55** | **75** |

> *Tổng đơn vị bán* = số phòng, nhưng mỗi phòng DOR được tính bằng 6 giường thay vì 1 đơn vị → đây là con số dùng cho tồn khả dụng và cho hạn mức `ChannelAllotment` (BR-INV-01, BR-INV-05), không dùng cho đếm phòng vật lý.

---

## 3. BR-INV — Tồn phòng

| Mã | Quy tắc |
|----|---------|
| BR-INV-01 | Tính theo từng `(propertyId, roomTypeId, đêm)` và **đơn vị bán**. `supply` = số đơn vị của phòng `ACTIVE` không bị block (nhiều block trùng chỉ loại đơn vị một lần). `demand` = số `BookingRoom` hiệu lực của `CONFIRMED`/`CHECKED_IN` và `HELD`/`PENDING_PAYMENT` có `holdExpiresAt > now`, gồm cả oversold chưa gán và hold **mọi kênh**. Một đơn vị chỉ đếm một lần, không cộng thêm assignment. Sau điều chuyển, nhu cầu theo loại/cơ sở thực tế được cấp; phần chưa gán theo loại/cơ sở đã cam kết. `pool = supply − demand` có thể âm để phát hiện thiếu; tồn bán thường = `max(0, pool)`. `used` của kênh = phần demand thuộc chính kênh, **gồm mọi hold còn hạn**, đã/chưa gán; tồn kênh có hạn mức = `max(0, min(pool, allotment − used))`. WEB/PHONE/WALKIN không hạn mức riêng. Tồn vật lý để gán = tập đơn vị ACTIVE trừ **hợp** tập bị block và tập đã gán, không trừ hai lần phần giao. Tồn thương mại và chỗ gán vật lý phải cùng đạt yêu cầu khi bán thường. |
| BR-INV-02 | Việc **kiểm tra tồn và giữ chỗ** PHẢI nằm trong **một transaction** có khoá bi quan theo `(roomTypeId, date)` (`SELECT … FOR UPDATE`). KHÔNG ĐƯỢC kiểm tra tồn ở tầng ứng dụng rồi ghi sau. |
| BR-INV-03 | Bất biến cứng: với mọi cặp **(đơn vị bán, đêm)**, số `RoomAssignment` đang hoạt động **≤ 1**. *Đơn vị bán* = **giường** với loại phòng bán theo giường (DOR), = **phòng** với mọi loại khác; biểu diễn bằng `bed_no` với **`bed_no = 0` nghĩa là "cả phòng"**, `1..bedCount` nghĩa là giường cụ thể. Ràng buộc PHẢI được ép ở tầng CSDL bằng ràng buộc loại trừ trên bộ khoá tổ hợp **`(room_id, bed_no, valid_range)`**, không chỉ ở mã ứng dụng. **Cấm** dùng khoá đơn sinh kiểu `COALESCE(bed_no::text, room_id)`: số giường lặp lại ở mọi phòng nên khoá đó va chạm giữa các phòng khác nhau. Khi ràng buộc từ chối (`23P01` của PostgreSQL), tầng ứng dụng PHẢI bắt và chuyển thành mã lỗi `E_INV_ROOM_TAKEN` (HTTP 409) — **không được** nuốt lỗi rồi báo thành công. |
| BR-INV-04 | Hold hết hạn PHẢI được giải phóng trong vòng **60 giây** kể từ `holdExpiresAt`; phòng giải phóng phải trở lại tồn khả dụng ngay. |
| BR-INV-05 | `ChannelAllotment.allotment` của một ngày KHÔNG ĐƯỢC vượt quá số **đơn vị bán** `ACTIVE` của loại phòng tương ứng (giường với DOR, phòng với loại khác). Hạn mức **hiệu lực** để bán luôn là `min(allotment − used, tồn chung theo BR-INV-01)` nên `RoomBlock` và booking đã bán vẫn chặn được kênh. |
| BR-INV-06 | `RoomBlock` chồng lấn với một `RoomAssignment` đang hoạt động PHẢI bị từ chối, trừ khi người thao tác là `MANAGER`+ và có lý do. Khi đó hệ thống PHẢI mở `OverbookingCase` cho các booking bị ảnh hưởng. |
| BR-INV-07 | Kiểm tra tồn cho khoảng ngày PHẢI xét **từng đêm riêng biệt**; một kỳ lưu trú chỉ khả dụng khi **mọi** đêm đều còn phòng. Khi không còn phòng, API trả lỗi `E_INV_NO_AVAILABILITY` (HTTP 409) kèm danh sách đêm thiếu. |

BR-INV-03 còn yêu cầu: DOR chỉ nhận `bedNo` từ 1 tới `Room.bedCount`; loại bán cả phòng chỉ nhận 0. Cấm trộn 0 và giường lẻ trong cùng phòng; không đổi loại bán/số giường khi còn assignment tương lai. Với một `BookingRoom`, phải có một phòng/giường liên tục cả kỳ hoặc phương án chia đoạn được khách chấp thuận; chỉ có chỗ trống rời rạc từng đêm chưa đủ để hứa cùng phòng cả kỳ. Dọn phòng không làm giảm supply tương lai (BR-FO-06/07).

---

## 4. BR-RATE — Giá, mùa, kênh bán

### 4.1. Công thức giá (bắt buộc, theo đúng thứ tự)

Giá được tính **cho từng đêm**, sau đó cộng lại.

```
1.  base        = resolveBaseRate(roomTypeId, date, channelCode, ratePlanId)
                  → dòng RateCalendar khớp (roomType, date, kênh) có `priority` cao nhất:
                    OVERRIDE 100 → gói giá cố định 90 → SEASON 50 → BASE 10
                  → không dòng nào khớp thì dùng RoomType.basePrice
2.  p1          = base × hệ số mùa
3.  p2          = p1 × hệ số cuối tuần        (bỏ qua nếu season.weekendSurchargeEnabled = false)
4.  p3          = p2 × hệ số công suất
5.  p4          = p3 × hệ số độ dài kỳ lưu trú (bỏ qua nếu ratePlan.losDiscountEnabled = false)
6.  p5          = p4 × hệ số kênh
7.  p6          = clamp(p5, roomType.minPrice, roomType.maxPrice)
8.  nightlyPrice= làm tròn LÊN bội số 1.000 VND
9.  subtotal    = Σ nightlyPrice
10. discount    = khuyến mãi (mục 4.6)
11. total       = làm tròn XUỐNG bội số 1.000 VND của (subtotal − discount)
```

| Mã | Quy tắc |
|----|---------|
| BR-RATE-01 | Thứ tự áp dụng hệ số ở trên là **cố định**. Cấm mọi thứ tự khác, cấm áp khuyến mãi trước khi làm tròn từng đêm. Ngưỡng của **bước 4 (hệ số công suất)** cũng thuộc quy tắc này và PHẢI là: < 80% → `1,00`; 80%–94,99% → `1,15`; ≥ 95% → `1,25`; `OccupancySnapshot` cũ hơn 5 phút coi như không có và dùng `1,00`. Ngưỡng và cửa sổ hiệu lực cấu hình được qua `SystemSetting` (`pricing.occupancyMidPct` = 80, `pricing.occupancyHighPct` = 95). Nếu snapshot cũ hơn 5 phút **liên tục quá 15 phút**, hệ thống PHẢI phát cảnh báo vận hành (job `OccupancySnapshot` hỏng) — giá vẫn tính với hệ số `1,00` nhưng doanh thu bị mất do không áp được giá phòng cuối. |
| BR-RATE-02 | Giá cơ bản của một đêm tra trong `RateCalendar` theo `priority` **giảm dần**; dòng đầu tiên khớp `(roomTypeId, date)` và `ratePlanId` nếu nguồn RATE_PLAN và — nếu dòng có khai `channelCode` — khớp cả kênh bán, sẽ thắng. Thứ tự ưu tiên: ghi đè tường minh `OVERRIDE` (100) → giá cố định của gói giá `RATE_PLAN` (90) → lịch giá theo mùa `SEASON` (50) → giá nền `BASE` (10). RATE_PLAN bắt buộc ratePlanId, fixedNightlyPrice là giá base của chính gói ở priority 90 (lịch RATE_PLAN cụ thể thắng giá cố định cùng gói); không cộng dồn; không dòng nào khớp thì dùng `RoomType.basePrice`. Giá ghi đè **không miễn** các bước 2–7: nó chỉ thay `base`, vẫn đi qua hệ số mùa/cuối tuần/công suất/LOS/kênh và vẫn chịu kẹp sàn–trần. Khi nhiều dòng cùng `priority`, phá hoà theo thứ tự: (1) dòng khai `channelCode` cụ thể thắng dòng để trống; (2) `createdAt` **nhỏ hơn** thắng; (3) `id` tăng dần. |
| BR-RATE-03 | **Giá cơ bản theo loại phòng** (VND/đêm, mặc định): STD 650.000 · SUP 850.000 · DLX 1.100.000 · FAM 1.600.000 · DOR 250.000/giường. |
| BR-RATE-04 | **Sàn/trần giá** (VND): STD 400.000–1.800.000 · SUP 520.000–2.400.000 · DLX 680.000–3.000.000 · FAM 980.000–4.200.000 · DOR 150.000–700.000. Sàn được đặt ở khoảng **60%** giá cơ bản để mọi tổ hợp hệ số hợp lệ (nhỏ nhất ≈ 0,686 khi `SE-LOW` × LOS ≥ 14 × `AGENCY`) vẫn không bị kẹp; kẹp sàn là **hành vi bảo vệ có chủ đích**, không phải lỗi cấu hình. |

### 4.2. Hệ số mùa

Chọn **một** mùa áp dụng cho mỗi đêm: mùa có `priority` lớn nhất thắng; bằng nhau → khoảng ngày **hẹp hơn** thắng; vẫn bằng → **`createdAt` nhỏ hơn** (cấu hình sớm hơn) thắng — không dùng `id` vì `id` là UUID không phản ánh ý định cấu hình. Nếu không mùa nào khớp, hệ số = `1.00`.

| Mã mùa | Tên | Khoảng (hằng năm) | Hệ số | priority | Phụ thu cuối tuần |
|--------|-----|-------------------|-------|----------|-------------------|
| SE-NY | Tết Dương lịch | 30/12 – 02/01 | **2,20** | 90 | Không |
| SE-TET | Tết Nguyên Đán | theo âm lịch, cấu hình từng năm (7 ngày) | **2,00** | 90 | Không |
| SE-REUN | Lễ 30/4 – 1/5 | 28/04 – 03/05 | **1,80** | 80 | Không |
| SE-NAT | Quốc khánh 2/9 | 31/08 – 03/09 | **1,70** | 80 | Không |
| SE-SUM | Hè cao điểm | 01/06 – 15/08 | **1,40** | 50 | Có |
| SE-SHO | Thu (vai) | 16/08 – 30/09 | **0,90** | 30 | Có |
| SE-LOW | Thấp điểm | 01/10 – 29/12 | **0,85** | 20 | Có |

| Mã | Quy tắc |
|----|---------|
| BR-RATE-05 | Hệ số mùa áp dụng cho **mọi kênh**; mùa không phụ thuộc kênh bán. `Season` **ĐƯỢC PHÉP** chồng lấn (ví dụ mùa toàn chuỗi và mùa riêng theo cơ sở, hoặc mùa cấu hình lại theo từng năm); việc chọn mùa thắng tuân theo quy tắc ưu tiên ở §4.2. Khi hai mùa chồng lấn **cùng `priority`**, hệ thống PHẢI cảnh báo trên màn hình cấu hình **và ghi `AuditLog`** để tránh phụ thuộc vào thứ tự tạo bản ghi. |
| BR-RATE-06 | Hệ số cuối tuần = **1,20** cho đêm **Thứ Sáu** và **Thứ Bảy** (theo giờ VN). Chủ nhật tính như ngày thường. |

### 4.3. Hệ số công suất (giá phòng cuối)

Tính trên công suất của **cơ sở** trong đêm đó, lấy từ `OccupancySnapshot` (cập nhật mỗi 5 phút).

**Định nghĩa công suất** (chốt để mọi nền tảng tính giống nhau):

```
tử số   = tổng demand theo BR-INV-01 trong đêm đó (đơn vị bán)
mẫu số  = tổng supply theo BR-INV-01 trong đêm đó (đơn vị bán)
occupancyPct = tử số / mẫu số × 100
```

Block loại nguồn cung, **không xoá nghĩa vụ với khách**: booking bị block vẫn ở demand cho tới khi xử lý. DOR tính theo giường ở cả hai vế; không cộng hold lần nữa nếu đã đếm BookingRoom. Công suất có thể >100% khi quá tải; mẫu số 0 thì không báo bán thường, hệ số mặc định 1,00 và cảnh báo nếu còn demand. Tên legacy `physicalRooms`/`soldRooms` trong snapshot lần lượt mang giá trị supply/demand theo đơn vị bán. Snapshot cũ hơn **5 phút** bị coi là hết hiệu lực và bước 4 dùng hệ số `1,00`. Chốt tập snapshot **riêng từng đêm** tại một thời điểm báo giá; các đêm có thể có hệ số khác nhau.

| Công suất cơ sở | Hệ số |
|-----------------|-------|
| < 80% | 1,00 |
| 80% – 94,99% | **1,15** |
| ≥ 95% | **1,25** |

### 4.4. Hệ số độ dài kỳ lưu trú (LOS)

Áp dụng cho **toàn bộ các đêm** khi đủ điều kiện: 3–6 đêm → **0,95**; 7–13 đêm → **0,90**; ≥ 14 đêm → **0,85**. Chỉ áp dụng khi `ratePlan.losDiscountEnabled = true`.

**Giá trị mặc định của 4 gói giá** (nguồn chân lý cho `RatePlan`):

| Gói giá | `minNights` | `maxNights` | `losDiscountEnabled` | `rescheduleAllowed` | Cọc |
|---------|-------------|-------------|----------------------|---------------------|-----|
| `FLEX7` | 1 | 30 | **true** | true | 30% |
| `SAVER3` | 2 | 30 | **true** | true | 50% |
| `NONREF` | 1 | 30 | **false** | true (đổi ngày có phí 10%) | 100% |
| `LONGSTAY14` | **14** | 90 | **true** | true | 30% |

> **Vì sao `LONGSTAY14` bật LOS:** nếu tắt LOS, cùng một kỳ 14 đêm gói này sẽ **đắt hơn** `FLEX7` khoảng 17,6% (vì `FLEX7` được giảm 0,85 còn gói dài ngày thì không) — nghịch lý nghiệp vụ. Bật LOS giúp gói dài ngày **không bị phạt**; để nó thực sự rẻ hơn, chủ chuỗi PHẢI cấu hình thêm `RatePlan.fixedNightlyPrice` hoặc một dòng `RateCalendar` nguồn `RATE_PLAN` (priority 90) theo BR-RATE-02. Hệ thống cảnh báo ở màn hình cấu hình nếu `LONGSTAY14` không có giá riêng và ra cùng mức giá với `FLEX7`.

### 4.5. Hệ số kênh & hoa hồng

| ChannelCode | Tên kênh | Hệ số giá | Hoa hồng | Hold | Cho oversell |
|-------------|----------|-----------|----------|------|--------------|
| `WEB` | Website trực tiếp | 1,00 | 0% | 20 phút | Không |
| `PHONE` | Điện thoại / CSKH | 1,00 | 0% | 1.440 phút (24h) | Không |
| `WALKIN` | Khách vãng lai tại quầy | 1,10 | 0% | 0 | Không |
| `AGENCY` | Đại lý / doanh nghiệp | 0,95 | 10% | 1.440 phút | Không |
| `OTA_BOOKING` | Booking.com | 1,25 | 18% | 0 | **Có** |
| `OTA_AGODA` | Agoda | 1,22 | 17% | 0 | **Có** |
| `OTA_AIRBNB` | Airbnb | 1,19 | 15% | 0 | **Có** |

| Mã | Quy tắc |
|----|---------|
| BR-RATE-07 | `WALKIN` cao hơn kênh trực tiếp 10% (khuyến khích khách đặt trước); `AGENCY` thấp hơn 5% theo hợp đồng đại lý. **Ngưỡng sàn của hệ số kênh:** mọi kênh có hoa hồng > 0 PHẢI có hệ số ≥ `1 / (1 − commissionPct/100)` để doanh thu thuần không thấp hơn kênh trực tiếp. Cụ thể: Booking ≥ 1,2195 → đặt **1,25**; Agoda ≥ 1,2048 → đặt **1,22**; Airbnb ≥ 1,1765 → đặt **1,19**. `AGENCY` được **miễn** ngưỡng này vì là giá hợp đồng theo cam kết sản lượng, đã bao gồm biên lợi nhuận thoả thuận. |
| BR-RATE-08 | Doanh thu thuần của một booking = `totalAmount × (1 − commissionPct/100)`. Báo cáo doanh thu PHẢI hiển thị cả gộp và thuần. |
| BR-RATE-09 | Nguyên tắc **cân bằng giá**: so sánh **giá niêm yết sau bước kẹp sàn/trần (bước 7)**, không so trước kẹp. Nếu doanh thu thuần (`giá niêm yết × (1 − commissionPct/100)`) của một kênh OTA thấp hơn doanh thu thuần của kênh `WEB` cùng ngày cùng loại phòng, hệ thống PHẢI cảnh báo trên màn hình cấu hình giá và trên báo cáo doanh thu kênh (UC-REP-02). Cảnh báo không chặn lưu nhưng ghi vào nhật ký. `AGENCY` nằm ngoài phạm vi quy tắc này. Quy tắc còn bao gồm **ngưỡng sàn cho mọi kênh trực tiếp**: nếu hệ số của `WEB`, `PHONE` hoặc `WALKIN` bị cấu hình **< 1,00**, hệ thống PHẢI cảnh báo (bán dưới giá niêm yết cơ bản) trừ khi có khuyến mãi hợp lệ áp sau bước 8. |

### 4.6. Khuyến mãi

| Mã | Quy tắc |
|----|---------|
| BR-RATE-10 | Khuyến mãi có dạng `PERCENT` (giảm theo %) hoặc `AMOUNT` (giảm số tiền cố định), áp **một lần trên tổng tạm tính**, không áp theo từng đêm. |
| BR-RATE-11 | Tổng mức giảm KHÔNG ĐƯỢC vượt **30%** tổng tạm tính; nếu vượt, hệ thống cắt về 30% và ghi cảnh báo. |
| BR-RATE-12 | Tổng sau giảm KHÔNG ĐƯỢC thấp hơn tổng giá sàn của các đêm. Mã lỗi `E_RATE_BELOW_FLOOR` có **hai ngữ cảnh sử dụng tách biệt**: (a) **chặn (HTTP 422)** khi quản lý chủ động cấu hình/áp một mã khuyến mãi trực tiếp trên màn hình cấu hình giá — thao tác lưu bị từ chối; (b) **cảnh báo không chặn** khi khách báo giá/đặt phòng trực tuyến — hệ thống **KHÔNG áp mã khuyến mãi đó**, giữ nguyên giá chưa giảm, trả cảnh báo trong `PriceQuote.warnings[]`, và thao tác xác nhận **vẫn tiếp tục** với giá gốc. |
| BR-RATE-13 | Khuyến mãi áp dụng một lần cho mỗi booking; hai khuyến mãi chỉ xếp chồng được khi cả hai có `stackable = true`, tối đa 2 mã. **Thứ tự áp là tất định:** mã loại `AMOUNT` áp trước, mã loại `PERCENT` áp sau; nếu hai mã cùng loại thì áp theo `code` **tăng dần** theo thứ tự từ điển. Cấm mọi thứ tự khác để bảo đảm BR-RATE-17. |
| BR-RATE-14 | Khuyến mãi hết hạn hoặc hết lượt PHẢI bị từ chối tại thời điểm xác nhận, kể cả khi báo giá trước đó đã áp dụng. |

### 4.7. Báo giá

| Mã | Quy tắc |
|----|---------|
| BR-RATE-15 | `PriceQuote` có hiệu lực **15 phút**; quá hạn phải tính lại giá trước khi xác nhận. |
| BR-RATE-16 | `PriceSnapshot` bất biến PHẢI được lưu ngay khi booking **rời khỏi `DRAFT`** — tức tại `HELD`/`PENDING_PAYMENT`/`CONFIRMED` — gồm bảng giá từng đêm và mọi hệ số đã áp, để cả booking chưa xác nhận vẫn có `firstNightPrice` cho BR-CANCEL-06. Giá đã chốt KHÔNG ĐƯỢC thay đổi vì cấu hình giá sau đó; mỗi lần đổi ngày (BR-BOOK-12) lưu thêm một snapshot mới và giữ bản cũ để đối chiếu. |
| BR-RATE-17 | Cùng một đầu vào `(roomTypeId, propertyId, channelCode, ratePlanId, checkIn, checkOut, adults, children, promoCode, thời điểm)` PHẢI cho ra cùng một kết quả trên customer web, customer Android, operations web, operations Android và API. |
| BR-RATE-18 | Tỷ lệ hoa hồng mặc định theo kênh: `OTA_BOOKING` 18% · `OTA_AGODA` 17% · `OTA_AIRBNB` 15% · `AGENCY` 10% · các kênh còn lại 0%. Hoa hồng và hệ số giá **cấu hình được theo từng cặp (kênh, cơ sở)** qua `ChannelPropertySetting`, ghi đè giá trị mặc định toàn chuỗi; mọi thay đổi ghi `AuditLog` và ảnh hưởng báo cáo doanh thu thuần từ ngày hiệu lực. Khi có nhiều dòng cho cùng `(kênh, cơ sở)`, **phân giải theo ngày của từng đêm** (không theo `quotedAt`): dòng có `effectiveFrom` **lớn nhất và ≤ ngày của đêm đó** thắng; `settingId` đã chọn PHẢI ghi vào `PriceSnapshot` để tái lập được kết quả. |
| BR-RATE-19 | **Ưu đãi dài ngày:** `LONGSTAY14` PHẢI có giá riêng biệt so với các gói khác cho cùng kỳ lưu trú — cấu hình bằng `RatePlan.fixedNightlyPrice` hoặc dòng `RateCalendar` nguồn `RATE_PLAN`. Nếu không cấu hình, gói này cho **cùng mức giá** với `FLEX7` (vì cả hai đều bật LOS) và hệ thống PHẢI cảnh báo ở màn hình cấu hình rằng gói dài ngày không mang lại ưu đãi giá. Mức ưu đãi gợi ý tối thiểu: **5%** so với `FLEX7` cho cùng kỳ. |
| BR-RATE-20 | **Cấu hình gói giá/policy (UC-RATE-06):** chỉ OWNER được sửa/ngừng bán các gói/policy đã có trong danh mục đề tài. Kiểm tra `0 ≤ depositPercent ≤ 100`, `1 ≤ minNights ≤ maxNights`, giá tiền nguyên không âm, policy có đúng một bậc cuối −1, offset còn lại không âm và không trùng, tỷ lệ hoàn nguyên 0..100 và không tăng khi huỷ muộn hơn; `chargeFirstNight` chỉ khi hoàn 0%. `rescheduleAllowed` nghĩa là cho phép đổi, không đồng nghĩa miễn phí; lưu `rescheduleMinHours` = 168, `rescheduleFeePct` = 0 (NONREF = 10), `maxReschedules` = 1. Giá RATE_PLAN bắt buộc khớp `ratePlanId`; không áp sang gói khác. Lưu toàn bộ điều kiện gói, policy/tier, giờ check-in và phân bổ tiền phòng–đêm vào `PriceSnapshot.policySnapshotJson` (giá/phân bổ nằm trong payloadJson) khi chốt; mọi huỷ/hoàn đọc snapshot đã chốt, không đọc policy vừa sửa. Ngừng bán chỉ chặn booking mới; không xoá cấu hình đã được tham chiếu. Mỗi request cập nhật gói hoặc toàn bộ policy/tier atomically cùng audit/outbox; không coi hai PUT độc lập là một transaction; kiểm tra phiên bản để từ chối ghi đè cấu hình người khác vừa sửa. |

---

## 5. BR-BOOK — Đặt phòng

| Mã | Quy tắc |
|----|---------|
| BR-BOOK-01 | Tạo booking cần tối thiểu: khách, cơ sở, loại phòng, `checkIn`, `checkOut`, số người lớn, kênh, gói giá. Thiếu bất kỳ trường nào → từ chối `E_BOOK_MISSING_FIELD`. |
| BR-BOOK-02 | `checkIn` KHÔNG ĐƯỢC ở quá khứ (theo ngày VN) và KHÔNG ĐƯỢC xa hơn **365 ngày** kể từ hôm nay. |
| BR-BOOK-03 | Số đêm ≥ `ratePlan.minNights` và ≤ `ratePlan.maxNights`. `LONGSTAY14` yêu cầu tối thiểu **14 đêm**. `NONREF` tối thiểu 1 đêm. |
| BR-BOOK-04 | Số khách tối đa = `roomType.capacityAdults × roomCount`; vượt → `E_BOOK_OVER_CAPACITY`. |
| BR-BOOK-05 | **Phụ thu trẻ em:** dưới 6 tuổi miễn phí (tối đa 2 trẻ/phòng); 6–11 tuổi tính 50% giá người lớn; từ 12 tuổi tính như người lớn. Quote/booking nhận childAges[] theo tuổi ở ngày checkIn, độ dài bằng children, lưu snapshot; thiếu tuổi phải yêu cầu bổ sung. “Giá người lớn” chưa có công thức do bán theo phòng: Q-16 chưa xác nhận, không tự suy đơn giá/phụ thu và không bật tự tính nhánh 6–11 tuổi trước khi chốt. |
| BR-BOOK-06 | Chỉ cho phép: `DRAFT → HELD/PENDING_PAYMENT/CONFIRMED/CANCELLED`; `HELD → PENDING_PAYMENT/CONFIRMED/CANCELLED/EXPIRED`; `PENDING_PAYMENT → CONFIRMED/CANCELLED/EXPIRED`; `CONFIRMED → CHECKED_IN/CANCELLED/NO_SHOW`; `CHECKED_IN → CHECKED_OUT`. `CANCELLED`, `EXPIRED`, `NO_SHOW`, `CHECKED_OUT` là kết thúc, không khôi phục tự động. Mọi chuyển trạng thái kiểm tra quyền, guard ở BR-BOOK-09/18, BR-FO và ghi `BookingStatusHistory` trong cùng transaction. Huỷ một phần/đổi ngày không đổi trạng thái. [03/mô hình động](../03-phan-tich/mo-hinh-dong.md) là biểu diễn phải đồng bộ theo hợp đồng này. |
| BR-BOOK-07 | `HELD`: `holdExpiresAt` = thời điểm tạo + `channel.holdMinutes`; chuyển `PENDING_PAYMENT` giữ nguyên hạn, không gia hạn khi retry. Kênh hold=0 bỏ qua HELD; WALKIN chưa đủ tiền dùng PENDING_PAYMENT với hạn 15 phút (giả định Q-13), hoặc CONFIRMED nếu được duyệt nợ. OTA đã thu tiền được CONFIRMED theo BR-CHAN-03. Mọi trạng thái chờ chiếm tồn phải có hạn; DRAFT không giữ tồn. |
| BR-BOOK-08 | Hết hạn hold → `EXPIRED`, giải phóng toàn bộ `RoomAssignment` và trả phòng về tồn khả dụng trong cùng transaction. |
| BR-BOOK-09 | Booking đang chờ chỉ chuyển CONFIRMED khi hold còn hạn và tiền phòng đã thu, chưa hoàn/giữ cho hoàn `≥ depositAmount`; cọc đủ nhưng chưa trả số dư vẫn là CONFIRMED. Miễn cọc chỉ với OTA xác nhận thu hộ hoặc WALKIN có duyệt nợ theo BR-FO-01. Xác nhận và kết thúc hold là một transaction, giữ nguyên assignment; cấm tạo assignment thứ hai. Callback muộn theo BR-PAY-11. |
| BR-BOOK-10 | Một booking có thể gồm nhiều phòng (`roomCount > 1`); mỗi đơn vị bán (phòng hoặc giường DOR) là một BookingRoom; RoomAssignment là một khoảng nửa mở liên tục [startDate,endDate), có thể gồm nhiều đêm; chia đoạn khi điều chuyển. |
| BR-BOOK-11 | Huỷ booking PHẢI giải phóng mọi `RoomAssignment` trong **cùng transaction** với việc đổi trạng thái. |
| BR-BOOK-12 | **Đổi ngày:** chỉ HELD/PENDING_PAYMENT còn hạn hoặc CONFIRMED chưa check-in, lần đầu và còn ≥168h trước kỳ **cũ**, gói cho phép. FLEX7/SAVER3/LONGSTAY14 phí 0; NONREF phí = làm tròn lên 1.000 của 10% tổng tiền phòng kỳ cũ. `newTotal = max(oldTotal, giá kỳ mới)`; khoản chênh tăng là tiền phòng (BALANCE), chỉ phí đổi là RESCHEDULE_FEE. Giữ mức cọc của cam kết cũ và trạng thái; phần tiền tăng vào balanceDue phải thu trước check-in, phí đổi thu riêng; đây là giả định Q-12/Q-15 cần xác nhận. Khóa booking và tồn cả hai kỳ, loại nhu cầu của chính booking khi kiểm chỗ trùng, thay lịch + assignment + total + snapshot + rescheduleCount + audit/outbox nguyên tử. Giữ policy đã chốt; snapshot mới lưu giá chào mới và phần giữ lại do không hoàn. Lần hai, dưới ngưỡng hoặc gói cấm: đề nghị huỷ + đặt mới với xác nhận riêng, không tự huỷ kỳ cũ. Không gọi PSP trong transaction đổi ngày. |
| BR-BOOK-13 | Booking ở trạng thái `CHECKED_IN` KHÔNG ĐƯỢC sửa ngày; phải check-out rồi tạo booking mới. |
| BR-BOOK-14 | Cấm xoá cứng booking đã CONFIRMED. DRAFT/HELD chỉ được xoá cứng khi **không có bất kỳ Payment/lần thanh toán nào**, kể cả PENDING/FAILED; giải phóng tồn và ghi audit nguyên tử. Huỷ thông thường giữ bản ghi CANCELLED; nếu có tiền, lập RefundRequest **chỉ khi netRefund > 0**. Cấm xoá đối tượng có thể nhận callback muộn. |
| BR-BOOK-15 | Khách trong danh sách đen không tạo được booking mới; `MANAGER`+ override có lý do và ghi nhật ký. |
| BR-BOOK-16 | Chống đặt trùng: cùng kênh + cùng số điện thoại + cùng loại phòng + cùng ngày nhận phòng trong 24 giờ → sau kiểm tra cùng chủ sở hữu/quyền truy cập, trả về booking đã có kèm cờ `duplicateSuspected`, không tạo mới tự động. Nếu booking khác chủ sở hữu, không lộ nội dung hay mã của người khác; yêu cầu nhân viên xác minh. externalRef OTA là khoá cam kết chính, không tự gộp/xoá booking OTA chỉ vì trùng SĐT. |
| BR-BOOK-17 | Xoá cứng booking `DRAFT`/`HELD` (BR-BOOK-14) PHẢI ghi `AuditLog` với `beforeJson` đầy đủ **trước khi** xoá — nghĩa vụ ghi vết của BR-GEN-07 không được miễn trừ bởi việc xoá cứng. Bản ghi booking sau đó không còn để truy vấn; chỉ nhật ký còn lại. |
| BR-BOOK-18 | **Đồng thời/hết hạn:** callback, xác nhận, huỷ, đổi ngày, check-in/no-show và job hết hạn khóa cùng Booking rồi đọc trạng thái/hạn bằng giờ CSDL. `now ≥ holdExpiresAt` thì hold hết hiệu lực dù job chưa chạy; không nhận tiền để xác nhận trên hold đó. Job quét Booking ở HELD/PENDING_PAYMENT (Redis chỉ là cache), chuyển EXPIRED và nhả tồn/allotment nguyên tử, tối đa 60 giây. Tiền đã trả một phần khi chưa đủ điều kiện CONFIRMED được hoàn toàn bộ, miễn phí/phạt khi hết hạn hoặc khách rút giữ chỗ (Q-13); không áp phạt huỷ của booking đã xác nhận. Callback đến sau theo BR-PAY-11. Nếu xác nhận đã commit trước hạn, job bỏ qua. |

---

## 6. BR-CANCEL — Huỷ phòng & hoàn cọc

### 6.1. Thang mốc thời gian (nguồn chân lý)

Mốc tính bằng **số giờ trước thời điểm nhận phòng** (BR-GEN-04).

```
hoursBeforeCheckIn = checkInDateTime − thời điểm yêu cầu huỷ      (đơn vị: giờ, có phần thập phân)
tier   = bậc có offsetHours LỚN NHẤT mà hoursBeforeCheckIn ≥ offsetHours
```

| Gói giá | Cọc | Bậc | `offsetHours` | Hoàn | Tính phụ thu đêm đầu | Nhãn hiển thị |
|---------|-----|-----|---------------|------|----------------------|----------------|
| `FLEX7` | 30% | 1 | 168 | **100%** | Không | Huỷ trước ≥ 7 ngày: hoàn toàn bộ tiền đã trả |
| `FLEX7` | 30% | 2 | 72 | **50%** | Không | Huỷ trước 3–7 ngày: hoàn 50% |
| `FLEX7` | 30% | 3 | 24 | **0%** | Không | Huỷ trước 1–3 ngày: không hoàn cọc |
| `FLEX7` | 30% | 4 | −1 | **0%** | **Có** | Huỷ dưới 24 giờ: mất cọc + phụ thu 1 đêm |
| `SAVER3` | 50% | 1 | 72 | **100%** | Không | Huỷ trước ≥ 3 ngày: hoàn toàn bộ |
| `SAVER3` | 50% | 2 | 24 | **50%** | Không | Huỷ trước 1–3 ngày: hoàn 50% |
| `SAVER3` | 50% | 3 | −1 | **0%** | **Có** | Huỷ dưới 24 giờ: mất cọc + phụ thu 1 đêm |
| `NONREF` | 100% | 1 | −1 | **0%** | Không | Không hoàn tiền ở mọi mốc |
| `LONGSTAY14` | 30% | 1 | 336 | **100%** | Không | Huỷ trước ≥ 14 ngày: hoàn toàn bộ |
| `LONGSTAY14` | 30% | 2 | 168 | **50%** | Không | Huỷ trước 7–14 ngày: hoàn 50% |
| `LONGSTAY14` | 30% | 3 | −1 | **0%** | **Có** | Huỷ dưới 7 ngày: không hoàn, phụ thu 1 đêm |

| Mã | Quy tắc |
|----|---------|
| BR-CANCEL-01 | Mức hoàn xác định từ policy/tier **đã chốt trong snapshot**, không hard-code theo tên gói. Chọn offset không âm lớn nhất ≤ số giờ trước check-in; nếu không có, dùng đúng một bậc −1 bắt tất. Bậc cuối FLEX7/SAVER3 phủ dưới 24h, LONGSTAY14 dưới 168h, NONREF mọi thời điểm, kể cả giờ âm. BR-BOOK-18 ưu tiên cho booking chưa xác nhận; BR-CANCEL-13/14 là ngoại lệ cả với NONREF. |
| BR-CANCEL-02 | Tỷ lệ cọc theo gói giá: `FLEX7` 30% · `SAVER3` 50% · `NONREF` 100% · `LONGSTAY14` 30%. Cọc làm tròn **lên** bội 1.000 VND. |
| BR-CANCEL-03 | `hoursBeforeCheckIn` tính từ **thời điểm nhận phòng danh nghĩa** (BR-GEN-04), không từ ngày hay từ thời điểm tạo booking. |
| BR-CANCEL-04 | **Cơ sở tính hoàn:** `refundBase = paidAmount` (số tiền **đã thực trả**), không phải `totalAmount`. Chưa trả đồng nào thì hoàn 0. Với huỷ một phần/đã hoàn trước đó, chỉ dùng phân bổ tiền phòng thuộc phạm vi huỷ theo BR-CANCEL-19; loại khoản thu muộn đang hoàn riêng và khoản đã xử lý. Khóa quỹ hoàn theo BR-CANCEL-17. |
| BR-CANCEL-05 | `refundAmount = floor(refundBase × refundPercent / 100 / 1000) × 1000`. Số tiền **thực chi cho khách** là `netRefund = max(0, (approvedAmount ?? requestedAmount) − refundFee)`; requestedAmount là refundAmount dự kiến, approvedAmount là mức gộp đã duyệt, 0 ≤ approvedAmount ≤ requestedAmount (BR-CANCEL-11). Mọi ngưỡng phê duyệt và mọi báo cáo so trên `netRefund`; nếu `refundFee > refundAmount` thì `netRefund = 0` và phần phí còn lại không được thu thêm khách. |
| BR-CANCEL-06 | Khi bậc có `chargeFirstNight = true`: `penaltyAmount = max(0, firstNightPrice − paidAmount)`, trong đó `firstNightPrice` là giá đêm đầu trong `PriceSnapshot` hiện hành, cộng các phòng bị huỷ sau phân bổ khuyến mãi. Chỉ booking đã CONFIRMED mới áp phạt huỷ; HELD/PENDING_PAYMENT theo BR-BOOK-18. Khoản này tạo `Payment` loại `PENALTY` ở trạng thái `PENDING` (ghi công nợ), không tự thu. |
| BR-CANCEL-07 | NONREF không hoàn khi **khách huỷ thông thường**; ngoại lệ bất khả kháng, walk-out và tiền thu muộn vẫn theo BR-CANCEL-13/14, BR-PAY-11. Đổi ngày theo BR-BOOK-12 với phí 10%. |
| BR-CANCEL-08 | **Đổi ngày:** xem BR-BOOK-12. Đổi ngày KHÔNG tạo `RefundRequest`. |
| BR-CANCEL-09 | **Trả phòng sớm.** Cơ sở tính = `min(paidAmount, tổng giá các đêm chưa ở theo PriceSnapshot)` — tức không bao giờ hoàn nhiều hơn số đã trả (BR-CANCEL-04) cũng không nhiều hơn giá trị phần chưa ở. Tỷ lệ: `FLEX7` và `SAVER3` báo trước **≥ 72 giờ** → **50%** cơ sở; `LONGSTAY14` báo trước **≥ 168 giờ** → **50%**; `NONREF` → **0%** ở mọi mốc; báo trước dưới ngưỡng tương ứng hoặc không báo → **0%**. Khoản hoàn ghi nhận qua `RefundRequest` với `policyId` của gói giá và lý do `EARLY_CHECKOUT`. |
| BR-CANCEL-10 | **Không đến (no-show):** hệ thống tự đánh dấu lúc **23:59 ngày nhận phòng** nếu booking còn `CONFIRMED` và chưa check-in. Áp bậc cuối của chính sách (hoàn 0%) + phụ thu đêm đầu nếu bậc quy định. |
| BR-CANCEL-11 | **Phí xử lý hoàn tiền:** mặc định 0 VND, cấu hình được qua `SystemSetting`. Nếu > 0, phí trừ vào tiền hoàn, không thu thêm khách. |
| BR-CANCEL-12 | **Cam kết hoàn tiền:** xử lý trong 3 ngày làm việc, tối đa 7 ngày kể từ khi `RefundRequest` được duyệt. |
| BR-CANCEL-13 | **Bất khả kháng** (thiên tai, dịch bệnh, cơ sở đóng cửa, lỗi hệ thống): được hoàn **100% `paidAmount`**, miễn phụ thu, miễn phí xử lý. Chỉ `MANAGER`+ được tạo, PHẢI có lý do ≥ 20 ký tự và đính kèm minh chứng (tuỳ chọn). Mọi ca bất khả kháng vào báo cáo riêng. |
| BR-CANCEL-14 | **Huỷ do khách sạn (walk-out):** hoàn 100% + bồi thường theo BR-OVER-06. Khách từ chối phương án điều chuyển được xử lý như walk-out. |
| BR-CANCEL-15 | **Hai cấp = lập và duyệt (maker–checker)**, không phải hai lượt duyệt nối tiếp MANAGER→OWNER. Với mọi mức tiền, người duyệt là MANAGER hoặc OWNER có phạm vi và **khác người tạo**; trên 5.000.000 VND bắt buộc hiển thị kiểm soát ngưỡng trên `netRefund`, không có ngoại lệ tự duyệt. Lưu người lập, approvedBy, decidedAt, số tiền và lý do trong AuditLog. Cấm chia cùng một sự kiện hoàn để né ngưỡng; xét tổng thực chi của sự kiện. ACCOUNTANT chỉ chi sau APPROVED; không tự có quyền duyệt. OWNER cũng không vượt qua maker–checker. |
| BR-CANCEL-16 | Hoàn tiền **chỉ** được chi sau khi `RefundRequest` ở trạng thái `APPROVED`; mọi thay đổi trạng thái ghi `AuditLog` kèm lý do. |
| BR-CANCEL-17 | Khóa booking và các Payment gốc khi lập/duyệt/chi hoàn. Tiền đã hoàn SUCCEEDED + tiền giữ cho các yêu cầu PENDING/APPROVED không vượt tiền thực thu đủ điều kiện; kiểm tra cả theo booking lẫn từng Payment gốc. REJECTED/CANCELLED giải phóng phần giữ; khi PAID chuyển phần giữ thành đã chi, không trừ hai lần. Không giảm số phải hoàn hợp lệ một cách im lặng nếu quỹ đang bị yêu cầu khác giữ; báo xung đột để đối soát. |
| BR-CANCEL-18 | RefundRequest PENDING được rút thành CANCELLED bởi người tạo hoặc MANAGER/OWNER có phạm vi, bắt buộc lý do và nhả phần tiền giữ. Rút yêu cầu hoàn **không khôi phục booking** hay assignment. APPROVED/PAID không được huỷ; lỗi chi giữ APPROVED chờ đối soát. |
| BR-CANCEL-19 | **Huỷ một phần:** chỉ HELD/PENDING_PAYMENT còn hạn hoặc CONFIRMED, chọn BookingRoom ACTIVE. Phân bổ từng khoản tiền phòng đã thu theo trọng số giá phòng–đêm sau khuyến mãi trong snapshot tại lúc thu; lưu phân bổ bất biến, làm tròn xuống VND và gán phần dư theo bookingRoomId tăng dần để tổng đúng số thu. `refundBase` = tổng phần tiền của phòng bị huỷ chưa từng được xử lý huỷ; không dùng lại paidAmount toàn booking chia cho totalAmount đã giảm ở lần huỷ trước. Giữ riêng phần tiền bị giữ lại do huỷ, không dùng nó thanh toán các phòng còn lại. Đổi trạng thái phòng, nhả assignment/allotment, giảm tổng giá phần ở còn lại, lưu snapshot PARTIAL_CANCEL và yêu cầu hoàn/phạt trong cùng transaction; không tạo booking con/SPLIT_ROOMS. Huỷ hết phòng mới chuyển CANCELLED; phòng còn lại giữ nguyên đơn giá, không tính lại LOS. |

---

## 7. BR-PAY — Thanh toán

| Mã | Quy tắc |
|----|---------|
| BR-PAY-01 | `depositAmount = roundUp1000(totalAmount × depositPercent / 100)`. |
| BR-PAY-02 | `paidAmount` là tổng tiền thu SUCCEEDED, không giảm khi hoàn, không gồm REFUND/COMPENSATION chi ra. `refundedAmount` chỉ gồm REFUND SUCCEEDED. Sổ phân bổ phân biệt tiền phòng, phạt, phí đổi, dịch vụ; không dùng cùng khoản thu bù hai nghĩa vụ. `balanceDue` = tổng nghĩa vụ còn phải thu sau phân bổ (luôn ≥0), **đã bao gồm** phạt/phí/dịch vụ chưa trả. Với booking đơn giản chưa huỷ/hoàn: `max(0, totalAmount − tiền phòng đã thu) + phạt/phí/dịch vụ chưa trả`. CANCELLED/NO_SHOW chỉ còn phạt/phí được phép đã chốt trừ khoản đã thu cho chúng; EXPIRED theo BR-BOOK-18 không có phạt. Tiền của phòng đã huỷ, khoản đang giữ hoàn và khoản đã hoàn không bù nợ phần ở còn lại. UI không cộng penaltyAmount lần thứ hai vào balanceDue. |
| BR-PAY-03 | Callback từ cổng thanh toán PHẢI idempotent theo `idempotencyKey`; cùng khoá gửi lại không tạo `Payment` thứ hai và không cộng dồn `paidAmount`. |
| BR-PAY-04 | Hệ thống **KHÔNG ĐƯỢC** lưu số thẻ, ngày hết hạn hay CVV. Chỉ lưu mã giao dịch của cổng, số tiền và trạng thái. |
| BR-PAY-05 | Lần thanh toán quá 15 phút chưa xác minh thành công → FAILED với lý do timeout; đây không chứng minh PSP chưa thu tiền. Không kết thúc hold trước holdExpiresAt; retry không gia hạn hold. Trước retry hoặc chi hoàn chưa rõ kết quả phải tra PSP/đối soát giao dịch cũ. Thành công đến muộn theo BR-PAY-11. |
| BR-PAY-06 | Thanh toán tiền mặt PHẢI ghi `createdBy` (người thu) và `paidAt` (thời điểm thu). Đối soát tiền mặt thực hiện theo cặp **(người thu, ngày VN)** — hệ thống không quản lý ca làm việc (ngoài phạm vi, xem 00 §3.2). |
| BR-PAY-07 | Tổng hoàn lũy kế của một booking ≤ `paidAmount`. |
| BR-PAY-08 | Hoàn tiền về **phương thức gốc**; nếu gốc là tiền mặt → chuyển khoản, có ghi chú số tài khoản và xác minh chủ nhận theo hồ sơ yêu cầu. Phân bổ hoàn theo các Payment gốc đủ điều kiện; không trả toàn bộ về phương thức khác chỉ vì booking có nhiều lần thanh toán. |
| BR-PAY-09 | Hoàn tiền ghi nhận bằng `Payment` loại `REFUND` (bút toán đảo), KHÔNG ĐƯỢC sửa hay xoá `Payment` gốc. |
| BR-PAY-10 | Đối soát cuối ngày: mọi `Payment` tiền mặt phải khớp số tiền mặt thực thu **theo từng cặp (người thu, ngày VN)**; chênh lệch > 50.000 VND phải báo `MANAGER` kèm danh sách giao dịch liên quan. |
| BR-PAY-11 | **Tiền thu muộn/chi chưa rõ kết quả:** xác minh chữ ký, merchant, số tiền, tiền tệ và providerTxnId; một giao dịch PSP chỉ ghi SUCCEEDED/cộng tiền một lần, kể cả trước đó FAILED do timeout. Nếu booking còn chờ và hold còn hạn, áp BR-BOOK-09; nếu hết hạn hoặc CANCELLED/EXPIRED/NO_SHOW, giữ trạng thái kết thúc (chờ đã quá hạn → EXPIRED), không tái chiếm phòng; lập yêu cầu hoàn **100% riêng khoản thu muộn**, miễn phí/phạt, reason PAYMENT_TIMEOUT hoặc SYSTEM, theo BR-CANCEL-15/17. Với CONFIRMED/CHECKED_IN/CHECKED_OUT đối soát phân bổ đúng nghĩa vụ, tiền dư lập hoàn do SYSTEM, không xác nhận booking lần nữa. Mỗi khoản hoàn gắn Payment gốc; có nhiều phương thức thì tách các dòng theo tiền thực thu từng phương thức nhưng duyệt theo tổng sự kiện. Chi hoàn dùng một khóa chi ổn định; timeout PSP giữ yêu cầu APPROVED và lần chi PENDING, tra trạng thái trước retry; chỉ PAID khi có bằng chứng SUCCEEDED, tuyệt đối không tạo lần chi mới khi kết quả cũ chưa rõ. |

---

## 8. BR-CHAN — Kênh bán

| Mã | Quy tắc |
|----|---------|
| BR-CHAN-01 | Phân bổ mặc định cho mỗi kênh OTA = **80%** số **đơn vị bán** `ACTIVE` của loại phòng, hiểu là **hạn mức bán tối đa của kênh đó** (`ChannelAllotment.allotment`), không phải phần tồn bị khoá khỏi các kênh khác. Hạn mức làm tròn **XUỐNG** (bảo thủ) và **tối thiểu 1 khi nguồn cung > 0, bằng 0 khi không có nguồn cung**; với DOR, đơn vị tính là **giường** (ví dụ loại có 12 giường → `floor(12 × 0,80) = 9`). Kênh `AGENCY` **có hạn mức riêng** theo hợp đồng cam kết sản lượng. Chỉ `WEB`, `PHONE`, `WALKIN` **không có hạn mức riêng** và cùng chia sẻ tồn chung. Kênh OTA không bao giờ thấy nhiều hơn `min(tồn chung, allotment − used)`. |
| BR-CHAN-02 | Đồng bộ tồn phòng & giá lên OTA PHẢI chạy **ngay khi có thay đổi** (qua outbox) và chậm nhất **5 phút**; đồng thời quét định kỳ mỗi 5 phút. |
| BR-CHAN-03 | Booking đến từ OTA PHẢI được ghi nhận ở trạng thái `CONFIRMED` khi OTA báo đã thu tiền (`PaymentMethod = OTA_COLLECT`), **kể cả khi tồn khả dụng bằng 0**. Đây là **miễn trừ tường minh** đối với BR-OVER-01/02: hạn mức `overbookLimitPct` chỉ điều tiết các quyết định bán vượt mà **hệ thống chủ động** thực hiện, không áp cho booking do kênh ngoài đẩy vào. Chỉ booking thiếu đơn vị ở ít nhất một đêm mới PHẢI đặt `oversold = true` và mở `OverbookingCase` theo BR-OVER-03. |
| BR-CHAN-04 | Booking OTA bị huỷ theo **chính sách của OTA**, không áp BR-CANCEL; hệ thống ghi nhận `cancelReason = OTA_CANCELLATION` và lưu mã chính sách kênh để đối soát. Booking huỷ theo đường này KHÔNG tạo `RefundRequest` trong hệ thống — tiền do OTA hoàn theo hợp đồng, kế toán đối soát qua báo cáo UC-PAY-05. |
| BR-CHAN-05 | Khi tồn khả dụng của một loại phòng trong một ngày còn **≤ 2 đơn vị bán**, hệ thống tự đóng bán loại phòng đó trên **mọi kênh OTA** trong ngày ấy (khoá kênh), mở lại khi tồn > 2 và không bị đóng thủ công; đóng theo (kênh, loại phòng, đêm), không đóng loại khác. DOR theo giường. Kênh trực tiếp vẫn bán bình thường. Khi **mở** bán, giá trị tồn PHẢI đẩy lên kênh là `min(tồn chung theo BR-INV-01, allotment − used)` — **cấm** đẩy hạn mức thô `allotment`, vì như vậy OTA vẫn thấy phòng đã bán hoặc đã bị `RoomBlock`. |
| BR-CHAN-06 | Mọi thay đổi giá hoặc tồn PHẢI ghi `OutboxEvent` trong cùng transaction và được gửi tới mọi kênh đang mở bán. |
| BR-CHAN-07 | Đồng bộ thất bại 3 lần liên tiếp PHẢI phát cảnh báo cho `MANAGER` và đánh dấu kênh là `DEGRADED` trên bảng điều khiển. |
| BR-CHAN-08 | Bán chủ động/đẩy tồn OTA không vượt allotment còn lại. Webhook booking **đã được OTA xác nhận** phải tiếp nhận kể cả đã đóng bán/vượt allotment; cập nhật used thực tế (có thể > allotment), cảnh báo đối soát, đóng tồn bán và mở case nếu thiếu nguồn cung. Đây là miễn trừ tiếp nhận cam kết bên ngoài theo BR-CHAN-03, không phải quyền chủ động bán vượt. Thiếu cấu hình allotment OTA/AGENCY không có nghĩa vô hạn: OTA dùng mặc định BR-CHAN-01, AGENCY đóng bán tới khi cấu hình; tồn công bố không âm. |

---

## 9. BR-OVER — Quá tải, ghép phòng & điều chuyển

### 9.1. Bán vượt có kiểm soát

| Mã | Quy tắc |
|----|---------|
| BR-OVER-01 | Mặc định `Property.overbookLimitPct = 0` — không bán vượt. |
| BR-OVER-02 | Chỉ được bán vượt khi **đồng thời**: (a) kênh có `overbookAllowed = true`; (b) `Property.overbookLimitPct > 0` (đầu vào, tối đa **5%**); (c) số phòng vượt của ngày ≤ **trần theo cơ sở** = `ceil(số phòng ACTIVE × overbookLimitPct / 100)`, và **tối thiểu 1** nếu `overbookLimitPct > 0` (để cơ sở nhỏ vẫn dùng được hạn mức). Trần toàn chuỗi = **tổng trần theo từng cơ sở**, KHÔNG phải `ceil` trên tổng 55 phòng. Ví dụ với 5%: CS-01 (24 phòng) → 2; CS-02 (18) → 1; CS-03 (13) → 1; toàn chuỗi → **4**. Vượt trần → từ chối `E_OVER_LIMIT_EXCEEDED`. |
| BR-OVER-03 | Mọi booking được tạo khi không còn phòng vật lý PHẢI có `oversold = true` và tự động mở một `OverbookingCase`. |
| BR-OVER-04 | `OverbookingCase` PHẢI được xử lý (chuyển sang `RESOLVED`) **trước T−24h**. Nếu phát sinh/tiếp nhận sau T−24h, mở và leo thang ngay; không gán hạn hồi tố như đã vi phạm trước khi biết sự cố. Quá hạn → leo thang cho `OWNER` và hiện trên bảng điều khiển. |
| BR-OVER-05 | Job quét quá tải chạy **mỗi giờ**, kiểm tra 30 ngày tới, gộp trùng theo `(propertyId, date, roomTypeId)`. |

### 9.2. Thang xử lý khi thiếu phòng

Áp dụng theo thứ tự, dừng ở bậc đầu tiên thực hiện được:

| Bậc | `MoveType` | Điều kiện | Chi phí & bồi thường |
|-----|-----------|-----------|----------------------|
| 1 | `SAME_TYPE_SAME_PROPERTY` | Còn phòng khác cùng loại, cùng cơ sở | Không phụ thu, giữ giá gốc |
| 2 | `UPGRADE_SAME_PROPERTY` | Còn phòng hạng cao hơn, **sức chứa ≥** số khách, cùng cơ sở | Miễn phí nâng hạng, giữ giá gốc, không thu chênh lệch |
| 3 | `SAME_TYPE_CROSS_PROPERTY` / `UPGRADE_CROSS_PROPERTY` | Còn phòng ở cơ sở khác **cùng thành phố/khu vực, bán kính ≤ 15 km** | Giữ giá gốc + hỗ trợ đưa đón ≤ **500.000 VND**. **Hiện KHÔNG khả dụng** với 3 cơ sở hiện tại (Đà Lạt – Vũng Tàu – Phan Thiết cách nhau 160–300 km) |
| 4 | `WALK_OUT` | Không còn phương án nào | Hoàn **100%** `paidAmount` + bồi thường **1 × giá đêm đầu** theo giá gốc booking + hỗ trợ tìm chỗ ở thay thế |

> **Tính khả dụng của bậc 3.** Ba cơ sở hiện cách nhau 160–300 km nên điều kiện "cùng thành phố, ≤ 15 km" **không thoả**. Thang xử lý thực tế vận hành là **1 → 2 → 4**. Bậc 3 chỉ trở nên khả dụng nếu chuỗi mở thêm cơ sở trong cùng đô thị. Đường đi vòng qua BR-OVER-07 (khách đồng ý bằng văn bản + `MANAGER`+ duyệt) vẫn tồn tại cho ca đặc biệt, nhưng **không** được tính là một bậc trong thang chuẩn, và mức hỗ trợ đưa đón khi đó do `MANAGER`+ quyết theo chi phí thực tế.

| Mã | Quy tắc |
|----|---------|
| BR-OVER-06 | Chi phí bồi thường và đưa đón PHẢI được ghi vào `RoomMove.compensationAmount` và `transportCost`, `MANAGER`+ duyệt trước khi chi. |
| BR-OVER-07 | Sang cơ sở khác thành phố chỉ được thực hiện khi khách **đồng ý bằng văn bản** (xác nhận trên hệ thống hoặc email) và `MANAGER`+ duyệt. |
| BR-OVER-08 | Mọi `RoomMove` đặt `priceLocked = true`: khách giữ nguyên đơn giá đã chốt cho toàn bộ kỳ lưu trú. |
| BR-OVER-09 | Khách ở trạng thái `CHECKED_IN` KHÔNG ĐƯỢC điều chuyển, trừ bất khả kháng (hỏng phòng, lý do an toàn) và phải `MANAGER`+ duyệt. |
| BR-OVER-10 | Mọi `RoomMove` PHẢI tạo bản ghi, ghi `AuditLog`, và gửi thông báo cho khách trong **15 phút**. |

### 9.3. Ưu tiên giữ phòng

Khi phải chọn khách để điều chuyển, hệ thống tính `keepScore`; **ai điểm thấp bị điều chuyển trước**.

```
keepScore = điểm hạng khách + điểm thanh toán + điểm số đêm + điểm khách quay lại + điểm đã tới nơi
```

| Thành phần | Giá trị |
|-----------|---------|
| Hạng khách | PLATINUM 100 · GOLD 80 · SILVER 50 · MEMBER 20 · GUEST 0 |
| Thanh toán | đã trả ≥ 100% tổng tiền: **20** · đã trả ≥ tiền cọc: **10** · chưa trả gì: **0** |
| Số đêm | `min(số đêm, 14) × 2` |
| Khách quay lại | ≥ 3 lần lưu trú trong 12 tháng: **15** |
| Đã tới nơi | đã check-in, hoặc còn ≤ 6 giờ tới giờ nhận phòng: **10** |

| Mã | Quy tắc |
|----|---------|
| BR-OVER-11 | Thứ tự điều chuyển: `keepScore` **tăng dần** → `createdAt` **giảm dần** (booking mới hơn bị đổi trước) → **`Booking.seq` tăng dần** (`seq` là số thứ tự tăng đơn điệu toàn hệ thống — **không** dùng `id` vì `id` là UUID không có thứ tự). Thứ tự này PHẢI tất định và hiển thị được cho quản lý. |
| BR-OVER-12 | **Ràng buộc ưu tiên cứng, áp TRƯỚC khi sắp theo điểm:** booking `WALKIN` chưa đóng tiền và booking `HELD` luôn nằm ở **cuối** danh sách được giữ phòng (tức bị điều chuyển trước), bất kể `keepScore` cao đến đâu. Thứ tự thực thi là: (1) lọc theo BR-OVER-12 thành hai nhóm ưu tiên yếu/mạnh; (2) trong mỗi nhóm mới sắp theo `keepScore` → `createdAt` → `Booking.seq` của BR-OVER-11. |

### 9.4. Ghép phòng

| `MoveType` | Nghĩa nghiệp vụ | Điều kiện |
|-----------|-----------------|-----------|
| `MERGE_SHARE` | Ghép hai booking độc lập vào **cùng một phòng** (áp dụng cho phòng Dorm/nhiều giường) | Cả hai booking PHẢI đồng ý; cùng giới tính hoặc cùng nhóm đi cùng nhau; tổng số người ≤ sức chứa; giảm **20%** cho mỗi bên |
| `MERGE_CONNECTING` | Ghép hai phòng **thông nhau** thành một đơn vị bán cho gia đình/nhóm | Hai phòng PHẢI có `connectingRoomId` trỏ vào nhau; giá = tổng giá hai phòng, giảm **10%** |
| `SPLIT_ROOMS` | Tách một booking nhiều phòng sang phòng khác do quá tải/hỏng phòng | Áp dụng BR-OVER-08 (giữ giá gốc) |

| Mã | Quy tắc |
|----|---------|
| BR-OVER-13 | `MERGE_SHARE` PHẢI ghi nhận `consentPrimary` và `consentSecondary` là `true` trước khi có hiệu lực. Thiếu một bên → từ chối `E_OVER_NO_CONSENT`. `MERGE_SHARE` **chỉ áp dụng cho loại phòng có `allowShared = true` và `bedCount > 1`** (thực tế là DOR); hai booking chiếm hai **đơn vị bán** khác nhau trong cùng phòng nên không vi phạm BR-INV-03. Kiểm tra cùng giới tính (BR-OVER-14) đọc từ **`Guest.gender`** của khách đứng tên mỗi booking; giá trị `UNSPECIFIED` được coi là **khác giới**. |
| BR-OVER-14 | Mặc định KHÔNG ghép khác giới tính. Ngoại lệ chỉ khi hội đủ **cả hai**: (a) cả hai khách đồng ý bằng văn bản trên hệ thống (`consentPrimary` và `consentSecondary` = true, theo BR-OVER-13); (b) `MANAGER`+ duyệt kèm lý do. Thiếu đồng thuận → `E_OVER_NO_CONSENT`; đủ đồng thuận nhưng khác giới và chưa có phê duyệt → `E_OVER_MERGE_GENDER` (hai mã khác nhau để phân biệt nguyên nhân trong nhật ký). |
| BR-OVER-15 | Ghép phòng KHÔNG làm thay đổi tổng doanh thu ghi nhận của phần phòng đã bán. Khoản chiết khấu được ghi riêng vào **`RoomMerge.discountAmount`** (tính từ `discountPct`) và vào `RoomMove.compensationAmount` nếu phát sinh, để báo cáo UC-REP-04 tổng hợp được **tổng chi phí xử lý quá tải** = Σ chiết khấu ghép phòng + Σ bồi thường walk-out + Σ chi phí đưa đón. |
| BR-OVER-16 | Một `OverbookingCase` còn ở `OPEN`/`PROPOSED`/`ESCALATED` khi **ngày thiếu phòng đã trôi qua** PHẢI chuyển sang `ESCALATED` (nếu chưa) và được xử lý như sự cố tại chỗ: khách đã tới vẫn được điều chuyển theo thang BR-OVER §9.2, hoặc walk-out nếu hết phương án; bản ghi PHẢI giữ `detectedAt`, `resolvedAt`, người xử lý và lý do trễ để đưa vào báo cáo UC-REP-04. Case quá hạn chưa đóng là **lỗi vận hành**, không được tự động đóng. |

---

## 10. BR-FO — Tiền sảnh

| Mã | Quy tắc |
|----|---------|
| BR-FO-01 | Check-in chỉ khi CONFIRMED, `balanceDue = 0` (đã gồm phạt/phí), ngày VN = checkIn và mọi đơn vị cần giao sẵn sàng. MANAGER được cho nợ khi **đồng thời** nợ ≤5.000.000 và ≤50% totalAmount; vượt **bất kỳ** ngưỡng nào cần OWNER. Duyệt nợ ghi số tiền, booking, người, lý do, hạn thu; tăng nợ phải duyệt lại. Khóa booking và kiểm tra sẵn sàng/phạm vi/phiếu nợ lần cuối cùng transaction CHECKED_IN. |
| BR-FO-02 | Check-in từ 23:59:00 (bao gồm đúng mốc) ngày nhận phòng bị từ chối; booking phải được xử lý no-show trước. |
| BR-FO-03 | **Check-out muộn:** trước 12:00 miễn phí; 12:00–18:00 thu **50%** giá đêm cuối; sau 18:00 thu **100%** giá đêm cuối. |
| BR-FO-04 | **Check-in sớm:** 08:00–12:00 miễn phí nếu phòng sẵn sàng; 12:00–14:00 thu **30%** giá đêm đầu; trước 08:00 phải đặt thêm 1 đêm. |
| BR-FO-05 | Check-out PHẢI chốt `balanceDue` về 0 trước khi in hoá đơn và giải phóng phòng. |
| BR-FO-06 | Sau check-out, hệ thống tạo `HousekeepingTask` cho phòng với `businessDate` = ngày trả phòng. Trạng thái buồng phòng **KHÔNG** làm giảm tồn khả dụng theo ngày (BR-INV-01) — nó chỉ chặn **thời điểm giao phòng** cho khách. |
| BR-FO-07 | Room.status chỉ là ACTIVE/MAINTENANCE/INACTIVE; DONE/INSPECTED là HousekeepingTask.status. Giao phòng chỉ khi ACTIVE, không block tại thời điểm giao, không còn khách cũ trong đơn vị và **task gần nhất của lần giải phóng đó** DONE/INSPECTED. Task DONE cũ không chứng minh phòng sạch sau lượt ở mới; chưa có task/bằng chứng sẵn sàng phải kiểm tra và ghi nhận. Gán/bán cùng ngày vẫn hợp lệ, nhưng không giao khi chưa sạch; chờ/đổi phòng và ghi note nếu chậm. PENDING → IN_PROGRESS → DONE do HOUSEKEEPING phụ trách; INSPECTED hoặc mở lại PENDING do FRONT_DESK/MANAGER kiểm tra. Khóa/kiểm phiên bản để check-in không chạy đồng thời với mở lại task bẩn. |

---

## 11. BR-CRM — Khách hàng

| Mã | Quy tắc |
|----|---------|
| BR-CRM-01 | Khách được nhận diện duy nhất theo **số điện thoại đã chuẩn hoá** (`+84…`); email là trường phụ. |
| BR-CRM-02 | Hạng theo số đêm tích luỹ 12 tháng: `MEMBER` ≥ 1 lần lưu trú · `SILVER` ≥ 5 đêm · `GOLD` ≥ 20 đêm · `PLATINUM` ≥ 50 đêm. |
| BR-CRM-03 | Điểm thưởng = **5%** giá trị booking đã hoàn tất, làm tròn xuống; **1 điểm = 1.000 VND**. Điểm ghi nhận sau check-out. |
| BR-CRM-04 | Danh sách đen chặn tạo booking mới; `MANAGER`+ override có lý do ghi nhật ký. |
| BR-CRM-05 | Hồ sơ khách KHÔNG ĐƯỢC xoá cứng; chỉ chuyển sang trạng thái ẩn danh hoá khi khách yêu cầu, giữ lại bản ghi đặt phòng vì nghĩa vụ kế toán. |
| BR-CRM-06 | Booking bị huỷ hoặc no-show không cộng điểm; đêm đã ở thực tế vẫn tính vào số đêm xét hạng. |

---

## 12. BR-RBAC — Phân quyền

| Mã | Quy tắc |
|----|---------|
| BR-RBAC-01 | Bảy vai trò độc lập: OWNER, MANAGER, FRONT_DESK, RESERVATION_AGENT, ACCOUNTANT, HOUSEKEEPING, SYSADMIN. ACT-12 dùng SYSADMIN; không dùng OWNER để cấp quyền kỹ thuật. Không có thứ bậc role ≥ role. |
| BR-RBAC-02 | Người dùng có `propertyScope`; ngoài OWNER có phạm vi chuỗi, các vai trò nghiệp vụ **chỉ** thấy và thao tác trên dữ liệu thuộc cơ sở trong phạm vi của mình. SYSADMIN chỉ truy cập chức năng kỹ thuật được cấp, không dùng phạm vi chuỗi để đọc dữ liệu kinh doanh; mọi danh sách, chi tiết, export và ID con áp cùng kiểm tra. |
| BR-RBAC-03 | Cấp quyền theo **tập vai trò tường minh × thao tác × phạm vi × đối tượng**; không được cấp thì từ chối. OWNER có phạm vi chuỗi, không tự động kế thừa thao tác thu/chi của kế toán. Guest chỉ đọc/sửa booking của chính mình qua principal đã xác thực; biết mã booking/SĐT không đủ quyền. Tài khoản dịch vụ PSP/OTA/scheduler chỉ được luồng tích hợp tương ứng, không dùng quyền nội bộ. |

| Thao tác | Tập vai trò được phép (ngoài ra từ chối) |
|----------|-------------------|
| Xem lịch tồn, tra cứu booking vận hành | FRONT_DESK, RESERVATION_AGENT, MANAGER, OWNER; ACCOUNTANT chỉ dữ liệu cần đối soát |
| Tạo booking, nhận cọc | FRONT_DESK, RESERVATION_AGENT; ACCOUNTANT được ghi nhận khoản thu khi đối soát |
| Check-in, check-out, thu số dư tại quầy | FRONT_DESK |
| Xem/cập nhật công việc dọn được giao | HOUSEKEEPING; FRONT_DESK/MANAGER được giao/kiểm tra task; không lộ giá, thanh toán, CCCD/hồ sơ booking cho HOUSEKEEPING |
| Ghi no-show, đổi phòng (bậc 1–2), ghép phòng | `FRONT_DESK` (khác giới tính cần `MANAGER`) |
| Duyệt hoàn tiền ≤ 5.000.000 VND | MANAGER hoặc OWNER, khác người tạo |
| Duyệt hoàn tiền > 5.000.000 VND | MANAGER hoặc OWNER khác người tạo; maker–checker, không yêu cầu hai người duyệt (BR-CANCEL-15) |
| Chi hoàn tiền | ACCOUNTANT sau khi duyệt đủ cấp; không tự duyệt |
| Walk-out, bất khả kháng, điều chuyển khác thành phố | MANAGER, OWNER |
| Cấu hình giá, mùa, kênh, policy/rateplan, tham số nghiệp vụ | OWNER; MANAGER được khuyến mãi trong phạm vi theo UC-RATE-04 |
| Người dùng/quyền, tham số kỹ thuật, sao lưu/phục hồi | SYSADMIN; OWNER quản lý người dùng/quyền theo UC-AUTH-02; SYSADMIN không tự cấp quyền nghiệp vụ cho mình |
| Đối soát, báo cáo tài chính | `ACCOUNTANT`, `OWNER` |
| Xem nhật ký kiểm toán | OWNER, MANAGER trong phạm vi; SYSADMIN xem nhật ký vận hành đã che dữ liệu nhạy cảm |

| Mã | Quy tắc |
|----|---------|
| BR-RBAC-04 | Thay đổi giá vượt **±20%** so với lịch giá đang hiệu lực cần `OWNER` xác nhận lại bằng hộp thoại. |
| BR-RBAC-05 | Phiên web quản trị hết hạn sau 15 phút không hoạt động; ứng dụng Android dùng refresh token 7 ngày để lễ tân thao tác nhanh, nhưng thao tác tài chính vẫn yêu cầu nhập lại mã PIN 6 số. |
| BR-RBAC-06 | Nhật ký đăng nhập thất bại 5 lần liên tiếp khoá tài khoản 15 phút. |

---

## 13. BR-SYS — Nền tảng & tuân thủ

| Mã | Quy tắc |
|----|---------|
| BR-SYS-01 | `AuditLog` là **append-only**: `UPDATE` và `DELETE` bị thu hồi ở tầng CSDL, không chỉ bị chặn ở tầng ứng dụng. |
| BR-SYS-02 | Tham số nghiệp vụ đọc từ `SystemSetting`, đổi được không cần triển khai lại. Khoá tối thiểu PHẢI có: `refund.feeAmount` (BR-CANCEL-11) · `job.hold.releaseIntervalSeconds` = 30 (BR-INV-04) · `job.holdReconcile.intervalSeconds` = 900 (đối chiếu `Hold` trong Redis với `Booking.holdExpiresAt` để phát hiện hold treo — NFR-REL-02) · `job.channelSync.intervalSeconds` = 300 (BR-CHAN-02) · `job.overbooking.scanIntervalMinutes` = 60 (BR-OVER-05) · `job.occupancy.snapshotIntervalSeconds` = 300 (BR-RATE §4.3) · `job.noShow.markTime` = 23:59 (BR-CANCEL-10) · `deal.threshold.minor` = 5.000.000 (BR-CANCEL-15) · `deal.threshold.checkInDebt` = 5.000.000 và `checkInDebtPct` = 50 (BR-FO-01) · `channel.lowInventoryThreshold` = 2 (BR-CHAN-05) · `pricing.weekendMultiplier` = 1,20 (BR-RATE-06) · `pricing.maxDiscountPct` = 30 (BR-RATE-11) · `overbooking.transportSupportCap` = 500.000 (BR-OVER-06). |
| BR-SYS-03 | Sao lưu: PITR, **RPO ≤ 15 phút**, **RTO ≤ 4 giờ**; diễn tập phục hồi mỗi học kỳ, có biên bản. |
| BR-SYS-04 | Thời hạn lưu trữ: booking & thanh toán **10 năm**; nhật ký kiểm toán **5 năm**; dữ liệu cá nhân xử lý theo Nghị định 13/2023/NĐ-CP — có sự đồng ý khi thu thập, được yêu cầu xoá/ẩn danh. |
| BR-SYS-05 | Nhật ký kiểm toán ghi tối thiểu: ai, làm gì, trên đối tượng nào, giá trị trước/sau, lý do, IP, thời điểm. |
| BR-SYS-06 | Mọi thông báo gửi khách PHẢI ghi lại trong `Notification` kèm trạng thái; gửi lại tối đa 3 lần cách nhau 5 phút. |

---

## 14. Bảng tra nhanh mã BR

| Nhóm | Khoảng mã | Số lượng | Bài toán |
|------|-----------|----------|----------|
| BR-GEN | 01–08 | 8 | Nền tảng chung |
| BR-PROP | 01–06 | 6 | |
| BR-INV | 01–07 | 7 | BT-3 |
| BR-RATE | 01–20 | 20 | BT-2 |
| BR-BOOK | 01–18 | 18 | |
| BR-CANCEL | 01–19 | 19 | BT-1 |
| BR-PAY | 01–11 | 11 | BT-1 |
| BR-CHAN | 01–08 | 8 | BT-3 |
| BR-OVER | 01–16 | 16 | BT-3 |
| BR-FO | 01–07 | 7 | |
| BR-CRM | 01–06 | 6 | |
| BR-RBAC | 01–06 | 6 | |
| BR-SYS | 01–06 | 6 | |
| BR-REP | 01 | 1 | |
| **Tổng** | | **139** | |

Truy vết BR → UC → API → Entity → Test: [06/ma trận truy vết](../06-truy-vet/ma-tran-truy-vet.md).

---

## 15. BR-REP — Định nghĩa chỉ số báo cáo

| Mã | Quy tắc |
|----|---------|
| BR-REP-01 | **Định nghĩa chỉ số (nguồn chân lý duy nhất cho báo cáo):** `ADR` = doanh thu **thuần** (BR-RATE-08) ÷ số phòng-đêm đã bán; `RevPAR` = doanh thu **thuần** ÷ số phòng khả dụng (phòng `ACTIVE` × số đêm của kỳ, đã trừ `RoomBlock`); `công suất` = số phòng-đêm đã bán ÷ số phòng khả dụng; `tỷ lệ huỷ` = số booking `CANCELLED` ÷ tổng booking tạo trong kỳ; `chi phí xử lý quá tải` = Σ chiết khấu ghép phòng + Σ bồi thường walk-out + Σ chi phí đưa đón (BR-OVER-15). Mọi báo cáo PHẢI dùng đúng các định nghĩa này; cấm mỗi báo cáo tự định nghĩa lại. Phòng DOR đếm theo **đơn vị bán** (giường) khi tính phòng-đêm đã bán. |
