# HB-242 — bảng điều khiển ngày (SCR-23, TD-09)

`GET /operations/day-board?propertyId=…&date=YYYY-MM-DD` (FRONT_DESK, MANAGER, OWNER; phạm vi cơ sở) trả
một ảnh chụp `RepeatableRead` cho một cơ sở × một ngày nghiệp vụ VN. Vắng `date` ⇒ hôm nay theo giờ VN của
**đồng hồ CSDL** (cùng nguồn với luật nghiệp vụ, không dùng giờ máy ứng dụng).

| Nhóm               | Định nghĩa                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------- |
| `arrivals`         | `check_in = date`, `CONFIRMED` (chưa nhận) hoặc `CHECKED_IN` (đã nhận)                                    |
| `departures`       | `check_out = date`, `CHECKED_IN` (chưa trả) hoặc `CHECKED_OUT` (đã trả)                                   |
| `inHouse`          | ở qua đêm `date`: `check_in ≤ date < check_out`, `CONFIRMED` hoặc `CHECKED_IN`                            |
| `overbooking`      | số ca `OPEN`/`PROPOSED`/`ESCALATED` của cơ sở từ `date` trở đi (`openFromDate`) và đúng `date` (`onDate`) |
| `degradedChannels` | kênh `ACTIVE` có `sync_status = DEGRADED` (kênh là cấu hình toàn chuỗi)                                   |

Mỗi nhóm booking có `total` đếm thật, `items` tối đa 200 dòng theo mã booking, cờ `truncated`. Dòng chỉ
mang dữ liệu để lễ tân hành động (mã, tên khách, loại phòng, số phòng, ngày, trạng thái, kênh,
`balanceDue` từ sổ cái); **không** có SĐT hay số giấy tờ (UI-14). HOUSEKEEPING không được cấp quyền vì
bảng có tên khách và số dư; buồng phòng dùng màn nhiệm vụ riêng.
