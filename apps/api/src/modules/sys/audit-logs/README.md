# HB-036 — Nhật ký chỉ đọc

GET `audit-logs` cho OWNER toàn chuỗi và MANAGER theo `propertyScope`; SYSADMIN
không có quyền nghiệp vụ này. Scope được áp bằng SQL trước count, cursor và limit.
Không có route ghi. Các filter kết hợp AND; khoảng thời gian `[from,to)`; cursor
UUID thuộc tập đã lọc, thứ tự `(at DESC,id DESC)` giữ microsecond của PostgreSQL.

Bằng chứng cơ sở chỉ lấy từ snapshot bất biến **do writer phía server tạo**:
`before_json`/`after_json` ở cấp đầu có `propertyId` hoặc `property_id`; riêng
`Property` dùng thêm `entity_id`. Chỉ nhận loại Property, RoomType, Room,
RoomBlock, Booking, RateCalendar, Season, Promotion. Phải có ít nhất một bằng
chứng, tất cả phải là string, cùng cơ sở và nằm trong scope. Thiếu, NULL JSON,
sai kiểu, mâu thuẫn, loại chưa hỗ trợ hoặc scope rỗng đều không hiện cho MANAGER.
Không lấy phạm vi hiện tại của actor hay join thực thể có thể đổi để cấp quyền
xem lịch sử. Writer mới phải được kiểm tra nguồn proof trước khi mở loại mới.

Giới hạn hiện tại: HousekeepingTask, ChannelAllotment và các writer cũ chưa ghi
proof trên không được ánh xạ sang MANAGER; OWNER vẫn đọc được. HB-036 không
suy diễn hoặc cập nhật lại lịch sử append-only để tạo bằng chứng thiếu.

DTO giữ 9 trường hợp đồng. `actor_id` NULL → nhãn hiển thị `SYSTEM`, `entity_id`
NULL → `GLOBAL`; đây không phải principal cấp quyền. before/after là JSON string
nullable được chiếu qua whitelist nghiệp vụ đệ quy; trường khách/bí mật bị loại,
JSON nhúng cũng bị lọc. Reason JSON che các nhãn bí mật có quote trước khi ghi/đọc.
Giữ room/date của lịch sử RoomBlock kể cả sau xoá; UUID trường ID không bị che như
số điện thoại. Free text che email, dãy số định danh và nhãn giấy tờ/token/
mật khẩu; không suy đoán được tên hay giấy tờ tuỳ ý không có nhãn. Giá trị NUMBER
đã có metadata kiểu hoặc khoá tiền chuẩn giữ chữ số phục vụ tra soát.
