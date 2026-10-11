# HB-148 — buồng phòng

API thật `GET /api/v1/housekeeping/tasks` và `PATCH /api/v1/housekeeping/tasks/:taskId`.
Không triển khai checkout/check-in hay tạo task: HB-145 tạo sau checkout, HB-144 dùng readiness.

- DTO đúng các trường hợp đồng nhiệm vụ; không join booking/guest/payment. Query luôn có scope
  và với HOUSEKEEPING luôn có assignedTo=actor, không bị query caller ghi đè. Ngày lịch thật,
  UUID, limit1–100 và cursor thuộc tập đã lọc được kiểm; count/page cùng RepeatableRead.
- BR-FO-07 là nguồn chân lý: HOUSEKEEPING dọn PENDING→IN_PROGRESS→DONE; FRONT_DESK/MANAGER
  DONE→INSPECTED hoặc DONE/INSPECTED→PENDING. Đây là quyết định theo AGENTS§4 thay AC3 ticket
  đang nói FRONT_DESK chỉ đọc. Giữ nguyên ticket/BR, đồng bộ docs04.
- MANAGER/OWNER phân công; người nhận phải active HOUSEKEEPING scoped cùng cơ sở. OWNER không
  kế thừa dọn/kiểm tra. Ba role ACCOUNTANT/RESERVATION_AGENT/SYSADMIN bị từ chối.
- PATCH cần If-Match phiên bản nguyên dương và key UUIDv4. Khoá Room→Task rồi kiểm lại scope,
  assignment, role/active của actor và version. User/scope người nhận cũng được khoá khi phân công.
  Trigger hiện có tăng version; không tự tăng lần hai. Audit cùng TX lệnh và idempotency cache.
- GET no-store; PATCH trả ETag mới, replay cùng bytes/ETag sau khi kiểm quyền/scope/assignment lại.
  Thu hồi scope/đổi role/assignment trong lúc chờ Room được phát hiện trước ghi. Retry lock có giới hạn.
- completedAt đặt khi DONE bằng Clock, giữ lúc INSPECTED, xoá khi PENDING. Không sửa Room.status,
  assignment, channel allotment, booking hay outbox; vệ sinh không giảm/tăng tồn ngày BR-FO-06.
- Free text che email và chuỗi số định danh cả dữ liệu cũ trong projection và lúc lưu/audit mới.
  Không suy danh tính khách từ task. Ghi chú quá 500 ký tự trên DB cũ chỉ hiển thị 500 ký tự.

HB-144 phải giữ cùng Room lock khi kiểm readiness và ghi giao phòng. HB-148 kiểm chứng khoá
Room thật nhưng chưa nghiệm thu race end-to-end với endpoint check-in chưa tồn tại.
Test `apps/api/test/uc-buong-phong/` dùng HTTP + PG16 + Redis7 thật, không mock/skip.
