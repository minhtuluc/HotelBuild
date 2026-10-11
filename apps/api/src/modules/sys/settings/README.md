# HB-036 — Tham số hệ thống

GET danh sách và PUT `system-settings/:key` chỉ OWNER. GET đọc DB mới, không dùng
cache quyết định quyền; phân trang key tăng dần, cursor phải tồn tại. updated_by
NULL → nhãn `SYSTEM`; description NULL/rỗng → key, giữ DTO 7 trường đã phát hành.

PUT trả 204 và ETag version mới. Thiếu If-Match428, tag sai/cũ412, key thiếu404,
sai value_type400. NUMBER theo cú pháp thập phân hữu hạn/safe; kiểm số nguyên chính xác trước IEEE754,
không làm tròn phần lẻ cực nhỏ để vượt validation. Tiền VND và ngưỡng
đếm nguyên không âm, interval nguyên dương, phần trăm có trần theo BR hiện có.
BOOLEAN chỉ true/false; JSON phải parse được; STRING không rỗng. Body strict,
reason bắt buộc, che nhãn bí mật/PII trước khi ghi audit. Snapshot JSON tham số
được lọc trước khi lưu audit; không lưu token/password nhúng dưới trường value.

Idempotency kiểm tra quyền/kiểu trước replay. Transaction khoá setting FOR UPDATE,
sau đó user FOR SHARE, đọc lại active/OWNER/kiểu/version; trigger tăng version
đúng một lần. Giá trị + audit trước/sau/lý do + phản hồi idempotency commit cùng
transaction. Lỗi audit rollback toàn bộ. Lock timeout1s và retry có giới hạn dùng
cơ chế idempotency hiện có. ETag interceptor chạy bên trong cơ chế đó; không dùng
native Res trên route idempotent. Không sửa oracle/writer dùng chung.

Module khác import SettingsModule và inject `RUNTIME_SETTINGS` (RuntimeSettings):
`get(key): Promise<string>` trả giá trị bất biến. Cache tối đa60000ms tính từ lúc
bắt đầu đọc DB, sử dụng Clock tiêm; clock lùi thì đọc lại, key thiếu không cache.
`SettingsCommittedInterceptor` phải đứng **trước** IdempotencyInterceptor trong
APP_INTERCEPTOR, để chỉ evict sau khi transaction commit. Replay cũng chỉ evict,
không nạp giá trị phiên bản cũ. Generation chặn load đang chờ tái điền cache sau
eviction. Tiến trình khác nhận thay đổi trong ≤60s; không có broadcast toàn cụm.

Ngoài allow: AppModule để đăng ký module/interceptor; oracle registered-routes
thêm 3 route với quyền độc lập, không nới assertion; api.md ghi rõ scope/DTO/cache.
Vượt450 dòng vì ticket có hai API, transaction/version/idempotency, bộ lọc bảo mật
và cache sau commit với test PostgreSQL thật. Không thay schema/hợp đồng phát hành,
file protected, test khoá hay quy tắc nghiệp vụ.
