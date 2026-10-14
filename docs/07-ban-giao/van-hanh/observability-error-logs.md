# HB-181 — bảo vệ log lỗi HTTP của API

Phạm vi là điểm ghi lỗi của `AllExceptionsFilter`, theo [HB-181](../../08-thi-cong/tickets/HB-181-quan-sat.md), [kiến trúc §9.1](../../04-thiet-ke/kien-truc.md#91-log-có-cấu-trúc) và NFR-SEC-03. Đây không phải nghiệm thu toàn bộ tracing/SLO hay mọi nguồn log của API/worker.

## Dữ liệu được ghi

Mỗi lỗi không lường trước hoặc lỗi HTTP chưa ánh xạ ghi một JSON qua Pino: `correlationId`, `path` là mẫu route của framework, `outcome=error`, `errorCode=E_GEN_SERVICE_UNAVAILABLE`, `failureKind` và thông điệp tĩnh. Không đưa nguyên exception vào serializer: message, stack, cause, mã lỗi tự do, dữ liệu truy vấn, object/string bị throw và thuộc tính tuỳ biến đều có thể chứa credential hoặc PII.

| Nhánh | failureKind | Thông tin thêm an toàn |
| --- | --- | --- |
| Exception chưa biết, object hoặc primitive | `UNEXPECTED` | Không lấy trường từ dữ liệu bị throw |
| HttpException chưa có ánh xạ hợp đồng | `UNMAPPED_HTTP` | Không ghi response/message/cause của exception |
| Body lỗi không khớp schema | `INVALID_ERROR_BODY` | `issueCount` và tập `issueCodes` của Zod, không ghi key/path/message hay giá trị input của issue |

Cấu hình HTTP Pino dùng cả `quietReqLogger` và `quietResLogger`: logger theo request và logger hoàn tất chỉ giữ reqId, không kế thừa toàn bộ đối tượng req/URL/headers. Cần cả hai vì nestjs-pino chọn response child làm ngữ cảnh request. Log lỗi thêm correlation và mẫu route tường minh; log hoàn tất vẫn giữ reqId, trạng thái và thời lượng. Không tắt logger hoặc che assertion để tránh rò rỉ.

Dùng mẫu route như `/rooms/:roomId`, không ghi giá trị tham số đường dẫn. Khi không có mẫu route dùng `/[unmatched]`. Query không đi vào log của filter. `request.url` giữ nguyên cho các xử lý khác, gồm hash idempotency; `path` trong phản hồi vẫn theo hợp đồng hiện có, chỉ bỏ query như trước.

## Tương thích và chẩn đoán

- Status, code, message, details, `Retry-After`, `X-Trace-Id` và quy ước `X-Correlation-Id` của phản hồi không đổi. AppError hợp lệ vẫn không tạo error log ở filter.
- Tìm lỗi bằng correlation ID, route và failureKind; lỗi body có số lượng/mã issue. Không bật lại raw error/stack hoặc ghi request/credential vào log để điều tra. Trace chưa được cấu hình không có nghĩa là được phép ghi PII thay thế.
- Đây là projection trước khi gọi logger, không dựa vào tên trường nhạy cảm hay regex trên chuỗi log đã ghi. Không thay AuditLog, cơ chế nghiệp vụ, quyền endpoint hoặc dữ liệu trước/sau bắt buộc trong audit.

## Kiểm chứng và giới hạn

`apps/api/test/observability/error-log-privacy.spec.ts` chạy Nest/Fastify, filter và Pino thật. Mẫu hoàn toàn tổng hợp bao gồm email, số điện thoại/giấy tờ, token/password; kiểm cả dạng URL-encoded. Các ca exception/cause, HttpException, object/string, tham số route và key lạ trong Zod phải không đưa mẫu riêng tư vào log. Ca đối chứng kiểm nguyên status/details/Retry-After của AppError hợp lệ. `request-context.spec.ts` lấy cấu hình LoggerModule thực từ AppModule, chỉ thay destination để thu log, chạy PinoLogger theo request thật qua AsyncLocalStorage. Ca tham số đường dẫn riêng tư kiểm cả bản ghi lỗi được kế thừa lẫn log hoàn tất; đây là phần test bổ sung sau review. Bộ filter/health cũ vẫn được giữ nguyên.

Thêm tài liệu vận hành ngoài allow theo AGENTS.md §4 để ghi đúng phạm vi và cách chẩn đoán. Toàn HB-181 còn OPEN: W3C/OpenTelemetry xuyên API → outbox/job → worker, sampling/lỗi/thanh toán, context của mọi dòng log, audit toàn bộ các điểm ghi khác, dashboard/SLO/burn-rate, nơi nhận cảnh báo và lần chạy staging. Không dùng test riêng của filter để tuyên bố toàn hệ thống có 0 PII hay đã có tracing production. GitHub Actions hiện tắt ở repo; bằng chứng hosted CI vẫn BLOCKED.
