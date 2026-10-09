# HB-057 — gói giá và policy cấu hình

`GET /rate-plans` là public projection, chỉ ACTIVE plan/policy, lọc cơ sở ACTIVE
nếu có và min/max của toàn kỳ. Không phải availability hay quote. Hai ngày phải
cùng được cung cấp, ngày thật, checkOut > checkIn; không tự áp 31 ngày của grid.

OWNER đọc `/rate-plans/admin` và `/cancellation-policies`, cập nhật hai PUT đã có
trong hợp đồng. Global config không đòi property-scope; mọi vai trò khác bị từ chối.
Danh sách UUID cursor tăng dần, limit mặc định50, tối đa100. Trả version theo từng
item; If-Match phải là một số nguyên trong dấu nháy kép (`"7"`), không wildcard/weak.

HB029 sở hữu transaction: claim → kiểm quyền/tài nguyên trước replay → lock cấu
hình → kiểm version → cập nhật + audit + RateChanged outbox + response. DB trigger
tăng version đúng một lần. RatePlan giữ row lock, khóa cả policy cũ và mới theo UUID
tăng dần rồi mới đọc before/after; policy writer chỉ lock policy. Các reader dùng
primary RepeatableRead, không đọc tier từ hai phiên bản.

Policy PUT thay toàn danh sách bậc, đầy đủ old IDs/canonical data nằm trong audit.
Legacy `hoursBeforeCheckIn=0` là catch-all DB/engine `offsetHours=-1`. Optional
`offsetHours` biểu diễn canonical; nếu gửi cả hai thì legacy phải bằng
`max(0,offsetHours)`. Optional `chargeFirstNight` bị bỏ qua bởi client cũ sẽ giữ cờ
của tier cũ cùng offset, hoặc false cho offset mới. Muốn bỏ cờ thì gửi false rõ ràng.
Output có cả hai trường mới để client mới round-trip không mất thông tin. Thiếu
catch-all/trùng mốc/tỷ lệ sai trả422 E_RATE_CONFIGURATION_INVALID với details dòng.
Tỷ lệ hoàn và cờ được kiểm cùng hàm `resolveTier` của engine HB053.
Mốc tier không vượt int32 của PostgreSQL. `earlyCheckoutFreeHours=0` trên wire
là sentinel cho DB `null`, chỉ đi cùng refund0; giờ dương lưu nguyên giá trị.

Không ghi PriceSnapshot, không xoá quote còn hiệu lực. Event `RateChanged` dùng
schemaVersion1, entityType/entityId/version, là điểm nối cho cache ngữ cảnh quote
mới; chưa có relay/consumer HB130 thì event vẫn bền trong PostgreSQL. Huỷ booking
cũ phải đọc snapshot đã chốt, tuyệt đối không đọc lại policy live từ module này.

Reason/label mask định dạng phone/ID/email nhận biết được trước DTO/audit; raw
request không bị sửa để idempotency hash vẫn phân biệt các payload khác nhau.
Không log raw Prisma error/config values. Không thêm schema/revision/route tạo-xoá.
