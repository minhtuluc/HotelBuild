# 01 — Yêu cầu chức năng

> Danh mục yêu cầu chức năng (FR) của Hệ thống đặt phòng khách sạn – homestay (chuỗi Pine Hill, 3 cơ sở, 55 phòng, 7 kênh bán).
> Nguồn chân lý về giá trị nghiệp vụ là [02/quy tắc nghiệp vụ](../02-nghiep-vu/quy-tac-nghiep-vu.md) — tài liệu này **chỉ tham chiếu mã BR**, không định nghĩa lại giá trị.
> Mã UC lấy từ [00 §8](../00-tong-quan.md#8-danh-mục-use-case); actor lấy từ [00 §4](../00-tong-quan.md#4-actor); thực thể/enum lấy từ [00 §7](../00-tong-quan.md#7-từ-điển-thực-thể-nguồn-chân-lý-về-định-danh).

## 1. Quy ước bảng

Mỗi FR gồm 7 cột:

| Cột | Ý nghĩa |
|-----|---------|
| Mã | `FR-<MOD>-<nn>`, định danh duy nhất toàn bộ tài liệu |
| Tên | Tên ngắn gọn của yêu cầu |
| Mô tả | Một câu mô tả hành vi bắt buộc; giá trị nghiệp vụ chỉ qua mã BR |
| Actor chính | Mã actor trong [00 §4](../00-tong-quan.md#4-actor) |
| Use case | Mã UC tương ứng (một FR có thể trỏ nhiều UC) |
| BR áp dụng | Mã quy tắc nghiệp vụ bắt buộc phải thoả |
| Ưu tiên | `M` Must · `S` Should · `C` Could · `W` Won't (MoSCoW) |

**Ghi chú xuyên module:** nhóm `BR-GEN` là quy tắc nền (tiền tệ, thời gian, idempotency, kiểm toán) — được phủ bởi các FR thuộc SYS/BOOK/PAY/RATE; nhóm `BR-CANCEL` (huỷ & hoàn) được phủ bởi các FR thuộc BOOK/PAY/FO/OVER; nhóm `BR-RBAC` (phân quyền) được phủ bởi các FR thuộc AUTH.

---

## 2. AUTH — Định danh & phân quyền

| Mã | Tên | Mô tả | Actor chính | Use case | BR áp dụng | Ưu tiên |
|----|-----|-------|-------------|----------|-----------|---------|
| FR-AUTH-01 | Đăng nhập & phiên làm việc | Cấp JWT access/refresh và áp chính sách hết hạn phiên, xác thực lại tài chính bằng mã PIN theo BR-RBAC-05. | ACT-01..07, ACT-12 | UC-AUTH-01 | BR-RBAC-05 | M |
| FR-AUTH-02 | Quản lý người dùng & vai trò | Tạo/sửa/ngừng người dùng nội bộ gắn đúng một trong bảy vai trò độc lập theo BR-RBAC-01. | ACT-05, ACT-12 | UC-AUTH-02 | BR-RBAC-01 | M |
| FR-AUTH-03 | Phạm vi cơ sở (propertyScope) | Áp `propertyScope` để mọi vai trò (trừ OWNER) chỉ thấy/thao tác dữ liệu thuộc cơ sở được giao theo BR-RBAC-02. | ACT-05, ACT-12 | UC-AUTH-02 | BR-RBAC-02 | M |
| FR-AUTH-04 | Quyền tường minh và sở hữu | Kiểm tập vai trò, propertyScope và sở hữu guestId/ID con từ principal xác thực; deny mặc định, không kế thừa vai trò, HOUSEKEEPING không xem tài chính/hồ sơ khách theo BR-RBAC-03. | ACT-12 | UC-AUTH-02 | BR-RBAC-03 | M |
| FR-AUTH-05 | Xác nhận lại thay đổi giá | Yêu cầu OWNER xác nhận bằng hộp thoại khi thay đổi giá vượt ngưỡng theo BR-RBAC-04. | ACT-05 | UC-RATE-01 | BR-RBAC-04 | C |
| FR-AUTH-06 | Khoá tài khoản đăng nhập sai | Khoá tài khoản tạm thời sau số lần đăng nhập thất bại liên tiếp theo BR-RBAC-06. | ACT-12 | UC-AUTH-01 | BR-RBAC-06 | M |
| FR-AUTH-07 | Đăng ký & đăng nhập khách hàng | Cho phép khách tự đăng ký/đăng nhập và nhận diện duy nhất theo số điện thoại chuẩn hoá theo BR-CRM-01. | ACT-01 | UC-AUTH-03 | BR-CRM-01 | M |

---

## 3. PROP — Cơ sở & buồng phòng

| Mã | Tên | Mô tả | Actor chính | Use case | BR áp dụng | Ưu tiên |
|----|-----|-------|-------------|----------|-----------|---------|
| FR-PROP-01 | Quản lý cơ sở | Lưu trữ 3 cơ sở đang hoạt động và phân bổ phòng theo BR-PROP-01, BR-PROP-02. | ACT-05 | UC-PROP-01 | BR-PROP-01, BR-PROP-02 | M |
| FR-PROP-02 | Quản lý loại phòng & sức chứa | Cấu hình loại phòng, phân bổ theo loại và sức chứa khách theo BR-PROP-03, BR-PROP-04. | ACT-05, ACT-04 | UC-PROP-02 | BR-PROP-03, BR-PROP-04 | M |
| FR-PROP-03 | Quản lý phòng & mã phòng | Quản lý phòng vật lý với mã duy nhất trong cơ sở theo định dạng ở BR-PROP-05. | ACT-04, ACT-02 | UC-PROP-03 | BR-PROP-05 | M |
| FR-PROP-04 | Sơ đồ buồng & phòng thông nhau | Ghi nhận quan hệ phòng thông nhau (`connectingRoomId`) làm điều kiện cho ghép phòng theo BR-OVER-15. | ACT-04, ACT-02 | UC-PROP-03 | BR-OVER-15 | C |
| FR-PROP-05 | Khoá phòng bảo trì / ngừng bán | Tạo `RoomBlock` cho bảo trì/ngừng bán và loại trừ phòng khỏi tồn khả dụng theo BR-PROP-06. | ACT-04 | UC-PROP-04 | BR-PROP-06 | M |
| FR-PROP-06 | Loại trừ phòng không khả dụng khỏi tìm phòng | Không đưa phòng `MAINTENANCE`/`INACTIVE` vào kết quả tìm phòng và tồn khả dụng theo BR-PROP-06. | ACT-01, ACT-03 | UC-INV-02 | BR-PROP-06 | M |
| FR-PROP-07 | Cấu hình giờ nhận/trả phòng | Cấu hình `checkInTime`/`checkOutTime` theo cơ sở làm mốc tính nghiệp vụ theo BR-GEN-04. | ACT-05 | UC-PROP-01 | BR-GEN-04 | C |

---

## 4. INV — Tồn phòng

| Mã | Tên | Mô tả | Actor chính | Use case | BR áp dụng | Ưu tiên |
|----|-----|-------|-------------|----------|-----------|---------|
| FR-INV-01 | Tính tồn khả dụng & lịch grid | Tính tồn khả dụng `(roomTypeId, date, channelCode)` theo công thức BR-INV-01 và hiển thị grid theo ngày. | ACT-02, ACT-03, ACT-04 | UC-INV-01 | BR-INV-01 | M |
| FR-INV-02 | Kiểm tra trống theo từng đêm | Kiểm tra khả dụng cho khoảng ngày bằng cách xét từng đêm riêng biệt; kỳ lưu trú chỉ khả dụng khi mọi đêm đều trống, báo lỗi `E_INV_NO_AVAILABILITY` khi hết phòng theo BR-INV-07. | ACT-01, ACT-03, ACT-09 | UC-INV-02 | BR-INV-07 | M |
| FR-INV-03 | Khoá bi quan khi kiểm tồn & giữ chỗ | Thực hiện kiểm tra tồn và giữ chỗ trong một transaction có khoá bi quan theo `(roomTypeId, date)` theo BR-INV-02. | ACT-01, ACT-03 | UC-INV-02 | BR-INV-02 | M |
| FR-INV-04 | Ràng buộc loại trừ chống trùng phòng | Ép bất biến "mỗi `(room_id, bed_no, đêm)` ≤ 1 `RoomAssignment` hoạt động" ở tầng CSDL bằng khoá loại trừ 3 cột theo đơn vị bán (giường/phòng); bắt lỗi `23P01` và trả `E_INV_ROOM_TAKEN` (HTTP 409) theo BR-INV-03. | ACT-11 | UC-BOOK-01 | BR-INV-03 | M |
| FR-INV-05 | Giải phóng hold hết hạn đúng hạn | Giải phóng hold hết hạn trong vòng 60 giây kể từ `holdExpiresAt` và trả phòng về tồn khả dụng ngay theo BR-INV-04. | ACT-11 | UC-BOOK-04 | BR-INV-04 | M |
| FR-INV-06 | Quản lý allotment theo kênh | Cấu hình allotment từng ngày và chặn allotment vượt số đơn vị bán `ACTIVE` theo BR-INV-05. | ACT-05, ACT-04 | UC-INV-03 | BR-INV-05 | M |
| FR-INV-07 | Từ chối RoomBlock chồng lấn assignment | Từ chối `RoomBlock` chồng lấn `RoomAssignment` đang hoạt động; ngoại lệ mở `OverbookingCase` theo BR-INV-06. | ACT-04 | UC-PROP-04 | BR-INV-06 | M |

---

## 5. RATE — Giá, mùa, kênh bán

| Mã | Tên | Mô tả | Actor chính | Use case | BR áp dụng | Ưu tiên |
|----|-----|-------|-------------|----------|-----------|---------|
| FR-RATE-01 | Cấu hình giá cơ bản & sàn/trần | Cấu hình giá cơ bản theo loại phòng và sàn/trần giá theo BR-RATE-03, BR-RATE-04. | ACT-05 | UC-RATE-01 | BR-RATE-03, BR-RATE-04 | M |
| FR-RATE-02 | Thứ tự ưu tiên nguồn giá | Tra giá cơ bản từ `RateCalendar` theo `priority` giảm dần (OVERRIDE → RATE_PLAN → SEASON → BASE), khớp `(roomTypeId, date, channelCode)`, bậc hoà theo BR-RATE-02. | ACT-05 | UC-RATE-01 | BR-RATE-02 | M |
| FR-RATE-03 | Động cơ giá theo thứ tự cố định | Tính giá từng đêm theo pipeline hệ số cố định và làm tròn lên bội 1.000 VND theo BR-RATE-01, BR-GEN-03. | ACT-11 | UC-RATE-05 | BR-RATE-01, BR-GEN-03 | M |
| FR-RATE-04 | Hệ số mùa | Chọn một mùa cho mỗi đêm theo priority và áp hệ số mùa cho mọi kênh theo BR-RATE-05. | ACT-05 | UC-RATE-02 | BR-RATE-05, BR-RATE-01 | M |
| FR-RATE-05 | Hệ số cuối tuần | Áp hệ số cuối tuần cho đêm Thứ Sáu/Thứ Bảy theo BR-RATE-06. | ACT-05 | UC-RATE-02 | BR-RATE-06, BR-RATE-01 | M |
| FR-RATE-06 | Hệ số công suất | Áp hệ số công suất theo `OccupancySnapshot` của cơ sở từng đêm trong pipeline theo BR-RATE-01. | ACT-11 | UC-RATE-05 | BR-RATE-01 | S |
| FR-RATE-07 | Hệ số độ dài lưu trú (LOS) | Áp hệ số LOS cho toàn bộ các đêm khi đủ điều kiện theo BR-RATE-01. | ACT-11 | UC-RATE-05 | BR-RATE-01 | S |
| FR-RATE-08 | Hệ số kênh & hoa hồng | Áp hệ số kênh và ghi hoa hồng cho từng kênh theo BR-RATE-01, BR-RATE-07. | ACT-05 | UC-RATE-03 | BR-RATE-01, BR-RATE-07 | M |
| FR-RATE-09 | Doanh thu thuần theo kênh | Tính doanh thu thuần sau hoa hồng và hiển thị cả gộp lẫn thuần theo BR-RATE-08. | ACT-06 | UC-REP-02 | BR-RATE-08 | S |
| FR-RATE-10 | Cảnh báo cân bằng giá | Cảnh báo khi giá niêm yết (sau kẹp sàn/trần) trên kênh OTA thấp hơn kênh WEB cùng ngày cùng loại theo BR-RATE-09. | ACT-05 | UC-RATE-03 | BR-RATE-09 | C |
| FR-RATE-11 | Quản lý khuyến mãi | Tạo khuyến mãi PERCENT/AMOUNT và quy tắc xếp chồng tối đa theo BR-RATE-10, BR-RATE-13. | ACT-05, ACT-04 | UC-RATE-04 | BR-RATE-10, BR-RATE-13 | M |
| FR-RATE-12 | Giới hạn giảm giá & sàn | Chặn mức giảm vượt trần; khi dưới tổng sàn thì chặn HTTP 422 trên màn hình cấu hình, hoặc cảnh báo không chặn trong báo giá trực tuyến (bỏ mã, vẫn xác nhận) theo BR-RATE-11, BR-RATE-12. | ACT-05, ACT-04 | UC-RATE-04 | BR-RATE-11, BR-RATE-12 | M |
| FR-RATE-13 | Từ chối khuyến mãi hết hạn/hết lượt | Từ chối khuyến mãi hết hạn hoặc hết lượt tại thời điểm xác nhận theo BR-RATE-14. | ACT-05, ACT-04 | UC-RATE-04 | BR-RATE-14 | M |
| FR-RATE-14 | Báo giá & hiệu lực | Sinh `PriceQuote` có hiệu lực 15 phút và buộc tính lại khi quá hạn theo BR-RATE-15. | ACT-01, ACT-03 | UC-INV-02 | BR-RATE-15 | M |
| FR-RATE-15 | Chốt giá bất biến (PriceSnapshot) | Lưu `PriceSnapshot` bất biến ngay khi booking rời `DRAFT` (`HELD`/`PENDING_PAYMENT`/`CONFIRMED`), giữ bản cũ khi đổi ngày theo BR-RATE-16. | ACT-11 | UC-BOOK-01 | BR-RATE-16 | M |
| FR-RATE-16 | Nhất quán giá đa nền tảng | Đảm bảo cùng đầu vào cho cùng kết quả trên web khách, Android và API theo BR-RATE-17. | ACT-01, ACT-04 | UC-RATE-05 | BR-RATE-17 | M |
| FR-RATE-17 | Cấu hình hoa hồng mặc định theo kênh | Cấu hình hoa hồng/hệ số theo cặp (kênh, cơ sở) qua `ChannelPropertySetting`, ghi `AuditLog` và áp cho báo cáo doanh thu thuần từ ngày hiệu lực theo BR-RATE-18. | ACT-05 | UC-RATE-03 | BR-RATE-18 | M |
| FR-RATE-18 | Ưu đãi dài ngày LONGSTAY14 | Đảm bảo `LONGSTAY14` có giá riêng (`fixedNightlyPrice` hoặc dòng `RateCalendar` nguồn `RATE_PLAN`) và cảnh báo khi trùng giá `FLEX7` theo BR-RATE-19. | ACT-05 | UC-RATE-01 | BR-RATE-19 | M |
| FR-RATE-19 | Cấu hình gói giá & chính sách huỷ | OWNER sửa các gói/policy đang có, xác thực toàn bộ tier, cọc/LOS/đổi ngày, lưu nguyên tử với kiểm phiên bản; booking giữ snapshot bất biến theo BR-RATE-20. | ACT-05 | UC-RATE-06 | BR-RATE-20, BR-CANCEL-01, BR-CANCEL-02, BR-CANCEL-09, BR-BOOK-12, BR-RBAC-03 | M |

---

## 6. BOOK — Đặt phòng

| Mã | Tên | Mô tả | Actor chính | Use case | BR áp dụng | Ưu tiên |
|----|-----|-------|-------------|----------|-----------|---------|
| FR-BOOK-01 | Tạo booking trên web | Tạo booking từ web khách với đủ trường bắt buộc và kiểm tra ngày nhận hợp lệ theo BR-BOOK-01, BR-BOOK-02. | ACT-01 | UC-BOOK-01 | BR-BOOK-01, BR-BOOK-02 | M |
| FR-BOOK-02 | Tạo booking tại quầy (vãng lai) | Tạo booking kênh WALKIN tại quầy theo BR-BOOK-01. | ACT-02 | UC-BOOK-02 | BR-BOOK-01 | M |
| FR-BOOK-03 | Tạo booking qua điện thoại | Tạo booking kênh PHONE qua lễ tân/đại lý theo BR-BOOK-01. | ACT-03 | UC-BOOK-03 | BR-BOOK-01 | M |
| FR-BOOK-04 | Kiểm tra số đêm min/max | Kiểm tra số đêm trong khoảng gói giá cho phép (kể cả `LONGSTAY14`, `NONREF`) theo BR-BOOK-03. | ACT-01 | UC-BOOK-01 | BR-BOOK-03 | M |
| FR-BOOK-05 | Kiểm tra sức chứa khách | Từ chối khi số khách vượt sức chứa loại phòng theo BR-BOOK-04. | ACT-01 | UC-BOOK-01 | BR-BOOK-04 | M |
| FR-BOOK-06 | Phụ thu trẻ em | Tính phụ thu trẻ em theo độ tuổi theo BR-BOOK-05. | ACT-01 | UC-BOOK-01 | BR-BOOK-05 | C |
| FR-BOOK-07 | Máy trạng thái booking | Tuân thủ máy trạng thái booking và ghi `BookingStatusHistory` cho mọi chuyển trạng thái theo BR-BOOK-06. | ACT-11 | UC-BOOK-07 | BR-BOOK-06 | M |
| FR-BOOK-08 | Giữ chỗ tạm thời | Đặt `holdExpiresAt` theo `channel.holdMinutes` khi giữ chỗ theo BR-BOOK-07. | ACT-01, ACT-11 | UC-BOOK-04 | BR-BOOK-07 | M |
| FR-BOOK-09 | Hết hạn hold → EXPIRED | Chuyển booking sang `EXPIRED` và giải phóng toàn bộ `RoomAssignment` trong cùng transaction theo BR-BOOK-08/18; xử lý cả PENDING_PAYMENT, không xác nhận từ callback sau hạn. | ACT-11 | UC-BOOK-04 | BR-BOOK-08, BR-BOOK-18 | M |
| FR-BOOK-10 | Xác nhận khi đủ cọc | Chỉ chuyển `CONFIRMED` khi `paidAmount ≥ depositAmount`, trừ `PaymentMethod = OTA_COLLECT` hoặc MANAGER+ cho phép ghi nợ theo BR-BOOK-09. | ACT-11 | UC-BOOK-01 | BR-BOOK-09 | M |
| FR-BOOK-11 | Booking nhiều phòng | Hỗ trợ `roomCount > 1` với mỗi đơn vị bán là BookingRoom và mỗi RoomAssignment là khoảng nửa mở liên tục, có thể nhiều đêm theo BR-BOOK-10. | ACT-01 | UC-BOOK-01 | BR-BOOK-10 | M |
| FR-BOOK-12 | Huỷ giải phóng phòng | Giải phóng mọi `RoomAssignment` trong cùng transaction khi huỷ booking theo BR-BOOK-11. | ACT-01..04 | UC-BOOK-08 | BR-BOOK-11 | M |
| FR-BOOK-13 | Đổi ngày lưu trú | Đổi ngày với quy tắc miễn phí/phí, tính chênh lệch giá mới, giữ nguyên trạng thái và `PriceSnapshot` cũ, ghi `AuditLog` theo BR-BOOK-12, BR-CANCEL-08. | ACT-01, ACT-03 | UC-BOOK-06 | BR-BOOK-12, BR-CANCEL-08 | M |
| FR-BOOK-14 | Cấm sửa ngày khi đã check-in | Chặn sửa ngày của booking `CHECKED_IN` theo BR-BOOK-13. | ACT-02, ACT-03, ACT-04 | UC-BOOK-05 | BR-BOOK-13 | C |
| FR-BOOK-15 | Xoá booking theo trạng thái & thanh toán | Chỉ xoá cứng `DRAFT`/`HELD` không có lần thanh toán nào kể cả PENDING/FAILED; huỷ giữ CANCELLED, chỉ tạo RefundRequest khi netRefund > 0 theo BR-BOOK-14. | ACT-02, ACT-03, ACT-04 | UC-BOOK-05 | BR-BOOK-14 | M |
| FR-BOOK-16 | Chặn khách danh sách đen | Chặn tạo booking mới cho khách trong danh sách đen, cho phép MANAGER+ override có lý do theo BR-BOOK-15. | ACT-02, ACT-03 | UC-BOOK-01 | BR-BOOK-15 | M |
| FR-BOOK-17 | Chống đặt trùng | Phát hiện đặt trùng theo kênh/số điện thoại/loại phòng/ngày nhận và trả cờ `duplicateSuspected` theo BR-BOOK-16. | ACT-01 | UC-BOOK-01 | BR-BOOK-16 | M |
| FR-BOOK-18 | Sinh mã booking | Sinh mã booking `PH-…` duy nhất toàn hệ thống theo BR-GEN-06. | ACT-11 | UC-BOOK-01 | BR-GEN-06 | M |
| FR-BOOK-19 | Huỷ & tính thang hoàn | Tính mức hoàn theo bậc thời gian của chính sách (data-driven, cấm if/else cứng) theo BR-CANCEL-01, BR-CANCEL-03, BR-CANCEL-07. | ACT-01..04 | UC-BOOK-08 | BR-CANCEL-01, BR-CANCEL-03, BR-CANCEL-07 | M |
| FR-BOOK-20 | Xoá cứng có ghi vết kiểm toán | Ghi `AuditLog` kèm `beforeJson` đầy đủ trước khi xoá cứng booking `DRAFT`/`HELD` theo BR-BOOK-17. | ACT-02, ACT-03, ACT-04 | UC-BOOK-05 | BR-BOOK-17 | M |
| FR-BOOK-21 | Huỷ một phần (nhiều phòng) | Huỷ một số `BookingRoom` của booking `roomCount > 1`, phân bổ `refundBase` theo tỷ lệ giá phòng bị huỷ, giữ giá/assignment các phòng còn lại và lưu `PriceSnapshot` điều chỉnh theo BR-CANCEL-19. | ACT-01..04 | UC-BOOK-08 | BR-CANCEL-19 | M |

---

## 7. PAY — Thanh toán & hoàn tiền

| Mã | Tên | Mô tả | Actor chính | Use case | BR áp dụng | Ưu tiên |
|----|-----|-------|-------------|----------|-----------|---------|
| FR-PAY-01 | Ghi nhận cọc & tính depositAmount | Tính cọc theo tỷ lệ gói giá và làm tròn lên bội 1.000 VND theo BR-PAY-01, BR-CANCEL-02, BR-GEN-03. | ACT-02, ACT-03, ACT-06 | UC-PAY-01 | BR-PAY-01, BR-CANCEL-02, BR-GEN-03 | M |
| FR-PAY-02 | Thanh toán trực tuyến | Tạo giao dịch qua VNPay/MoMo và không lưu dữ liệu thẻ theo BR-PAY-04. | ACT-01, ACT-08 | UC-PAY-02 | BR-PAY-04 | M |
| FR-PAY-03 | Callback idempotent | Xử lý callback cổng thanh toán idempotent theo `idempotencyKey`; khoá đã xử lý trả kết quả cũ kèm `E_PAY_CALLBACK_DUPLICATE`, không tạo `Payment` mới theo BR-PAY-03, BR-GEN-08. | ACT-08 | UC-PAY-02 | BR-PAY-03, BR-GEN-08 | M |
| FR-PAY-04 | Hết hạn giao dịch | Chuyển giao dịch không có callback quá 15 phút sang `FAILED` ; giữ hold tới hạn riêng, thành công muộn ghi thu một lần và hoàn theo BR-PAY-11 theo BR-PAY-05. | ACT-11 | UC-PAY-02 | BR-PAY-05, BR-PAY-11 | M |
| FR-PAY-05 | Thu số dư khi check-in | Tính `balanceDue` và thu trước khi giao phòng theo BR-PAY-02. | ACT-02 | UC-PAY-03 | BR-PAY-02 | M |
| FR-PAY-06 | Ghi nhận tiền mặt | Ghi `createdBy` và `paidAt` cho mọi thanh toán tiền mặt theo BR-PAY-06. | ACT-02 | UC-PAY-01 | BR-PAY-06 | M |
| FR-PAY-07 | Duyệt & chi hoàn tiền | Duyệt hoàn tiền theo phê duyệt hai cấp và chỉ chi khi `APPROVED` theo BR-CANCEL-15, BR-CANCEL-16. | ACT-04, ACT-06 | UC-PAY-04 | BR-CANCEL-15, BR-CANCEL-16 | M |
| FR-PAY-08 | Tính toán hoàn cọc | Tính hoàn dựa trên `paidAmount` (không phải tổng) và làm tròn xuống bội 1.000 VND theo BR-CANCEL-04, BR-CANCEL-05, BR-GEN-03. | ACT-06 | UC-PAY-04 | BR-CANCEL-04, BR-CANCEL-05, BR-GEN-03 | M |
| FR-PAY-09 | Phụ thu đêm đầu | Tạo `Payment` loại `PENALTY` khi bậc huỷ có phụ thu đêm đầu theo BR-CANCEL-06. | ACT-06 | UC-PAY-04 | BR-CANCEL-06 | M |
| FR-PAY-10 | Phí xử lý hoàn tiền | Áp phí xử lý hoàn (đọc từ `SystemSetting`) trừ vào tiền hoàn theo BR-CANCEL-11, BR-SYS-02. | ACT-06 | UC-PAY-04 | BR-CANCEL-11, BR-SYS-02 | C |
| FR-PAY-11 | Cam kết thời gian hoàn | Theo dõi và đảm bảo thời hạn hoàn tiền cam kết theo BR-CANCEL-12. | ACT-06 | UC-PAY-04 | BR-CANCEL-12 | C |
| FR-PAY-12 | Giới hạn tổng hoàn | Chặn tổng hoàn luỹ kế vượt `paidAmount` theo BR-CANCEL-17, BR-PAY-07. | ACT-06 | UC-PAY-04 | BR-CANCEL-17, BR-PAY-07 | M |
| FR-PAY-13 | Hoàn về phương thức gốc | Hoàn tiền về phương thức thanh toán gốc theo BR-PAY-08. | ACT-06 | UC-PAY-04 | BR-PAY-08 | M |
| FR-PAY-14 | Bút toán hoàn không sửa gốc | Ghi hoàn bằng `Payment` loại `REFUND`, không sửa/xoá `Payment` gốc theo BR-PAY-09. | ACT-06 | UC-PAY-04 | BR-PAY-09 | M |
| FR-PAY-15 | Đối soát cuối ngày | Đối soát tiền mặt theo cặp (người thu, ngày VN) và cảnh báo MANAGER khi chênh lệch theo BR-PAY-10. | ACT-06 | UC-PAY-05 | BR-PAY-10 | M |
| FR-PAY-16 | Rút / huỷ yêu cầu hoàn tiền | Chuyển `RefundRequest` `PENDING` sang `CANCELLED` khi người tạo rút yêu cầu; không khôi phục booking, chỉ người tạo/MANAGER+, cấm khi `APPROVED`/`PAID` theo BR-CANCEL-18. | ACT-01, ACT-06 | UC-PAY-04 | BR-CANCEL-18 | M |

---

## 8. CHAN — Kênh bán

| Mã | Tên | Mô tả | Actor chính | Use case | BR áp dụng | Ưu tiên |
|----|-----|-------|-------------|----------|-----------|---------|
| FR-CHAN-01 | Cấu hình kênh bán | Cấu hình kênh (hệ số, hoa hồng, hold, cho phép oversell) theo bảng kênh tại [02 §4.5](../02-nghiep-vu/quy-tac-nghiep-vu.md#45-hệ-số-kênh--hoa-hồng). | ACT-05 | UC-CHAN-01 | BR-RATE-07 | M |
| FR-CHAN-02 | Phân bổ allotment OTA mặc định | Phân bổ mặc định cho OTA dưới dạng hạn mức bán, không khoá riêng tồn khỏi kênh trực tiếp theo BR-CHAN-01. | ACT-05 | UC-CHAN-01 | BR-CHAN-01 | M |
| FR-CHAN-03 | Đồng bộ tồn/giá lên OTA | Đẩy tồn & giá lên OTA ngay khi thay đổi qua outbox, chậm nhất 5 phút theo BR-CHAN-02, BR-CHAN-06. | ACT-11 | UC-CHAN-02 | BR-CHAN-02, BR-CHAN-06 | M |
| FR-CHAN-04 | Nhận booking từ OTA | Ghi nhận booking OTA `CONFIRMED` khi `PaymentMethod = OTA_COLLECT` (kể cả hết phòng, miễn trừ `overbookLimitPct`), đặt `oversold = true` và mở `OverbookingCase` theo BR-CHAN-03. | ACT-09 | UC-CHAN-03 | BR-CHAN-03 | M |
| FR-CHAN-05 | Huỷ booking theo chính sách OTA | Ghi nhận huỷ OTA theo chính sách kênh, không áp thang BR-CANCEL theo BR-CHAN-04. | ACT-09 | UC-CHAN-03 | BR-CHAN-04 | M |
| FR-CHAN-06 | Tự đóng bán OTA khi còn ít phòng | Đóng bán loại phòng trên OTA khi tồn ≤ 2 và mở lại khi > 2 theo BR-CHAN-05. | ACT-11 | UC-CHAN-02 | BR-CHAN-05 | M |
| FR-CHAN-07 | Cảnh báo đồng bộ thất bại | Phát cảnh báo MANAGER, đánh dấu kênh `DEGRADED` và báo lỗi `E_CHAN_SYNC_FAILED` sau thất bại liên tiếp theo BR-CHAN-07. | ACT-11 | UC-CHAN-02 | BR-CHAN-07 | C |
| FR-CHAN-08 | Giới hạn bán OTA theo allotment | Bán chủ động không vượt allotment; tiếp nhận cam kết OTA đã xác nhận kể cả vượt hạn mức/đóng bán, tăng used thực tế và cảnh báo theo BR-CHAN-08. | ACT-09 | UC-CHAN-03 | BR-CHAN-08 | M |

---

## 9. OVER — Quá tải, ghép phòng & điều chuyển

| Mã | Tên | Mô tả | Actor chính | Use case | BR áp dụng | Ưu tiên |
|----|-----|-------|-------------|----------|-----------|---------|
| FR-OVER-01 | Cấu hình bán vượt có kiểm soát | Bật bán vượt chỉ khi đủ điều kiện kênh/hạn mức/trần; vượt trần báo lỗi `E_OVER_LIMIT_EXCEEDED` theo BR-OVER-01, BR-OVER-02. | ACT-05 | UC-CHAN-01 | BR-OVER-01, BR-OVER-02 | S |
| FR-OVER-02 | Đánh dấu oversold & mở case | Đánh dấu `oversold` và tự mở `OverbookingCase` cho booking tạo khi hết phòng vật lý theo BR-OVER-03. | ACT-11 | UC-CHAN-03 | BR-OVER-03 | M |
| FR-OVER-03 | Xử lý case trước T−24h & leo thang | Buộc xử lý `OverbookingCase` trước T−24h, quá hạn leo thang cho OWNER theo BR-OVER-04. | ACT-11, ACT-04 | UC-OVER-01 | BR-OVER-04 | M |
| FR-OVER-04 | Job quét quá tải định kỳ | Quét quá tải mỗi giờ cho 30 ngày tới và gộp trùng theo `(propertyId, date, roomTypeId)` theo BR-OVER-05. | ACT-11 | UC-OVER-01 | BR-OVER-05 | M |
| FR-OVER-05 | Đổi phòng cùng loại (bậc 1) | Điều chuyển khách sang phòng cùng loại cùng cơ sở, giữ giá gốc theo BR-OVER-06. | ACT-02, ACT-04 | UC-OVER-02 | BR-OVER-06 | M |
| FR-OVER-06 | Nâng hạng (bậc 2) | Nâng hạng miễn phí khi còn phòng hạng cao hơn đủ sức chứa, giữ giá gốc theo BR-OVER-06. | ACT-02, ACT-04 | UC-OVER-02 | BR-OVER-06 | M |
| FR-OVER-07 | Điều chuyển khác cơ sở (bậc 3) | Điều chuyển sang cơ sở khác trong bán kính cho phép với hỗ trợ đưa đón và khách đồng ý văn bản theo BR-OVER-07; bậc này không khả dụng vận hành với 3 cơ sở hiện tại, thang thực tế là 1 → 2 → 4. | ACT-04 | UC-OVER-02 | BR-OVER-07 | C |
| FR-OVER-08 | Walk-out & bồi thường | Thực hiện walk-out với hoàn + bồi thường đêm đầu theo BR-CANCEL-14, BR-OVER-06. | ACT-04 | UC-OVER-04 | BR-CANCEL-14, BR-OVER-06 | M |
| FR-OVER-09 | Giữ giá gốc cho mọi điều chuyển | Đặt `priceLocked = true` cho mọi `RoomMove` theo BR-OVER-08. | ACT-04 | UC-OVER-02 | BR-OVER-08 | M |
| FR-OVER-10 | Cấm điều chuyển khách đã check-in | Chặn điều chuyển booking `CHECKED_IN` trừ bất khả kháng có MANAGER+ duyệt theo BR-OVER-09. | ACT-04 | UC-OVER-02 | BR-OVER-09 | C |
| FR-OVER-11 | Ghi nhận & thông báo điều chuyển | Ghi `RoomMove`, `AuditLog` và thông báo khách trong 15 phút theo BR-OVER-10. | ACT-11 | UC-OVER-02 | BR-OVER-10 | M |
| FR-OVER-12 | Ưu tiên giữ phòng theo keepScore | Sắp xếp khách bị điều chuyển theo `keepScore`/`createdAt`/`Booking.seq` tất định theo BR-OVER-11, BR-OVER-12. | ACT-04 | UC-OVER-02 | BR-OVER-11, BR-OVER-12 | S |
| FR-OVER-13 | Ghép phòng chia sẻ (MERGE_SHARE) | Ghép hai booking vào cùng phòng với đồng thuận hai bên trên hệ thống và MANAGER+ duyệt (quy tắc giới tính); báo lỗi `E_OVER_MERGE_GENDER` khi khác giới chưa duyệt theo BR-OVER-13, BR-OVER-14. | ACT-02, ACT-04 | UC-OVER-03 | BR-OVER-13, BR-OVER-14 | C |
| FR-OVER-14 | Ghép phòng thông nhau (MERGE_CONNECTING) | Ghép hai phòng thông nhau thành một đơn vị bán theo BR-OVER-15. | ACT-02, ACT-04 | UC-OVER-03 | BR-OVER-15 | C |
| FR-OVER-15 | Tách phòng (SPLIT_ROOMS) | Tách booking nhiều phòng và giữ giá gốc theo BR-OVER-08, BR-OVER-15. | ACT-04 | UC-OVER-03 | BR-OVER-08, BR-OVER-15 | C |
| FR-OVER-16 | Duyệt ngoại lệ bất khả kháng | Cho phép MANAGER+ tạo ngoại lệ hoàn 100% kèm lý do/minh chứng theo BR-CANCEL-13. | ACT-04, ACT-05 | UC-OVER-05 | BR-CANCEL-13 | M |
| FR-OVER-17 | Xử lý case quá tải quá hạn ngày | Chuyển `OverbookingCase` còn `OPEN`/`PROPOSED`/`ESCALATED` sau ngày thiếu phòng sang `ESCALATED` và xử lý tại chỗ theo thang điều chuyển, giữ vết cho báo cáo theo BR-OVER-16. | ACT-11, ACT-04 | UC-OVER-01 | BR-OVER-16 | M |

---

## 10. FO — Tiền sảnh

| Mã | Tên | Mô tả | Actor chính | Use case | BR áp dụng | Ưu tiên |
|----|-----|-------|-------------|----------|-----------|---------|
| FR-FO-01 | Check-in khách | Kiểm tra điều kiện check-in (trạng thái, công nợ, ngày nhận) và từ chối sau 23:59 theo BR-FO-01, BR-FO-02. | ACT-02 | UC-FO-01 | BR-FO-01, BR-FO-02 | M |
| FR-FO-02 | Check-out & thu phát sinh | Chốt `balanceDue` về 0 trước khi in hoá đơn và giải phóng phòng theo BR-FO-05. | ACT-02 | UC-FO-02 | BR-FO-05 | M |
| FR-FO-03 | Phụ thu check-out muộn | Tính phụ thu check-out muộn theo mốc thời gian theo BR-FO-03. | ACT-02 | UC-FO-02 | BR-FO-03 | C |
| FR-FO-04 | Phụ thu check-in sớm | Tính phụ thu check-in sớm theo mốc thời gian theo BR-FO-04. | ACT-02 | UC-FO-01 | BR-FO-04 | C |
| FR-FO-05 | Cập nhật trạng thái buồng phòng | Tạo `HousekeepingTask` sau check-out và nhả tồn theo ngày ngay khi giải phóng assignment; task dọn chỉ chặn giao phòng tại thời điểm check-in theo BR-FO-06, BR-FO-07. | ACT-07, ACT-02 | UC-FO-03 | BR-FO-06, BR-FO-07 | M |
| FR-FO-06 | No-show tự động | Tự đánh dấu no-show lúc 23:59 ngày nhận và áp bậc cuối của chính sách theo BR-CANCEL-10. | ACT-02, ACT-11 | UC-FO-04 | BR-CANCEL-10 | M |
| FR-FO-07 | Trả phòng sớm | Hoàn theo quy tắc trả phòng sớm của từng gói giá theo BR-CANCEL-09. | ACT-02 | UC-FO-02 | BR-CANCEL-09 | C |
| FR-FO-08 | Ghi nợ khi check-in | Cho phép MANAGER+ ghi nợ `balanceDue` có lý do khi check-in theo BR-FO-01. | ACT-02 | UC-FO-01 | BR-FO-01 | C |

---

## 11. CRM — Khách hàng

| Mã | Tên | Mô tả | Actor chính | Use case | BR áp dụng | Ưu tiên |
|----|-----|-------|-------------|----------|-----------|---------|
| FR-CRM-01 | Quản lý hồ sơ khách | Nhận diện khách duy nhất theo số điện thoại chuẩn hoá theo BR-CRM-01. | ACT-02, ACT-03 | UC-CRM-01 | BR-CRM-01 | M |
| FR-CRM-02 | Phân hạng khách hàng | Phân hạng theo số đêm tích luỹ 12 tháng theo BR-CRM-02. | ACT-11, ACT-06 | UC-CRM-02 | BR-CRM-02 | M |
| FR-CRM-03 | Tích điểm sau check-out | Cộng điểm thưởng theo giá trị booking hoàn tất, ghi nhận sau check-out theo BR-CRM-03. | ACT-11 | UC-CRM-02 | BR-CRM-03 | S |
| FR-CRM-04 | Quản lý danh sách đen | Chặn tạo booking cho khách blacklist, MANAGER+ override có lý do theo BR-CRM-04. | ACT-04, ACT-05 | UC-CRM-03 | BR-CRM-04 | M |
| FR-CRM-05 | Ẩn danh hoá hồ sơ | Không xoá cứng hồ sơ, chỉ ẩn danh hoá khi khách yêu cầu theo BR-CRM-05. | ACT-02, ACT-03 | UC-CRM-01 | BR-CRM-05 | C |
| FR-CRM-06 | Không cộng điểm cho huỷ/no-show | Không cộng điểm cho booking huỷ/no-show, vẫn tính đêm thực ở vào hạng theo BR-CRM-06. | ACT-11 | UC-CRM-02 | BR-CRM-06 | C |

---

## 12. NOTI — Thông báo

| Mã | Tên | Mô tả | Actor chính | Use case | BR áp dụng | Ưu tiên |
|----|-----|-------|-------------|----------|-----------|---------|
| FR-NOTI-01 | Gửi xác nhận & nhắc hẹn | Gửi thông báo xác nhận đặt phòng và nhắc hẹn qua các kênh theo BR-SYS-06. | ACT-11 | UC-NOTI-01 | BR-SYS-06 | M |
| FR-NOTI-02 | Thông báo huỷ/hoàn/đổi phòng | Gửi thông báo thay đổi, huỷ, hoàn tiền và điều chuyển cho khách theo BR-SYS-06, BR-OVER-10. | ACT-11 | UC-NOTI-02 | BR-SYS-06, BR-OVER-10 | M |
| FR-NOTI-03 | Ghi nhận & retry thông báo | Ghi `Notification` kèm trạng thái và retry tối đa theo BR-SYS-06. | ACT-11 | UC-NOTI-02 | BR-SYS-06 | C |
| FR-NOTI-04 | Mẫu & hàng đợi đa kênh | Quản lý mẫu thông báo và hàng đợi email/SMS/Zalo OA. | ACT-11 | UC-NOTI-01 | BR-SYS-06 | M |

---

## 13. REP — Báo cáo

| Mã | Tên | Mô tả | Actor chính | Use case | BR áp dụng | Ưu tiên |
|----|-----|-------|-------------|----------|-----------|---------|
| FR-REP-01 | Báo cáo công suất, ADR, RevPAR | Báo cáo công suất, ADR và RevPAR theo cơ sở/khoảng thời gian theo định nghĩa BR-REP-01 và doanh thu thuần BR-RATE-08. | ACT-05, ACT-04 | UC-REP-01 | BR-REP-01, BR-RATE-08 | S |
| FR-REP-02 | Báo cáo doanh thu theo kênh | Báo cáo doanh thu theo kênh gồm cả gộp và thuần sau hoa hồng theo BR-RATE-08. | ACT-05, ACT-06 | UC-REP-02 | BR-RATE-08 | M |
| FR-REP-03 | Báo cáo huỷ & hoàn cọc | Báo cáo số liệu huỷ phòng và hoàn cọc theo gói giá/kênh. | ACT-05, ACT-06 | UC-REP-03 | BR-CANCEL-17 | S |
| FR-REP-04 | Báo cáo quá tải & điều chuyển | Báo cáo các case quá tải, điều chuyển và tổng chi phí xử lý quá tải (chiết khấu ghép + bồi thường walk-out + đưa đón) theo BR-OVER-15. | ACT-04, ACT-05 | UC-REP-04 | BR-OVER-15 | S |
| FR-REP-05 | Báo cáo bất khả kháng riêng | Tách riêng báo cáo các ca bất khả kháng theo BR-CANCEL-13. | ACT-05, ACT-06 | UC-REP-03 | BR-CANCEL-13 | C |
| FR-REP-06 | Xuất dữ liệu hoa hồng OTA | Xuất dữ liệu hoa hồng OTA để đối soát theo BR-RATE-08, BR-CHAN-04. | ACT-06 | UC-REP-02 | BR-RATE-08, BR-CHAN-04 | C |
| FR-REP-07 | Chỉ số báo cáo chuẩn | Áp đúng định nghĩa chỉ số ADR, RevPAR, công suất, tỷ lệ huỷ, chi phí xử lý quá tải (DOR theo giường) theo BR-REP-01; cấm báo cáo tự định nghĩa lại. | ACT-05, ACT-06 | UC-REP-01 | BR-REP-01 | M |

---

## 14. SYS — Nền tảng

| Mã | Tên | Mô tả | Actor chính | Use case | BR áp dụng | Ưu tiên |
|----|-----|-------|-------------|----------|-----------|---------|
| FR-SYS-01 | Xem nhật ký kiểm toán | Hiển thị nhật ký kiểm toán với đủ trường tối thiểu theo BR-SYS-05. | ACT-05, ACT-12 | UC-SYS-01 | BR-SYS-05 | M |
| FR-SYS-02 | AuditLog append-only & ghi mọi thay đổi | Ép `AuditLog` append-only và ghi trong cùng transaction cho mọi thao tác ghi theo BR-SYS-01, BR-GEN-07. | ACT-12 | UC-SYS-01 | BR-SYS-01, BR-GEN-07 | M |
| FR-SYS-03 | Cấu hình tham số hệ thống | Đọc tham số nghiệp vụ từ `SystemSetting`, đổi được không cần triển khai lại theo BR-SYS-02. | ACT-12, ACT-05 | UC-SYS-02 | BR-SYS-02 | M |
| FR-SYS-04 | Sao lưu & phục hồi | Sao lưu PITR đạt RPO/RTO quy định và diễn tập phục hồi theo BR-SYS-03. | ACT-12 | UC-SYS-03 | BR-SYS-03 | C |
| FR-SYS-05 | Chính sách lưu trữ dữ liệu | Áp thời hạn lưu trữ và xử lý dữ liệu cá nhân theo BR-SYS-04. | ACT-12 | UC-SYS-02 | BR-SYS-04 | C |
| FR-SYS-06 | Tiền tệ số nguyên | Dùng `Money` số nguyên VND, cấm số thực ở mọi tầng theo BR-GEN-01. | ACT-12 | UC-SYS-02 | BR-GEN-01 | M |
| FR-SYS-07 | Thời gian UTC & múi giờ | Lưu mốc thời gian UTC và quy đổi về múi giờ nghiệp vụ khi so mốc theo BR-GEN-02, BR-GEN-05. | ACT-12 | UC-SYS-02 | BR-GEN-02, BR-GEN-05 | M |
| FR-SYS-08 | Idempotency-Key cho mọi ghi | Yêu cầu `Idempotency-Key` cho mọi ghi và trả kết quả cũ khi gửi lại trong 24 giờ theo BR-GEN-08. | ACT-12 | UC-SYS-02 | BR-GEN-08 | M |

---

## 15. Ma trận MoSCoW

Tổng **135 FR** trên **13 module**.

| Mức | Số FR | Ý nghĩa | Cơ sở xếp hạng |
|-----|-------|---------|----------------|
| M (Must) | **101** | Bắt buộc, thiếu là hệ thống không vận hành được | Ba bài toán trọng tâm BT-1/BT-2/BT-3 và các nghiệp vụ nền tảng: chống bán trùng (INV), động cơ giá (RATE), vòng đời booking & huỷ (BOOK), hoàn cọc (PAY), đồng bộ kênh (CHAN), phát hiện quá tải (OVER), check-in/out (FO), phân quyền (AUTH), kiểm toán (SYS). |
| S (Should) | **9** | Quan trọng nhưng có thể lùi sau vòng M | Các FR tăng chất lượng/độ tinh nhưng không chặn dòng chính: hệ số công suất/LOS (đã nằm trong công thức nhưng có thể cấu hình đơn giản giai đoạn đầu), báo cáo ADR/RevPAR, keepScore, tích điểm, bán vượt có kiểm soát. |
| C (Could) | **25** | Nên có nếu còn dư địa thời gian | Tiện ích phụ trợ: phụ thu trẻ em, check-in sớm/muộn, trả phòng sớm, ghép phòng, phòng thông nhau, báo cáo bất khả kháng, phí xử lý hoàn, sao lưu/lưu trữ, xác nhận lại thay đổi giá, điều chuyển khác cơ sở (bậc 3 không khả dụng vận hành). |
| W (Won't) | **0** | Loại khỏi bản phát hành này | Không có FR nào bị loại; các hạng mục ngoài phạm vi đã được loại sẵn tại [00 §3.2](../00-tong-quan.md#32-ngoài-phạm-vi) và không phát sinh FR. |

---

## 16. Tiêu chí chấp nhận cấp hệ thống

| # | Hạng mục then chốt | Tiêu chí chấp nhận | Cách đo | FR/BR liên quan |
|---|--------------------|--------------------|---------|-----------------|
| 1 | Chống bán trùng phòng | Không có bộ `(room_id, bed_no, đêm)` nào có quá 1 `RoomAssignment` hoạt động (đơn vị bán = giường hoặc phòng); CSDL tự từ chối mọi vi phạm | Kiểm thử tải 200 yêu cầu đồng thời → 0 vụ trùng; ràng buộc loại trừ 3 cột từ chối mọi trường hợp | FR-INV-03, FR-INV-04 · BR-INV-02, BR-INV-03 |
| 2 | Giá đúng 7 kênh | Giá báo trên customer web/Android, operations web/Android và quầy luôn khớp nhau trên cùng đầu vào | Kiểm thử đối chiếu API + 4 frontend cùng đầu vào; snapshot từng đêm | FR-RATE-03, FR-RATE-16 · BR-RATE-01, BR-RATE-17 |
| 3 | Huỷ/hoàn cọc đúng thang | Mức hoàn tính đúng theo bậc mốc thời gian và dựa trên `paidAmount` | 100% ca bảng quyết định tại [02/chính sách huỷ](../02-nghiep-vu/chinh-sach-huy-hoan-coc.md) §6 đạt | FR-BOOK-19, FR-PAY-08 · BR-CANCEL-01..06 |
| 4 | Giữ chỗ hết hạn | Hold hết hạn được giải phóng và trả về tồn khả dụng đúng hạn | Đo thời gian giải phóng ≤ 60 giây kể từ `holdExpiresAt` | FR-INV-05, FR-BOOK-09 · BR-INV-04, BR-BOOK-08 |
| 5 | Quá tải phát hiện trước T−24h | Mọi ca quá tải có `OverbookingCase` được ghi nhận trước T−24h | 100% ca quá tải có bản ghi `OverbookingCase` trước T−24h | FR-OVER-03, FR-OVER-04 · BR-OVER-04, BR-OVER-05 |
| 6 | Phân quyền theo cơ sở | Mọi vai trò (trừ OWNER) chỉ thấy/thao tác dữ liệu trong `propertyScope` | Kiểm thử phân quyền: tài khoản cơ sở A không truy cập được dữ liệu cơ sở B | FR-AUTH-03, FR-AUTH-04 · BR-RBAC-02, BR-RBAC-03 |

---

## 17. Truy vết BR → FR

Bổ sung trong đợt rà soát: BR-RATE-20 → FR-RATE-19 → UC-RATE-06; BR-BOOK-18 → FR-BOOK-08/09/10 → UC-BOOK-04, UC-PAY-02; BR-PAY-11 → FR-PAY-03/04/12 → UC-PAY-02/04. Không đổi mã cũ.

Bảng dưới liệt kê **BR chưa được FR nào phủ** — mục tiêu rỗng.

| Nhóm BR | Số BR | Trạng thái phủ | BR còn thiếu |
|---------|-------|----------------|--------------|
| BR-GEN (01–08) | 8 | Đã phủ | — |
| BR-PROP (01–06) | 6 | Đã phủ | — |
| BR-INV (01–07) | 7 | Đã phủ | — |
| BR-RATE (01–20) | 20 | Đã phủ | — |
| BR-BOOK (01–18) | 18 | Đã phủ | — |
| BR-CANCEL (01–19) | 19 | Đã phủ | — |
| BR-PAY (01–11) | 11 | Đã phủ | — |
| BR-CHAN (01–08) | 8 | Đã phủ | — |
| BR-OVER (01–16) | 16 | Đã phủ | — |
| BR-FO (01–07) | 7 | Đã phủ | — |
| BR-CRM (01–06) | 6 | Đã phủ | — |
| BR-RBAC (01–06) | 6 | Đã phủ | — |
| BR-SYS (01–06) | 6 | Đã phủ | — |
| BR-REP (01) | 1 | Đã phủ | — |
| **Tổng** | **139** | **139/139 phủ** | **∅ (không có)** |

Ánh xạ nhóm BR → nhóm FR phủ:

| Nhóm BR | Được phủ bởi các FR thuộc module |
|---------|----------------------------------|
| BR-GEN | SYS (01,02,05,07,08), BOOK (18), RATE (03), PAY (01,03,08) |
| BR-PROP | PROP |
| BR-INV | INV, CHAN (08) |
| BR-RATE | RATE, REP (02,06), CHAN (01) |
| BR-BOOK | BOOK, CRM (04) |
| BR-CANCEL | BOOK (13,19), PAY (01,07..12,16), FO (06,07), OVER (08,16), REP (03,05) |
| BR-PAY | PAY |
| BR-CHAN | CHAN |
| BR-OVER | OVER, PROP (04), NOTI (02), REP (04) |
| BR-FO | FO |
| BR-CRM | CRM, AUTH (07), BOOK (16) |
| BR-RBAC | AUTH |
| BR-SYS | SYS, PAY (10), NOTI (01..04) |
| BR-REP | REP |

---

### 17.1. Truy vết ngược đầy đủ BR → FR

| BR | FR phủ |
|----|--------|
| BR-GEN-01 | FR-SYS-06 |
| BR-GEN-02 | FR-SYS-07 |
| BR-GEN-03 | FR-PAY-01, FR-PAY-08, FR-RATE-03 |
| BR-GEN-04 | FR-PROP-07 |
| BR-GEN-05 | FR-SYS-07 |
| BR-GEN-06 | FR-BOOK-18 |
| BR-GEN-07 | FR-SYS-02 |
| BR-GEN-08 | FR-PAY-03, FR-SYS-08 |
| BR-PROP-01 | FR-PROP-01 |
| BR-PROP-02 | FR-PROP-01 |
| BR-PROP-03 | FR-PROP-02 |
| BR-PROP-04 | FR-PROP-02 |
| BR-PROP-05 | FR-PROP-03 |
| BR-PROP-06 | FR-PROP-05, FR-PROP-06 |
| BR-INV-01 | FR-INV-01 |
| BR-INV-02 | FR-INV-03 |
| BR-INV-03 | FR-INV-04 |
| BR-INV-04 | FR-INV-05 |
| BR-INV-05 | FR-INV-06 |
| BR-INV-06 | FR-INV-07 |
| BR-INV-07 | FR-INV-02 |
| BR-RATE-01 | FR-RATE-03, FR-RATE-04, FR-RATE-05, FR-RATE-06, FR-RATE-07, FR-RATE-08 |
| BR-RATE-02 | FR-RATE-02 |
| BR-RATE-03 | FR-RATE-01 |
| BR-RATE-04 | FR-RATE-01 |
| BR-RATE-05 | FR-RATE-04 |
| BR-RATE-06 | FR-RATE-05 |
| BR-RATE-07 | FR-CHAN-01, FR-RATE-08 |
| BR-RATE-08 | FR-RATE-09, FR-REP-01, FR-REP-02, FR-REP-06 |
| BR-RATE-09 | FR-RATE-10 |
| BR-RATE-10 | FR-RATE-11 |
| BR-RATE-11 | FR-RATE-12 |
| BR-RATE-12 | FR-RATE-12 |
| BR-RATE-13 | FR-RATE-11 |
| BR-RATE-14 | FR-RATE-13 |
| BR-RATE-15 | FR-RATE-14 |
| BR-RATE-16 | FR-RATE-15 |
| BR-RATE-17 | FR-RATE-16 |
| BR-RATE-18 | FR-RATE-17 |
| BR-RATE-19 | FR-RATE-18 |
| BR-BOOK-01 | FR-BOOK-01, FR-BOOK-02, FR-BOOK-03 |
| BR-BOOK-02 | FR-BOOK-01 |
| BR-BOOK-03 | FR-BOOK-04 |
| BR-BOOK-04 | FR-BOOK-05 |
| BR-BOOK-05 | FR-BOOK-06 |
| BR-BOOK-06 | FR-BOOK-07 |
| BR-BOOK-07 | FR-BOOK-08 |
| BR-BOOK-08 | FR-BOOK-09 |
| BR-BOOK-09 | FR-BOOK-10 |
| BR-BOOK-10 | FR-BOOK-11 |
| BR-BOOK-11 | FR-BOOK-12 |
| BR-BOOK-12 | FR-BOOK-13 |
| BR-BOOK-13 | FR-BOOK-14 |
| BR-BOOK-14 | FR-BOOK-15 |
| BR-BOOK-15 | FR-BOOK-16 |
| BR-BOOK-16 | FR-BOOK-17 |
| BR-BOOK-17 | FR-BOOK-20 |
| BR-CANCEL-01 | FR-BOOK-19 |
| BR-CANCEL-02 | FR-PAY-01 |
| BR-CANCEL-03 | FR-BOOK-19 |
| BR-CANCEL-04 | FR-PAY-08 |
| BR-CANCEL-05 | FR-PAY-08 |
| BR-CANCEL-06 | FR-PAY-09 |
| BR-CANCEL-07 | FR-BOOK-19 |
| BR-CANCEL-08 | FR-BOOK-13 |
| BR-CANCEL-09 | FR-FO-07 |
| BR-CANCEL-10 | FR-FO-06 |
| BR-CANCEL-11 | FR-PAY-10 |
| BR-CANCEL-12 | FR-PAY-11 |
| BR-CANCEL-13 | FR-OVER-16, FR-REP-05 |
| BR-CANCEL-14 | FR-OVER-08 |
| BR-CANCEL-15 | FR-PAY-07 |
| BR-CANCEL-16 | FR-PAY-07 |
| BR-CANCEL-17 | FR-PAY-12, FR-REP-03 |
| BR-CANCEL-18 | FR-PAY-16 |
| BR-CANCEL-19 | FR-BOOK-21 |
| BR-PAY-01 | FR-PAY-01 |
| BR-PAY-02 | FR-PAY-05 |
| BR-PAY-03 | FR-PAY-03 |
| BR-PAY-04 | FR-PAY-02 |
| BR-PAY-05 | FR-PAY-04 |
| BR-PAY-06 | FR-PAY-06 |
| BR-PAY-07 | FR-PAY-12 |
| BR-PAY-08 | FR-PAY-13 |
| BR-PAY-09 | FR-PAY-14 |
| BR-PAY-10 | FR-PAY-15 |
| BR-CHAN-01 | FR-CHAN-02 |
| BR-CHAN-02 | FR-CHAN-03 |
| BR-CHAN-03 | FR-CHAN-04 |
| BR-CHAN-04 | FR-CHAN-05, FR-REP-06 |
| BR-CHAN-05 | FR-CHAN-06 |
| BR-CHAN-06 | FR-CHAN-03 |
| BR-CHAN-07 | FR-CHAN-07 |
| BR-CHAN-08 | FR-CHAN-08 |
| BR-OVER-01 | FR-OVER-01 |
| BR-OVER-02 | FR-OVER-01 |
| BR-OVER-03 | FR-OVER-02 |
| BR-OVER-04 | FR-OVER-03 |
| BR-OVER-05 | FR-OVER-04 |
| BR-OVER-06 | FR-OVER-05, FR-OVER-06, FR-OVER-08 |
| BR-OVER-07 | FR-OVER-07 |
| BR-OVER-08 | FR-OVER-09, FR-OVER-15 |
| BR-OVER-09 | FR-OVER-10 |
| BR-OVER-10 | FR-NOTI-02, FR-OVER-11 |
| BR-OVER-11 | FR-OVER-12 |
| BR-OVER-12 | FR-OVER-12 |
| BR-OVER-13 | FR-OVER-13 |
| BR-OVER-14 | FR-OVER-13 |
| BR-OVER-15 | FR-OVER-14, FR-OVER-15, FR-PROP-04, FR-REP-04 |
| BR-OVER-16 | FR-OVER-17 |
| BR-FO-01 | FR-FO-01, FR-FO-08 |
| BR-FO-02 | FR-FO-01 |
| BR-FO-03 | FR-FO-03 |
| BR-FO-04 | FR-FO-04 |
| BR-FO-05 | FR-FO-02 |
| BR-FO-06 | FR-FO-05 |
| BR-FO-07 | FR-FO-05 |
| BR-CRM-01 | FR-AUTH-07, FR-CRM-01 |
| BR-CRM-02 | FR-CRM-02 |
| BR-CRM-03 | FR-CRM-03 |
| BR-CRM-04 | FR-CRM-04 |
| BR-CRM-05 | FR-CRM-05 |
| BR-CRM-06 | FR-CRM-06 |
| BR-RBAC-01 | FR-AUTH-02 |
| BR-RBAC-02 | FR-AUTH-03 |
| BR-RBAC-03 | FR-AUTH-04 |
| BR-RBAC-04 | FR-AUTH-05 |
| BR-RBAC-05 | FR-AUTH-01 |
| BR-RBAC-06 | FR-AUTH-06 |
| BR-SYS-01 | FR-SYS-02 |
| BR-SYS-02 | FR-PAY-10, FR-SYS-03 |
| BR-SYS-03 | FR-SYS-04 |
| BR-SYS-04 | FR-SYS-05 |
| BR-SYS-05 | FR-SYS-01 |
| BR-SYS-06 | FR-NOTI-01, FR-NOTI-02, FR-NOTI-03, FR-NOTI-04 |
| BR-REP-01 | FR-REP-01, FR-REP-07 |

## Tham chiếu

| BR bổ sung | FR phủ | UC |
|---|---|---|
| BR-RATE-20 | FR-RATE-19 | UC-RATE-06 |
| BR-BOOK-18 | FR-BOOK-08, FR-BOOK-09, FR-BOOK-10 | UC-BOOK-04, UC-PAY-02 |
| BR-PAY-11 | FR-PAY-03, FR-PAY-04, FR-PAY-12 | UC-PAY-02, UC-PAY-04 |

- [00 — Tổng quan dự án](../00-tong-quan.md)
- [02 — Quy tắc nghiệp vụ (nguồn chân lý)](../02-nghiep-vu/quy-tac-nghiep-vu.md)
- [02 — Chính sách huỷ & hoàn cọc](../02-nghiep-vu/chinh-sach-huy-hoan-coc.md)
- [02 — Động giá](../02-nghiep-vu/dong-gia.md)
- [01 — Mô hình Use Case](mo-hinh-use-case.md)
- [06 — Ma trận truy vết](../06-truy-vet/ma-tran-truy-vet.md)
