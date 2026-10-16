# HB-075 — tìm phòng trống (chỉ đọc)

`GET /api/v1/inventory/availability` dùng primary PostgreSQL với loader tồn HB-034
(`modules/inv/facts`) + engine HB-032, và loader dữ kiện giá HB-056 (`modules/rate/pricing-facts`)

- engine giá HB-052 cho các trường tiền. Không định nghĩa lại luật giá ở đây (BR-RATE-17/ADR-018).

Công khai (`@Public()`), `no-store`, hạn mức cơ bản **120 lượt/phút/IP** trên Redis theo đúng giao
thức đếm của `LoginAttempts`; hạn mức chạy trước khi đọc dữ liệu. Một transaction `RepeatableRead`,
một instant `clock_timestamp()` dùng chung cả cơ sở. **Chỉ đọc**: không khoá hàng, không ghi
`AuditLog`/`Idempotency-Key` (khoá phòng chỉ ở `POST /holds` hoặc `POST /bookings` — BR-INV-02).

`availableCount` = **min trên mọi đêm riêng biệt** của `channelAvailability` (BR-INV-07; hai tầng
tồn theo BR-INV-01), tính theo **đơn vị bán** nên DOR đếm bằng giường (BR-PROP-04). Loại phòng hết
chỗ vẫn được trả về với `soldOut = true`; chỉ khi truy vấn nêu rõ `roomTypeId` mà
`availableCount < roomCount` mới trả `409 E_INV_NO_AVAILABILITY` (api.md §3.8). Không nêu
`channelCode` ⇒ kênh trực tiếp/tồn chung; kênh `INACTIVE` hoặc không tồn tại đóng bán
(`availableCount = 0`). Số khách vượt `capacityAdults × roomCount` (BR-BOOK-04): loại quá nhỏ bị bỏ
khỏi danh sách, hoặc `422 E_BOOK_OVER_CAPACITY` khi nêu rõ `roomTypeId`.

Danh sách sắp theo `code`, `id`; phân trang con trỏ `limit`/`cursor` (khoá `(code, id)` mã hoá
base64url, không phải hợp đồng). Cơ sở lạ, loại phòng không thuộc cơ sở, hoặc cơ sở chưa có loại
phòng đều trả `404 E_GEN_NOT_FOUND` như lưới tồn.
