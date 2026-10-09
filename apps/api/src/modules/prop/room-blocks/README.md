# HB-034 — Khoá phòng và dữ kiện tồn

POST201 / DELETE204 dùng IdempotencyContext: block, case, audit, InventoryChanged
outbox và response cùng transaction. Thứ tự: claim → booking IDs tăng dần →
property → type → room. Tập assignment được đọc trước và sau khoá; thay đổi tập
booking hoặc location của room ném RetryTransaction, rollback toàn bộ và chạy
lại tối đa ba lần. Lock timeout/deadlock/serialization cũng yêu cầu retry.

FRONT_DESK/MANAGER/OWNER tạo khoá không đè assignment. Override assignment chưa
release chỉ MANAGER/OWNER, reason bắt buộc. GET cho HOUSEKEEPING/FRONT_DESK/
MANAGER/OWNER, chỉ DTO room-block và scope được phép. DELETE cho MANAGER/OWNER,
bắt buộc reason; kiểm scope trước cả replay, dùng create audit khi block đã xoá.

Schema hiện không có cột note hoặc trạng thái kết thúc. Note là projection từ
ROOM_BLOCK_CREATED.after_json, ghi cùng block, có property/type để kiểm scope.
DELETE ghi before_json đầy đủ (mọi cột của block + note) rồi xoá trong cùng TX.
Không sửa/xoá audit; gỡ block không tự đóng case (đóng cần đo lại và workflow OVER).

Case gộp theo property/date/type, giữ trạng thái ca đã có. shortageCount là giá
trị lớn hơn giữa thiếu supply thương mại và số BookingRoom có assignment hiệu
lực trên hợp các block cần điều chuyển theo BR-INV-06. Block trùng không cộng
thiếu hai lần; DOR đếm từng giường. Không thay oversold của booking đã có: BR-OVER-03
áp dụng lúc tạo booking, đây là sự cố block được ghi case và audit riêng.

loadInventoryFacts(tx, query) dùng primary, clock_timestamp sau resource locks,
không Redis, không trusted cached counters. Cấp phát thực chia đoạn theo các
boundary assignment; phần chưa gán giữ cam kết. CANCELLED/EXPIRED/NO_SHOW/DRAFT
và BookingRoom huỷ cung cấp facts inactive để không giữ nhầm đơn vị vật lý.
Caller ghi dữ liệu phải giữ giao thức khoá ADR-014; đọc nhiều truy vấn dưới READ
COMMITTED không phải snapshot nguyên tử khi caller không khoá tài nguyên.

## Giới hạn công việc và dữ liệu vận hành

Case chỉ duyệt hợp khoảng ngày có demand hiệu lực tại location đích, streaming
chunk tối đa 31 đêm; có await PostgreSQL giữa chunk để timeout TX vẫn có hiệu lực.
Block rất dài không mở rộng những năm không có demand thành hàng triệu phần tử.

Note và reason che mẫu email và chuỗi số định danh có ít nhất 9 chữ số (kể cả
label liền số và các dấu phân cách thường dùng) thành `****` + 4 ký tự cuối trước
khi lưu/trả DTO/audit. Văn bản vận hành thông thường giữ nguyên. Đây là nhận diện
theo định dạng, không thể nhận diện mọi cách cố ý làm rối/viết số bằng chữ; không
nhập thông tin khách vào ghi chú bảo trì. Request query không được ghi vào log hay
path của response lỗi; raw URL/body vẫn giữ riêng cho SHA-256 idempotency.
