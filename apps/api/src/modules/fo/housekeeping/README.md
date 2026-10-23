# HB-148 — buồng phòng

API thật `GET /api/v1/housekeeping/tasks` và `PATCH /api/v1/housekeeping/tasks/:taskId`.
Không triển khai checkout/check-in hay tạo task: HB-145 tạo sau checkout, HB-144 dùng readiness.

- DTO đúng các trường hợp đồng nhiệm vụ; không join booking/guest/payment. Query luôn có scope
  và với HOUSEKEEPING luôn có assignedTo=actor, không bị query caller ghi đè. Ngày lịch thật,
  UUID, limit1–100 và cursor thuộc tập đã lọc được kiểm; count/page cùng RepeatableRead.
- BR-FO-07 là nguồn chân lý: HOUSEKEEPING dọn PENDING→IN_PROGRESS→DONE; FRONT_DESK/MANAGER
  DONE→INSPECTED hoặc DONE/INSPECTED→PENDING. Đây là quyết định theo AGENTS§4 thay AC3 ticket
  đang nói FRONT_DESK chỉ đọc. Quyền phân công theo BR-RBAC03 và API§6.3 cũ (FRONT_DESK/MANAGER),
  cao hơn ticket/hợp đồng MANAGER/OWNER. Giữ nguyên ticket/BR, đồng bộ docs04 và comment hợp đồng.
- FRONT_DESK/MANAGER phân công; người nhận phải active HOUSEKEEPING scoped cùng cơ sở. OWNER không
  kế thừa quyền đọc/phân công/dọn/kiểm tra. OWNER/ACCOUNTANT/RESERVATION_AGENT/SYSADMIN bị từ chối.
- PATCH cần If-Match phiên bản nguyên dương và key UUIDv4. Khoá Room→Task rồi kiểm lại scope,
  assignment, role/active của actor và version. User/scope người nhận cũng được khoá khi phân công.
  Trigger hiện có tăng version; không tự tăng lần hai. Audit cùng TX lệnh và idempotency cache.
- GET no-store; PATCH trả ETag mới, replay cùng bytes/ETag sau khi kiểm quyền/scope/assignment lại.
  Thu hồi scope/đổi role/assignment trong lúc chờ Room được phát hiện trước ghi. Retry lock có giới hạn.
- completedAt đặt khi DONE bằng Clock, giữ lúc INSPECTED, xoá khi PENDING. Không sửa Room.status,
  assignment, channel allotment, booking hay outbox; vệ sinh không giảm/tăng tồn ngày BR-FO-06.
- Free text che email và chuỗi số định danh cả dữ liệu cũ trong projection và lúc lưu/audit mới.
  Nhãn Passport/idNumber/CCCD/CMND/hộ chiếu được che bảo thủ đến dấu phân cách, kể cả giấy tờ
  có chữ/khoảng trắng. Đây không phải bộ nhận diện mọi PII trong văn bản: không suy được tên hay
  giấy tờ tuỳ ý không có nhãn. Không nhập hồ sơ khách vào ghi chú dọn phòng. Ghi chú DB cũ chỉ hiển thị 500 ký tự.

HB-144 phải giữ cùng Room lock khi kiểm readiness và ghi giao phòng. HB-148 kiểm chứng khoá
Room thật nhưng chưa nghiệm thu race end-to-end với endpoint check-in chưa tồn tại.
Test `apps/api/test/uc-buong-phong/` dùng HTTP + PG16 + Redis7 thật, không mock/skip.

## HB-207: `POST /housekeeping/tasks` (ghi nhận kiểm phòng)

FRONT_DESK/MANAGER tạo nhiệm vụ `PENDING` hoặc biên bản `INSPECTED` (kèm `reason`) cho phòng chưa có bằng chứng sẵn sàng của lượt giải phóng (BR-FO-07, F7-QA-01). `INSPECTED` đóng dấu `completed_at` theo đồng hồ máy chủ. Khoá phòng `FOR UPDATE` trước như PATCH/check-in (ADR-014); ràng buộc duy nhất `(room_id, business_date)` + `createMany(skipDuplicates)` ⇒ hai lệnh đồng thời chỉ một lệnh ghi được, lệnh kia 409. **Đã có nhiệm vụ ở bất kỳ trạng thái nào ⇒ 409** `E_FO_TASK_TRANSITION_NOT_ALLOWED` (mở lại/kiểm tra nhiệm vụ cũ đi qua PATCH); phòng không `ACTIVE` ⇒ cùng mã. Audit `HOUSEKEEPING_TASK_CREATED` (before = null) cùng giao dịch; `note`/`reason` che số giấy tờ/điện thoại trước khi lưu.
