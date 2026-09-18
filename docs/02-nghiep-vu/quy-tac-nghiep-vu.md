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

---

## 1. BR-GEN — Quy tắc chung

| Mã | Quy tắc |
|----|---------|
| BR-GEN-01 | Mọi giá trị tiền tệ PHẢI là **số nguyên VND**. KHÔNG ĐƯỢC dùng số thực (`float`/`number` thập phân) để tính tiền ở bất kỳ tầng nào. |
| BR-GEN-02 | Mọi mốc thời gian PHẢI lưu ở **UTC** trong CSDL và chỉ chuyển sang giờ VN khi hiển thị hoặc khi so mốc nghiệp vụ. |
| BR-GEN-03 | Làm tròn tiền: **lên** bội số 1.000 VND với giá bán và tiền cọc; **xuống** bội số 1.000 VND với tiền hoàn. |
| BR-GEN-04 | Thời điểm nhận phòng danh nghĩa = ngày `checkIn` lúc `Property.checkInTime` (mặc định **14:00 giờ VN**). Thời điểm trả phòng danh nghĩa = ngày `checkOut` lúc `Property.checkOutTime` (mặc định **12:00 giờ VN**). |
| BR-GEN-05 | Múi giờ nghiệp vụ của mọi cơ sở là `Asia/Ho_Chi_Minh`; hệ thống chưa hỗ trợ cơ sở ở múi giờ khác. |
| BR-GEN-06 | Mã đặt phòng sinh theo `PH-<YYMMDD>-<5 ký tự A-Z0-9>`; PHẢI duy nhất toàn hệ thống kể cả khi hai yêu cầu đến cùng mili-giây. |
| BR-GEN-07 | Mọi thao tác ghi làm thay đổi `Booking`, `Payment`, `RefundRequest`, `RoomMove`, `SystemSetting` PHẢI tạo một bản ghi `AuditLog` trong cùng transaction. |
| BR-GEN-08 | Mọi thao tác ghi từ giao diện PHẢI mang `Idempotency-Key`; gửi lại cùng khoá trong 24 giờ trả về đúng kết quả cũ, không tạo bản ghi mới. |

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
| BR-INV-01 | Tồn khả dụng tính theo **hai tầng**, không trừ dồn: <br>• **Tồn chung (pool)** của `(roomTypeId, date)` = số phòng `ACTIVE` **− `RoomBlock` đang hiệu lực − `RoomAssignment` đang hoạt động − hold chưa sinh `RoomAssignment`**. <br>• **Tồn của một kênh** = `min(tồn chung, ChannelAllotment.allotment − ChannelAllotment.used)`. <br>**Quy tắc chống đếm trùng:** (a) một hold đã sinh `RoomAssignment` **chỉ** được đếm một lần, qua `RoomAssignment`, không đếm lại ở số hạng hold; (b) `allotment` là **hạn mức bán của kênh**, KHÔNG phải phần tồn bị giữ khỏi các kênh khác — vì vậy nó chỉ xuất hiện ở tầng thứ hai, không trừ vào tồn chung. |
| BR-INV-02 | Việc **kiểm tra tồn và giữ chỗ** PHẢI nằm trong **một transaction** có khoá bi quan theo `(roomTypeId, date)` (`SELECT … FOR UPDATE`). KHÔNG ĐƯỢC kiểm tra tồn ở tầng ứng dụng rồi ghi sau. |
| BR-INV-03 | Bất biến cứng: với mọi cặp **(đơn vị bán, đêm)**, số `RoomAssignment` đang hoạt động **≤ 1**. *Đơn vị bán* = **giường** với loại phòng bán theo giường (DOR), = **phòng** với mọi loại khác; biểu diễn bằng `bed_no` với **`bed_no = 0` nghĩa là "cả phòng"**, `1..bedCount` nghĩa là giường cụ thể. Ràng buộc PHẢI được ép ở tầng CSDL bằng ràng buộc loại trừ trên bộ khoá tổ hợp **`(room_id, bed_no, valid_range)`**, không chỉ ở mã ứng dụng. **Cấm** dùng khoá đơn sinh kiểu `COALESCE(bed_no::text, room_id)`: số giường lặp lại ở mọi phòng nên khoá đó va chạm giữa các phòng khác nhau. Khi ràng buộc từ chối (`23P01` của PostgreSQL), tầng ứng dụng PHẢI bắt và chuyển thành mã lỗi `E_INV_ROOM_TAKEN` (HTTP 409) — **không được** nuốt lỗi rồi báo thành công. |
| BR-INV-04 | Hold hết hạn PHẢI được giải phóng trong vòng **60 giây** kể từ `holdExpiresAt`; phòng giải phóng phải trở lại tồn khả dụng ngay. |
| BR-INV-05 | `ChannelAllotment.allotment` của một ngày KHÔNG ĐƯỢC vượt quá số **đơn vị bán** `ACTIVE` của loại phòng tương ứng (giường với DOR, phòng với loại khác). Hạn mức **hiệu lực** để bán luôn là `min(allotment − used, tồn chung theo BR-INV-01)` nên `RoomBlock` và booking đã bán vẫn chặn được kênh. |
| BR-INV-06 | `RoomBlock` chồng lấn với một `RoomAssignment` đang hoạt động PHẢI bị từ chối, trừ khi người thao tác là `MANAGER`+ và có lý do. Khi đó hệ thống PHẢI mở `OverbookingCase` cho các booking bị ảnh hưởng. |
| BR-INV-07 | Kiểm tra tồn cho khoảng ngày PHẢI xét **từng đêm riêng biệt**; một kỳ lưu trú chỉ khả dụng khi **mọi** đêm đều còn phòng. Khi không còn phòng, API trả lỗi `E_INV_NO_AVAILABILITY` (HTTP 409) kèm danh sách đêm thiếu. |

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
| BR-RATE-02 | Giá cơ bản của một đêm tra trong `RateCalendar` theo `priority` **giảm dần**; dòng đầu tiên khớp `(roomTypeId, date)` và — nếu dòng có khai `channelCode` — khớp cả kênh bán, sẽ thắng. Thứ tự ưu tiên: ghi đè tường minh `OVERRIDE` (100) → giá cố định của gói giá `RATE_PLAN` (90) → lịch giá theo mùa `SEASON` (50) → giá nền `BASE` (10). Không cộng dồn; không dòng nào khớp thì dùng `RoomType.basePrice`. Giá ghi đè **không miễn** các bước 2–7: nó chỉ thay `base`, vẫn đi qua hệ số mùa/cuối tuần/công suất/LOS/kênh và vẫn chịu kẹp sàn–trần. Khi nhiều dòng cùng `priority`, phá hoà theo thứ tự: (1) dòng khai `channelCode` cụ thể thắng dòng để trống; (2) `createdAt` **nhỏ hơn** thắng; (3) `id` tăng dần. |
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
tử số   = số phòng có RoomAssignment đang hoạt động trong đêm đó
        + số booking đang HELD còn hiệu lực trong đêm đó
mẫu số  = số phòng ACTIVE của cơ sở (loại trừ MAINTENANCE và INACTIVE)
occupancyPct = tử số / mẫu số × 100
```

Phòng bị `RoomBlock` (bảo trì) **không** vào tử số (không bán được) và **cũng không** vào mẫu số (không phải nguồn cung khả dụng) — vì vậy một cơ sở khoá nửa số phòng vẫn có thể đạt công suất 100%. Snapshot cũ hơn **5 phút** bị coi là hết hiệu lực và bước 4 dùng hệ số `1,00`.

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
| `NONREF` | 1 | 30 | **false** | false (đổi ngày có phí 10%) | 100% |
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
| BR-RATE-17 | Cùng một đầu vào `(roomTypeId, propertyId, channelCode, ratePlanId, checkIn, checkOut, adults, children, promoCode, thời điểm)` PHẢI cho ra cùng một kết quả trên web khách, app Android và API. |
| BR-RATE-18 | Tỷ lệ hoa hồng mặc định theo kênh: `OTA_BOOKING` 18% · `OTA_AGODA` 17% · `OTA_AIRBNB` 15% · `AGENCY` 10% · các kênh còn lại 0%. Hoa hồng và hệ số giá **cấu hình được theo từng cặp (kênh, cơ sở)** qua `ChannelPropertySetting`, ghi đè giá trị mặc định toàn chuỗi; mọi thay đổi ghi `AuditLog` và ảnh hưởng báo cáo doanh thu thuần từ ngày hiệu lực. Khi có nhiều dòng cho cùng `(kênh, cơ sở)`, **phân giải theo ngày của từng đêm** (không theo `quotedAt`): dòng có `effectiveFrom` **lớn nhất và ≤ ngày của đêm đó** thắng; `settingId` đã chọn PHẢI ghi vào `PriceSnapshot` để tái lập được kết quả. |
| BR-RATE-19 | **Ưu đãi dài ngày:** `LONGSTAY14` PHẢI có giá riêng biệt so với các gói khác cho cùng kỳ lưu trú — cấu hình bằng `RatePlan.fixedNightlyPrice` hoặc dòng `RateCalendar` nguồn `RATE_PLAN`. Nếu không cấu hình, gói này cho **cùng mức giá** với `FLEX7` (vì cả hai đều bật LOS) và hệ thống PHẢI cảnh báo ở màn hình cấu hình rằng gói dài ngày không mang lại ưu đãi giá. Mức ưu đãi gợi ý tối thiểu: **5%** so với `FLEX7` cho cùng kỳ. |

---

## 5. BR-BOOK — Đặt phòng

| Mã | Quy tắc |
|----|---------|
| BR-BOOK-01 | Tạo booking cần tối thiểu: khách, cơ sở, loại phòng, `checkIn`, `checkOut`, số người lớn, kênh, gói giá. Thiếu bất kỳ trường nào → từ chối `E_BOOK_MISSING_FIELD`. |
| BR-BOOK-02 | `checkIn` KHÔNG ĐƯỢC ở quá khứ (theo ngày VN) và KHÔNG ĐƯỢC xa hơn **365 ngày** kể từ hôm nay. |
| BR-BOOK-03 | Số đêm ≥ `ratePlan.minNights` và ≤ `ratePlan.maxNights`. `LONGSTAY14` yêu cầu tối thiểu **14 đêm**. `NONREF` tối thiểu 1 đêm. |
| BR-BOOK-04 | Số khách tối đa = `roomType.capacityAdults × roomCount`; vượt → `E_BOOK_OVER_CAPACITY`. |
| BR-BOOK-05 | **Phụ thu trẻ em:** dưới 6 tuổi miễn phí (tối đa 2 trẻ/phòng); 6–11 tuổi tính 50% giá người lớn; từ 12 tuổi tính như người lớn. |
| BR-BOOK-06 | Vòng đời trạng thái PHẢI tuân theo máy trạng thái ở [03/mô hình động](../03-phan-tich/mo-hinh-dong.md) §2. Mọi chuyển trạng thái ghi `BookingStatusHistory`. |
| BR-BOOK-07 | `HELD`: booking giữ chỗ, `holdExpiresAt` = thời điểm tạo + `channel.holdMinutes`. Kênh có `holdMinutes = 0` bỏ qua trạng thái này. |
| BR-BOOK-08 | Hết hạn hold → `EXPIRED`, giải phóng toàn bộ `RoomAssignment` và trả phòng về tồn khả dụng trong cùng transaction. |
| BR-BOOK-09 | Booking chỉ chuyển sang `CONFIRMED` khi `paidAmount ≥ depositAmount`, **trừ** hai trường hợp được cấu hình cho phép xác nhận không cọc: (a) booking đến từ OTA thu tiền hộ, nhận diện bằng `PaymentMethod = OTA_COLLECT`; (b) khách vãng lai được `MANAGER`+ cho phép ghi nợ có lý do. |
| BR-BOOK-10 | Một booking có thể gồm nhiều phòng (`roomCount > 1`); mỗi phòng là một `BookingRoom`, mỗi đêm là một `RoomAssignment`. |
| BR-BOOK-11 | Huỷ booking PHẢI giải phóng mọi `RoomAssignment` trong **cùng transaction** với việc đổi trạng thái. |
| BR-BOOK-12 | **Đổi ngày (reschedule):** 1 lần miễn phí khi còn ≥ 168 giờ, áp dụng cho `FLEX7`, `SAVER3`, `LONGSTAY14`; `NONREF` thu phí 10% giá trị booking. Chênh lệch giá tính theo giá mới: tăng thì thu thêm, giảm thì không hoàn. Lần thứ hai tính như huỷ + đặt mới. Đổi ngày **không tạo chuyển trạng thái** — booking giữ nguyên trạng thái hiện tại và `PriceSnapshot` cũ được giữ lại để đối chiếu; thay đổi ghi vào `AuditLog` theo BR-GEN-07. |
| BR-BOOK-13 | Booking ở trạng thái `CHECKED_IN` KHÔNG ĐƯỢC sửa ngày; phải check-out rồi tạo booking mới. |
| BR-BOOK-14 | Xoá cứng booking đã `CONFIRMED` là **cấm**. Booking `DRAFT` hoặc `HELD` **chưa phát sinh thanh toán** được xoá cứng; đã phát sinh thanh toán thì chỉ được chuyển sang `CANCELLED` kèm `RefundRequest` theo BR-CANCEL-01. |
| BR-BOOK-15 | Khách trong danh sách đen không tạo được booking mới; `MANAGER`+ override có lý do và ghi nhật ký. |
| BR-BOOK-16 | Chống đặt trùng: cùng kênh + cùng số điện thoại + cùng loại phòng + cùng ngày nhận phòng trong 24 giờ → trả về booking đã có kèm cờ `duplicateSuspected`, không tạo mới. |
| BR-BOOK-17 | Xoá cứng booking `DRAFT`/`HELD` (BR-BOOK-14) PHẢI ghi `AuditLog` với `beforeJson` đầy đủ **trước khi** xoá — nghĩa vụ ghi vết của BR-GEN-07 không được miễn trừ bởi việc xoá cứng. Bản ghi booking sau đó không còn để truy vấn; chỉ nhật ký còn lại. |

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
| BR-CANCEL-01 | Mức hoàn PHẢI được xác định bằng bảng trên, dữ liệu hoá trong `CancellationPolicy`/`CancellationTier`. Cấm viết điều kiện `if/else` cứng trong mã theo từng gói giá. **Bậc cuối (`offsetHours = −1`) là bậc bắt tất (catch-all)**: nó áp cho **mọi** giá trị `hoursBeforeCheckIn < 24`, kể cả giá trị **âm** (đã qua giờ nhận phòng, ví dụ no-show lúc 23:59). Nhờ vậy hàm chọn bậc luôn trả về đúng một bậc với mọi đầu vào thực tế. |
| BR-CANCEL-02 | Tỷ lệ cọc theo gói giá: `FLEX7` 30% · `SAVER3` 50% · `NONREF` 100% · `LONGSTAY14` 30%. Cọc làm tròn **lên** bội 1.000 VND. |
| BR-CANCEL-03 | `hoursBeforeCheckIn` tính từ **thời điểm nhận phòng danh nghĩa** (BR-GEN-04), không từ ngày hay từ thời điểm tạo booking. |
| BR-CANCEL-04 | **Cơ sở tính hoàn:** `refundBase = paidAmount` (số tiền **đã thực trả**), không phải `totalAmount`. Chưa trả đồng nào thì hoàn 0. |
| BR-CANCEL-05 | `refundAmount = floor(paidAmount × refundPercent / 100 / 1000) × 1000`. Số tiền **thực chi cho khách** là `netRefund = refundAmount − refundFee` (BR-CANCEL-11). Mọi ngưỡng phê duyệt và mọi báo cáo so trên `netRefund`; nếu `refundFee > refundAmount` thì `netRefund = 0` và phần phí còn lại không được thu thêm khách. |
| BR-CANCEL-06 | Khi bậc có `chargeFirstNight = true`: `penaltyAmount = max(0, firstNightPrice − paidAmount)`, trong đó `firstNightPrice` là giá đêm đầu trong `PriceSnapshot`. Khoản này tạo `Payment` loại `PENALTY` ở trạng thái `PENDING` (ghi công nợ), không tự thu. |
| BR-CANCEL-07 | `NONREF` không bao giờ hoàn tiền, kể cả huỷ trước nhiều tháng. Chỉ đổi ngày theo BR-BOOK-12 với phí 10%. |
| BR-CANCEL-08 | **Đổi ngày:** xem BR-BOOK-12. Đổi ngày KHÔNG tạo `RefundRequest`. |
| BR-CANCEL-09 | **Trả phòng sớm.** Cơ sở tính = `min(paidAmount, tổng giá các đêm chưa ở theo PriceSnapshot)` — tức không bao giờ hoàn nhiều hơn số đã trả (BR-CANCEL-04) cũng không nhiều hơn giá trị phần chưa ở. Tỷ lệ: `FLEX7` và `SAVER3` báo trước **≥ 72 giờ** → **50%** cơ sở; `LONGSTAY14` báo trước **≥ 168 giờ** → **50%**; `NONREF` → **0%** ở mọi mốc; báo trước dưới ngưỡng tương ứng hoặc không báo → **0%**. Khoản hoàn ghi nhận qua `RefundRequest` với `policyId` của gói giá và lý do `EARLY_CHECKOUT`. |
| BR-CANCEL-10 | **Không đến (no-show):** hệ thống tự đánh dấu lúc **23:59 ngày nhận phòng** nếu booking còn `CONFIRMED` và chưa check-in. Áp bậc cuối của chính sách (hoàn 0%) + phụ thu đêm đầu nếu bậc quy định. |
| BR-CANCEL-11 | **Phí xử lý hoàn tiền:** mặc định 0 VND, cấu hình được qua `SystemSetting`. Nếu > 0, phí trừ vào tiền hoàn, không thu thêm khách. |
| BR-CANCEL-12 | **Cam kết hoàn tiền:** xử lý trong 3 ngày làm việc, tối đa 7 ngày kể từ khi `RefundRequest` được duyệt. |
| BR-CANCEL-13 | **Bất khả kháng** (thiên tai, dịch bệnh, cơ sở đóng cửa, lỗi hệ thống): được hoàn **100% `paidAmount`**, miễn phụ thu, miễn phí xử lý. Chỉ `MANAGER`+ được tạo, PHẢI có lý do ≥ 20 ký tự và đính kèm minh chứng (tuỳ chọn). Mọi ca bất khả kháng vào báo cáo riêng. |
| BR-CANCEL-14 | **Huỷ do khách sạn (walk-out):** hoàn 100% + bồi thường theo BR-OVER-06. Khách từ chối phương án điều chuyển được xử lý như walk-out. |
| BR-CANCEL-15 | **Phê duyệt hai cấp:** `RefundRequest` có `netRefund` (BR-CANCEL-05) **> 5.000.000 VND** PHẢI do người **khác** người tạo duyệt, và người duyệt phải từ `MANAGER` trở lên. Người tạo KHÔNG ĐƯỢC tự duyệt yêu cầu của mình với mọi mức tiền. |
| BR-CANCEL-16 | Hoàn tiền **chỉ** được chi sau khi `RefundRequest` ở trạng thái `APPROVED`; mọi thay đổi trạng thái ghi `AuditLog` kèm lý do. |
| BR-CANCEL-17 | Tổng hoàn lũy kế của một booking KHÔNG ĐƯỢC vượt `paidAmount` (BR-PAY-07). |
| BR-CANCEL-18 | `RefundRequest` ở trạng thái `PENDING` được chuyển sang `CANCELLED` khi khách rút yêu cầu hoặc khi booking được khôi phục. Chỉ người tạo hoặc `MANAGER`+ được thực hiện, bắt buộc ghi lý do. Yêu cầu đã ở `APPROVED` hoặc `PAID` **KHÔNG ĐƯỢC** chuyển sang `CANCELLED`. |
| BR-CANCEL-19 | **Huỷ một phần** (booking có `roomCount > 1`): chỉ các `BookingRoom` được chọn bị huỷ; phần đã trả được **phân bổ theo tỷ lệ giá của các phòng bị huỷ trên `totalAmount`** để tính `refundBase` cho BR-CANCEL-05; các phòng còn lại giữ nguyên giá và `RoomAssignment`, `totalAmount` được điều chỉnh giảm, và hệ thống lưu thêm một `PriceSnapshot` điều chỉnh (giữ bản gốc — BR-RATE-16). Nếu chỉ còn 0 phòng thì booking chuyển `CANCELLED` như huỷ toàn phần. |

---

## 7. BR-PAY — Thanh toán

| Mã | Quy tắc |
|----|---------|
| BR-PAY-01 | `depositAmount = roundUp1000(totalAmount × depositPercent / 100)`. |
| BR-PAY-02 | `balanceDue = totalAmount − paidAmount + penaltyAmount`, thu **trước khi giao phòng** tại quầy. Với booking đã ở trạng thái `CANCELLED`, `NO_SHOW` hoặc `EXPIRED`, phần `totalAmount − paidAmount` **KHÔNG** tạo công nợ: hệ thống đặt `balanceDue = penaltyAmount` (thường bằng 0), và **chỉ** `penaltyAmount` theo BR-CANCEL-06 mới là khoản phải thu. |
| BR-PAY-03 | Callback từ cổng thanh toán PHẢI idempotent theo `idempotencyKey`; cùng khoá gửi lại không tạo `Payment` thứ hai và không cộng dồn `paidAmount`. |
| BR-PAY-04 | Hệ thống **KHÔNG ĐƯỢC** lưu số thẻ, ngày hết hạn hay CVV. Chỉ lưu mã giao dịch của cổng, số tiền và trạng thái. |
| BR-PAY-05 | Giao dịch quá **15 phút** không có callback → chuyển `FAILED`, giải phóng hold tương ứng. |
| BR-PAY-06 | Thanh toán tiền mặt PHẢI ghi `createdBy` (người thu) và `paidAt` (thời điểm thu). Đối soát tiền mặt thực hiện theo cặp **(người thu, ngày VN)** — hệ thống không quản lý ca làm việc (ngoài phạm vi, xem 00 §3.2). |
| BR-PAY-07 | Tổng hoàn lũy kế của một booking ≤ `paidAmount`. |
| BR-PAY-08 | Hoàn tiền về **phương thức gốc**; nếu gốc là tiền mặt → chuyển khoản, có ghi chú số tài khoản. |
| BR-PAY-09 | Hoàn tiền ghi nhận bằng `Payment` loại `REFUND` (bút toán đảo), KHÔNG ĐƯỢC sửa hay xoá `Payment` gốc. |
| BR-PAY-10 | Đối soát cuối ngày: mọi `Payment` tiền mặt phải khớp số tiền mặt thực thu **theo từng cặp (người thu, ngày VN)**; chênh lệch > 50.000 VND phải báo `MANAGER` kèm danh sách giao dịch liên quan. |

---

## 8. BR-CHAN — Kênh bán

| Mã | Quy tắc |
|----|---------|
| BR-CHAN-01 | Phân bổ mặc định cho mỗi kênh OTA = **80%** số **đơn vị bán** `ACTIVE` của loại phòng, hiểu là **hạn mức bán tối đa của kênh đó** (`ChannelAllotment.allotment`), không phải phần tồn bị khoá khỏi các kênh khác. Hạn mức làm tròn **XUỐNG** (bảo thủ) và **tối thiểu 1**; với DOR, đơn vị tính là **giường** (ví dụ loại có 12 giường → `floor(12 × 0,80) = 9`). Kênh `AGENCY` **có hạn mức riêng** theo hợp đồng cam kết sản lượng. Chỉ `WEB`, `PHONE`, `WALKIN` **không có hạn mức riêng** và cùng chia sẻ tồn chung. Kênh OTA không bao giờ thấy nhiều hơn `min(tồn chung, allotment − used)`. |
| BR-CHAN-02 | Đồng bộ tồn phòng & giá lên OTA PHẢI chạy **ngay khi có thay đổi** (qua outbox) và chậm nhất **5 phút**; đồng thời quét định kỳ mỗi 5 phút. |
| BR-CHAN-03 | Booking đến từ OTA PHẢI được ghi nhận ở trạng thái `CONFIRMED` khi OTA báo đã thu tiền (`PaymentMethod = OTA_COLLECT`), **kể cả khi tồn khả dụng bằng 0**. Đây là **miễn trừ tường minh** đối với BR-OVER-01/02: hạn mức `overbookLimitPct` chỉ điều tiết các quyết định bán vượt mà **hệ thống chủ động** thực hiện, không áp cho booking do kênh ngoài đẩy vào. Mọi booking như vậy PHẢI đặt `oversold = true` và mở `OverbookingCase` theo BR-OVER-03. |
| BR-CHAN-04 | Booking OTA bị huỷ theo **chính sách của OTA**, không áp BR-CANCEL; hệ thống ghi nhận `cancelReason = OTA_CANCELLATION` và lưu mã chính sách kênh để đối soát. Booking huỷ theo đường này KHÔNG tạo `RefundRequest` trong hệ thống — tiền do OTA hoàn theo hợp đồng, kế toán đối soát qua báo cáo UC-PAY-05. |
| BR-CHAN-05 | Khi tồn khả dụng của một loại phòng trong một ngày còn **≤ 2 phòng**, hệ thống tự đóng bán loại phòng đó trên **mọi kênh OTA** trong ngày ấy (khoá kênh), mở lại khi tồn > 2. Kênh trực tiếp vẫn bán bình thường. Khi **mở** bán, giá trị tồn PHẢI đẩy lên kênh là `min(tồn chung theo BR-INV-01, allotment − used)` — **cấm** đẩy hạn mức thô `allotment`, vì như vậy OTA vẫn thấy phòng đã bán hoặc đã bị `RoomBlock`. |
| BR-CHAN-06 | Mọi thay đổi giá hoặc tồn PHẢI ghi `OutboxEvent` trong cùng transaction và được gửi tới mọi kênh đang mở bán. |
| BR-CHAN-07 | Đồng bộ thất bại 3 lần liên tiếp PHẢI phát cảnh báo cho `MANAGER` và đánh dấu kênh là `DEGRADED` trên bảng điều khiển. |
| BR-CHAN-08 | Số lượng phòng bán trên OTA không bao giờ vượt `ChannelAllotment.allotment` còn lại của ngày đó. |

---

## 9. BR-OVER — Quá tải, ghép phòng & điều chuyển

### 9.1. Bán vượt có kiểm soát

| Mã | Quy tắc |
|----|---------|
| BR-OVER-01 | Mặc định `Property.overbookLimitPct = 0` — không bán vượt. |
| BR-OVER-02 | Chỉ được bán vượt khi **đồng thời**: (a) kênh có `overbookAllowed = true`; (b) `Property.overbookLimitPct > 0` (đầu vào, tối đa **5%**); (c) số phòng vượt của ngày ≤ **trần theo cơ sở** = `ceil(số phòng ACTIVE × overbookLimitPct / 100)`, và **tối thiểu 1** nếu `overbookLimitPct > 0` (để cơ sở nhỏ vẫn dùng được hạn mức). Trần toàn chuỗi = **tổng trần theo từng cơ sở**, KHÔNG phải `ceil` trên tổng 55 phòng. Ví dụ với 5%: CS-01 (24 phòng) → 2; CS-02 (18) → 1; CS-03 (13) → 1; toàn chuỗi → **4**. Vượt trần → từ chối `E_OVER_LIMIT_EXCEEDED`. |
| BR-OVER-03 | Mọi booking được tạo khi không còn phòng vật lý PHẢI có `oversold = true` và tự động mở một `OverbookingCase`. |
| BR-OVER-04 | `OverbookingCase` PHẢI được xử lý (chuyển sang `RESOLVED`) **trước T−24h**. Quá hạn → leo thang cho `OWNER` và hiện trên bảng điều khiển. |
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
| BR-FO-01 | Check-in chỉ khi: booking `CONFIRMED`, `penaltyAmount + balanceDue = 0` (hoặc `MANAGER`+ cho phép ghi nợ có lý do), và ngày VN hiện tại = ngày `checkIn`. Nhánh cho phép ghi nợ chỉ áp dụng khi số nợ **≤ 5.000.000 VND** đồng thời **≤ 50% `totalAmount`**; vượt cả hai ngưỡng phải `OWNER` duyệt. Mọi lần ghi nợ ghi `AuditLog` kèm lý do và hạn thu. |
| BR-FO-02 | Check-in sau 23:59 ngày nhận phòng bị từ chối; booking phải được xử lý no-show trước. |
| BR-FO-03 | **Check-out muộn:** trước 12:00 miễn phí; 12:00–18:00 thu **50%** giá đêm cuối; sau 18:00 thu **100%** giá đêm cuối. |
| BR-FO-04 | **Check-in sớm:** 08:00–12:00 miễn phí nếu phòng sẵn sàng; 12:00–14:00 thu **30%** giá đêm đầu; trước 08:00 phải đặt thêm 1 đêm. |
| BR-FO-05 | Check-out PHẢI chốt `balanceDue` về 0 trước khi in hoá đơn và giải phóng phòng. |
| BR-FO-06 | Sau check-out, hệ thống tạo `HousekeepingTask` cho phòng với `businessDate` = ngày trả phòng. Trạng thái buồng phòng **KHÔNG** làm giảm tồn khả dụng theo ngày (BR-INV-01) — nó chỉ chặn **thời điểm giao phòng** cho khách. |
| BR-FO-07 | Phòng chưa ở trạng thái `DONE`/`INSPECTED` KHÔNG ĐƯỢC **giao** cho khách tại thời điểm check-in. Việc gán phòng cho cùng ngày vẫn hợp lệ (luân chuyển trong ngày) miễn là task dọn hoàn tất **trước `Property.checkInTime`** của khách mới. Nếu tới giờ nhận phòng mà phòng chưa dọn xong, lễ tân PHẢI đổi phòng hoặc báo khách chờ, và ghi nhận sự việc vào `HousekeepingTask.note`. |

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
| BR-RBAC-01 | Sáu vai trò: `OWNER`, `MANAGER`, `FRONT_DESK`, `RESERVATION_AGENT`, `ACCOUNTANT`, `HOUSEKEEPING`. |
| BR-RBAC-02 | Người dùng có `propertyScope`; ngoài `OWNER`, mọi vai trò **chỉ** thấy và thao tác trên dữ liệu thuộc cơ sở trong phạm vi của mình. |
| BR-RBAC-03 | Quyền tối thiểu theo thao tác: |

| Thao tác | Vai trò tối thiểu |
|----------|-------------------|
| Xem lịch tồn phòng, tra cứu booking | `HOUSEKEEPING` |
| Tạo booking, check-in, check-out, thu tiền | `FRONT_DESK`, `RESERVATION_AGENT` |
| Ghi no-show, đổi phòng (bậc 1–2), ghép phòng | `FRONT_DESK` (khác giới tính cần `MANAGER`) |
| Duyệt hoàn tiền ≤ 5.000.000 VND | `MANAGER` |
| Duyệt hoàn tiền > 5.000.000 VND | `MANAGER` khác người tạo; `OWNER` |
| Walk-out, bất khả kháng, điều chuyển khác thành phố | `MANAGER` |
| Cấu hình giá, mùa, kênh, chính sách huỷ, tham số hệ thống | `OWNER` |
| Đối soát, báo cáo tài chính | `ACCOUNTANT`, `OWNER` |
| Xem nhật ký kiểm toán | `OWNER`, `MANAGER` |

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
| BR-RATE | 01–19 | 19 | BT-2 |
| BR-BOOK | 01–17 | 17 | |
| BR-CANCEL | 01–19 | 19 | BT-1 |
| BR-PAY | 01–10 | 10 | BT-1 |
| BR-CHAN | 01–08 | 8 | BT-3 |
| BR-OVER | 01–16 | 16 | BT-3 |
| BR-FO | 01–07 | 7 | |
| BR-CRM | 01–06 | 6 | |
| BR-RBAC | 01–06 | 6 | |
| BR-SYS | 01–06 | 6 | |
| BR-REP | 01 | 1 | |
| **Tổng** | | **136** | |

Truy vết BR → UC → API → Entity → Test: [06/ma trận truy vết](../06-truy-vet/ma-tran-truy-vet.md).

---

## 15. BR-REP — Định nghĩa chỉ số báo cáo

| Mã | Quy tắc |
|----|---------|
| BR-REP-01 | **Định nghĩa chỉ số (nguồn chân lý duy nhất cho báo cáo):** `ADR` = doanh thu **thuần** (BR-RATE-08) ÷ số phòng-đêm đã bán; `RevPAR` = doanh thu **thuần** ÷ số phòng khả dụng (phòng `ACTIVE` × số đêm của kỳ, đã trừ `RoomBlock`); `công suất` = số phòng-đêm đã bán ÷ số phòng khả dụng; `tỷ lệ huỷ` = số booking `CANCELLED` ÷ tổng booking tạo trong kỳ; `chi phí xử lý quá tải` = Σ chiết khấu ghép phòng + Σ bồi thường walk-out + Σ chi phí đưa đón (BR-OVER-15). Mọi báo cáo PHẢI dùng đúng các định nghĩa này; cấm mỗi báo cáo tự định nghĩa lại. Phòng DOR đếm theo **đơn vị bán** (giường) khi tính phòng-đêm đã bán. |
