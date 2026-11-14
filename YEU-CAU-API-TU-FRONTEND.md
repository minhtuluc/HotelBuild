# Yêu cầu API bổ sung từ Frontend gửi Session Backend

Tài liệu này ghi nhận các thay đổi/bổ sung hợp đồng API hoặc endpoint phía `apps/api` và `packages/contracts` mà phiên Frontend cần để khép kín các nợ kỹ thuật còn tồn đọng ngoài ranh giới Frontend.

> **Ranh giới áp dụng:** Phiên Frontend **không** tự sửa `apps/api`, `apps/worker`, `packages/contracts`, `packages/domain`, hay `infra`. Mọi mục dưới đây đang tạm xử lý an toàn hoặc giữ hành vi fallback trên giao diện cho tới khi Backend công bố hợp đồng mới.

---

## 1. `TD-09` — Trả `propertyScope` trong phản hồi đăng nhập / làm mới phiên

- **Màn hình / gói liên quan:** `SCR-14` (`apps/operations-web`), `SCR-56` (`apps/operations-android`), `packages/web-session`
- **Vấn đề hiện tại:** `POST /api/v1/auth/login` và `POST /api/v1/auth/refresh` chưa trả danh sách `propertyScope` ngay trong payload phiên nên client phải gọi phụ `GET /api/v1/auth/me` hoặc giữ trạng thái chờ trước khi dựng phạm vi cơ sở.
- **Đề xuất cho Backend:**
  - Bổ sung trường `propertyScope: string[]` (tối thiểu danh sách ID cơ sở nhân viên được gán) vào DTO trả về của `POST /api/v1/auth/login` và `POST /api/v1/auth/refresh`.
- **Trạng thái tạm trên Frontend:** Giữ luồng gọi `/api/v1/auth/me` sau đăng nhập theo `HB-020`.

---

## 2. `TD-06` & `TD-08` — Bổ sung `bookingCode` trong `OverbookingCaseSummaryDto` và tạo/gắn `caseId` khi đánh dấu trùng OTA

- **Màn hình liên quan:** `SCR-42` (Hàng đợi OTA), `SCR-43` (Bảng quá tải), `SCR-44` (Điều chuyển), `SCR-45` (Ghép phòng)
- **Vấn đề hiện tại:**
  1. `OverbookingCaseSummaryDto` chỉ trả `bookingId` (UUID) mà thiếu `bookingCode` thân thiện (dạng `PH-YYMM-nnnnn`), làm màn hình điều hành phải tra cứu phụ hoặc hiển thị UUID.
  2. Khi điều phối viên đánh dấu trùng booking OTA (`PATCH .../duplicate-flag`), phản hồi chưa tự tạo hoặc trả về `caseId` tương ứng để điều hướng thẳng sang màn điều chuyển/ghép phòng.
- **Đề xuất cho Backend:**
  - Thêm `bookingCode?: string` vào `OverbookingCaseSummaryDto` (`GET /api/v1/overbooking-cases`).
  - Trong `PATCH /api/v1/channels/{channelId}/ota-bookings/{bookingId}/duplicate-flag`, trả kèm `overbookingCaseId?: string` nếu hệ thống tạo/gắn ca quá tải tương ứng.
- **Trạng thái tạm trên Frontend:** Hiển thị rõ `bookingId` rút gọn khi chưa có `bookingCode` và thông báo điều hướng thủ công sang `/overbooking/cases` sau khi đánh dấu trùng.

---

## 3. `TD-34` & `TD-37` — Giải phóng giữ chỗ chủ động (`Release Hold`) từ giao diện khách

- **Màn hình liên quan:** `SCR-07` (`apps/customer-web`), `SCR-78` (`apps/customer-android`)
- **Vấn đề hiện tại:** Khách đang ở trạng thái giữ chỗ 10 phút (`HELD`) khi đổi ý muốn thoát hoặc đặt phòng khác hiện chỉ có cách chờ worker hết hạn giữ chỗ tự động thay vì giải phóng tồn ngay lập tức.
- **Đề xuất cho Backend:**
  - Mở endpoint `POST /api/v1/holds/{holdId}/release` (hoặc cho phép `POST /api/v1/bookings/{id}/cancel` với trạng thái `HELD` từ phiên khách sở hữu booking đó) có `Idempotency-Key` bắt buộc.
- **Trạng thái tạm trên Frontend:** Hiển thị bộ đếm ngược đến `holdExpiresAt` do máy chủ trả và hướng dẫn khách đặt lại hoặc liên hệ quầy nếu cần huỷ giữ chỗ sớm.

---

## 4. `TD-51` — Lọc đa trạng thái trong một lần gọi ở `GET /api/v1/bookings`

- **Màn hình liên quan:** `SCR-62` (Tra cứu booking & khách trên `apps/operations-android`), `SCR-31` (`apps/operations-web`)
- **Vấn đề hiện tại:** `GET /api/v1/bookings` hiện chỉ nhận đơn giá trị `status`, khiến màn tra cứu nhanh tiền sảnh muốn hiển thị đồng thời khách sắp đến (`CONFIRMED`) và khách đang lưu trú (`CHECKED_IN`) phải gọi 2 request song song và tự gộp trên client.
- **Đề xuất cho Backend:**
  - Hỗ trợ `status` dạng danh sách phân tách dấu phẩy hoặc mảng (`?status=CONFIRMED,CHECKED_IN`) trong `GET /api/v1/bookings`.
- **Trạng thái tạm trên Frontend:** Giữ nguyên cơ chế gọi an toàn hiện tại trên `operations-android` (`lookup`).

---

## 5. Ảnh cơ sở và ảnh loại phòng trong hợp đồng công khai

- **Màn hình liên quan:** `SCR-01` (trang chủ khách), `SCR-02` (kết quả tìm phòng), `SCR-03` (chi tiết phòng) trên `apps/customer-web`; các màn tương ứng trên `apps/customer-android`
- **Vấn đề hiện tại:** `PropertyPublicSummary`, `Availability` và `Quote` không có trường ảnh. Frontend tạm dùng ảnh tĩnh đặt theo mã ô trong `apps/customer-web/public/images/pine-hill/` (xem [docs/04-thiet-ke/anh-trang-khach.md](docs/04-thiet-ke/anh-trang-khach.md)); cách này không phân biệt được cùng một hạng phòng ở hai cơ sở, và màn chi tiết phòng (chỉ biết `roomTypeId`) không gắn được ảnh.
- **Đề xuất cho Backend:**
  - Thêm `photos?: { url: string; alt: string; width: number; height: number }[]` (không phá vỡ) vào `PropertyPublicSummary` và vào mục loại phòng trong `Availability`.
  - Thêm `GET /api/v1/public/room-types/{roomTypeId}` (hoặc trường `roomType` trong `Quote`) trả `code`, `name`, `capacityAdults`, `photos[]` để màn chi tiết phòng hiện bộ ảnh.
- **Trạng thái tạm trên Frontend:** Ảnh tĩnh theo mã ô; áp phích ga quay về tranh SVG minh hoạ khi chưa có ảnh.

---

## 6. `TD-82` — Slug cơ sở trong `GET /api/v1/public/properties`

- **Màn hình liên quan:** trang ga `/stays/[slug]` (HB-310), khối tìm phòng `SCR-01` khi đến từ trang ga (`/?ga=<slug>`)
- **Vấn đề hiện tại:** `PropertyPublicSummary` chỉ có `id`, `name`, giờ nhận/trả. Frontend khớp cơ sở với trang ga bằng chuỗi có trong tên (`apiNameIncludes`, ví dụ "Đà Lạt"). Đổi tên cơ sở ở back-office thì trang ga mất giờ nhận/trả và CTA không chọn sẵn ga.
- **Đề xuất cho Backend:**
  - Thêm `slug: string` (không phá vỡ; duy nhất; chữ thường không dấu, ví dụ `da-lat`) vào `propertyPublicSummarySchema` và seed.
- **Trạng thái tạm trên Frontend:** khớp theo tên; không khớp thì in "--:--" kèm lời dẫn sang bước tìm phòng. Cần có trước HB-311 (nhân trang ga).

---

## 7. Mốc huỷ tuyệt đối trong báo giá và booking

- **Màn hình liên quan:** `SCR-03` (báo giá), `SCR-05`/`SCR-07` (giữ chỗ, kết quả), `SCR-11` (huỷ); góp ý FEAT-04 trong [báo cáo góp ý UI/UX](docs/04-thiet-ke/bao-cao-gop-y-cai-tien-ui-ux-va-noi-dung-customer-web.md)
- **Vấn đề hiện tại:** chính sách huỷ trả các bậc theo **số giờ trước giờ nhận phòng**. Khách hay hiểu nhầm "7 ngày trước" là theo ngày lịch. Quy ra mốc ngày giờ cụ thể ở frontend là tự áp chính sách huỷ (AGENTS.md cấm).
- **Đề xuất cho Backend:**
  - Thêm vào snapshot chính sách của `Quote` và `BookingSummary` mảng `refundDeadlines: { until: string; refundPercent: number; firstNightCharge: boolean }[]` (không phá vỡ; `until` là ISO UTC), tính từ giờ nhận phòng của cơ sở.
- **Trạng thái tạm trên Frontend:** chỉ hiện các bậc theo giờ như hiện tại; không tự quy đổi.
