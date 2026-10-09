# HB-029 — Lệnh JSON có idempotency

`IdempotencyModule` được nhập toàn cục; interceptor chỉ chạy trên method gắn
`@Idempotent(AccessProvider)`. Provider phải được đăng ký trong Nest và có
`authorize(context): Promise<Principal>`.

## Hợp đồng tích hợp bắt buộc

1. Giữ `@Permission(...)`/cơ chế xác thực của route. `AccessProvider` kiểm tra lại
   tài nguyên tồn tại, quyền và phạm vi đối tượng **trước mọi claim hoặc replay**.
   Với nhân viên, lấy principal `USER` từ `AuthorizedActor` của server. Guest phải
   kiểm tra phiên và quyền sở hữu booking, trả 404 khi cần che tài nguyên. Principal
   `SYSTEM`/`ANONYMOUS` cũng do server xác định; không lấy ID/quyền từ body/header
   do client tự khai.
2. Handler và tất cả service ghi dữ liệu lấy **cùng** `Prisma.TransactionClient`
   từ `IdempotencyContext.transaction()`. Truyền client đó cho `AuditWriter`,
   outbox và mọi câu lệnh nghiệp vụ. Ghi qua PrismaClient riêng sẽ phá tính nguyên
   tử. Gọi `.transaction()` ngoài lệnh đang chạy sẽ ném lỗi.
3. Trả JSON thông thường với status 2xx; có thể dùng `@HttpCode`/`@Header`.
   `@Res`, SSE, render và redirect bị chặn lúc bootstrap. Không gửi response trực
   tiếp qua Fastify, mở transaction riêng, tạo công việc nền hoặc gọi PSP/network
   trong transaction. Công việc ngoài DB đi qua outbox; PSP dùng mã nhà cung cấp
   bền theo BR-PAY-03.
4. Kiểm tra version/trạng thái nghiệp vụ trong handler. Replay cùng body và
   `If-Match` cũ trả bản đã commit trước khi chạy các kiểm tra này. Vẫn giữ ràng
   buộc UNIQUE nghiệp vụ: TTL idempotency không thay thế chống trùng dài hạn.
5. Không áp generic middleware này cho response chứa mật khẩu/access/refresh/PIN
   token hoặc cookie xác thực. Bộ chuẩn hoá từ chối các trường credential đã biết
   và `Set-Cookie`/`Authorization`, khiến toàn bộ transaction rollback. Response
   được sao chép/serialize trước commit. Chỉ lưu Location, ETag, Content-Type và
   Cache-Control; trace của request mới được tạo riêng. Header được kiểm tra theo
   quy tắc Node HTTP trước commit; chỉ chấp nhận media type JSON, từ chối tự đặt
   Content-Length/Content-Encoding/Transfer-Encoding/Trailer. JSON string scalar
   được quote khi gửi ở cả lần đầu và replay. Khi rollback, bỏ header của handler
   trước khi filter ghi lỗi JSON để header hỏng không phá tiếp response lỗi.
   Replay cũng kiểm tra header hiện tại sau khi ghép với header đã lưu, kể cả khi
   cấu hình middleware thay đổi giữa hai request.

Ví dụ phần ghi trong service:

```ts
const tx = this.idempotencyContext.transaction();
await tx.bookings.update(/* dữ liệu đã kiểm quyền và version */);
await this.auditWriter.record(tx /* sự kiện nghiệp vụ */);
// Handler trả DTO JSON; interceptor lưu DTO trong chính transaction này.
```

## Khoá và phục hồi

- Khoá UUIDv4, chuẩn hoá chữ thường; phạm vi principal type/ID, HTTP method và
  đường dẫn thực có resource ID. Hash SHA-256 từ JSON canonical, `If-Match` và query;
  thứ tự phần tử array được giữ, body vắng khác JSON null, auth/trace không vào
  hash. URL mơ hồ bị từ chối.
- Claim ngắn và bước kiểm token dùng advisory/row lock PostgreSQL, timeout khoá
  250ms. Sau khi giữ khoá claim, khôi phục lock_timeout mặc định; use case tự đặt
  chính sách chờ/khoá tài nguyên nghiệp vụ theo ADR tương ứng.
  Lease 30s, retention 24h theo BR-GEN-08. Transaction nghiệp vụ giữ row lock,
  kiểm token sở hữu, timeout 10s và commit tác động + audit + response cùng lúc.
- Trùng đang xử lý: 409 `E_SYS_REQUEST_IN_PROGRESS`, `Retry-After: 1`.
  Khác hash: 409 `E_SYS_IDEMPOTENCY_KEY_REUSED`. Replay: status/body/header đã lưu
  và `Idempotency-Replayed: true`.
- Rollback chỉ bù claim đang chờ với đúng lease token, dùng `SKIP LOCKED` để không
  chờ chủ sở hữu khác. Tiến trình chết để lại claim; hết lease thì chủ mới lấy
  token mới. Token cũ không được thực hiện tác động.
- Job chạy mỗi giờ, tối đa 20 batch × 500 dòng. Chỉ xoá key hết 24h, bỏ qua lease
  sống và dòng đang bị khoá. Không đụng dữ liệu nghiệp vụ. Lỗi job được log bằng
  tên sự kiện không chứa request/credential; kỳ sau thử lại. Shutdown dừng timer
  và đợi lượt dọn đang chạy. Redis không tham gia claim, replay hoặc cleanup.

Các test `test/idempotency/` bắt buộc PostgreSQL 16 và Redis 7 thật; thiếu dịch vụ
thì fail, không skip. Dùng DB tạm riêng, Redis DB11 và dữ liệu tổng hợp. Bộ test có
HTTP đồng thời, sửa quyền/phạm vi sau lệnh đầu, lỗi audit/lưu response, SIGKILL trước
và trong transaction, lease fencing, mất Redis và TTL có row lock.
