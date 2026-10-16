# HB-054 — lịch giá theo loại phòng (SCR-26, UC-RATE-01)

`GET /room-types/{roomTypeId}/rate-calendar` (MANAGER/OWNER, `cache-control: no-store`) trả giá từng
ngày của khoảng **bao gồm hai đầu** (tối đa 366 ngày) kèm `source`, `seasonName`, hệ số từng bước và
cờ kẹp. Toàn bộ con số lấy từ **một** lần chạy `quotePrice` của engine HB-052 trên dữ kiện nạp từ CSDL
(`facts.ts`) — tầng API không tự tính giá và không tự chọn mùa thắng (BR-RATE-01…09).

Đầu vào engine cho lịch giá **theo loại phòng** dùng gói giá trung tính (`CALENDAR_PLAN_ID`,
`losDiscountEnabled=false`): api.md §2.4 không có tham số gói giá/kênh, nên dòng `RATE_PLAN` (priority 90)
thuộc một gói cụ thể và chỉ được phân giải ở báo giá (HB-056/HB-074). Vì vậy `source` của tuyến này là
`OVERRIDE`/`SEASON`/`BASE`; ngày không có dòng nào khớp được báo `source = BASE` với
`basePrice = RoomType.basePrice` (BR-RATE-02). `losMultiplier` luôn 1,00 vì mức giảm dài ngày phụ thuộc
**cả kỳ** lưu trú, không phải một đêm. Kênh tham chiếu là `WEB` khi lệnh không khai `channelCode`.
Hệ số công suất đọc từ snapshot **toàn cơ sở** còn tươi ≤ 5 phút (BR-RATE-01 §4.3).

`PUT` (OWNER, có `Idempotency-Key`, **không** `If-Match` — lệnh sinh bản ghi giá mới): ghi dòng
`OVERRIDE` priority 100 cho từng ngày và **xoá dòng `OVERRIDE` cũ cùng phạm vi**
`(loại phòng, ngày, channel_code)`; BR-RATE-02 chọn dòng cũ hơn khi cùng nguồn/kênh nên chỉ thêm dòng
mới thì giá mới sẽ không có hiệu lực. `priority` trong thân lệnh bị bỏ qua vì
`ck_rate_calendars_priority` buộc `OVERRIDE = 100` (đúng "priority cao nhất" của api.md §2.4) và màn
SCR-26 để mặc định 0. Giá ngoài `[minPrice, maxPrice]` → 422 `E_RATE_CONFIGURATION_INVALID` với
`BELOW_FLOOR`/`ABOVE_CEILING`; lệch **quá ±20%** so với `nightlyPrice` hiện hành của chính ngày đó
(cùng phạm vi kênh) mà thiếu `confirmOwnerOverride=true` → 422 `OWNER_CONFIRMATION_REQUIRED`
(BR-RBAC-04, TC-AUTH-09). Công thức `|mới − cũ| × 5 > cũ` trùng `isLargeChange` của SCR-26 (HB-058) nên
giao diện và máy chủ không lệch nhau; đúng biên ±20% vẫn lưu bình thường.

`warnings[]`: BR-RATE-19 (`LONGSTAY14` đang bán mà không có giá riêng ⇒ bằng giá `FLEX7`) và BR-RATE-05
(hai mùa chồng nhau cùng `priority` trong kỳ đang xem). Lệnh ghi + AuditLog (`RATE_CALENDAR_OVERRIDDEN`)

- `RateChanged` nằm trong cùng transaction (BR-SYS-01) và **không** chạm `price_snapshots` đã chốt
  (BR-RATE-16). `reason`/văn bản vận hành được che PII trước khi ghi audit.
