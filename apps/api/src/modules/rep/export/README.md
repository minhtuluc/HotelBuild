# REP export — xuất báo cáo bất đồng bộ (HB-163)

`POST /api/v1/reports/export` (202 + `operationId` + `Location`) và hai tuyến theo dõi/tải ở module
`sys/operations`: `GET /api/v1/operations/{operationId}`, `GET /api/v1/operations/{operationId}/download`.

## Luồng

1. Kế toán gửi `report` + `format` + `params` (api.md §2.12) kèm `Idempotency-Key`. Module **kiểm lại
   `params` theo báo cáo được chọn**, rồi gọi đúng `ReportsService` mà màn hình dùng ⇒ số trong tệp khớp
   số trên màn hình (AC3).
2. Ảnh chụp kết quả được lưu vào `operations.result_json` cùng hàng `PENDING` + audit
   `REPORT_EXPORT_REQUESTED` (một transaction). Bộ lọc quá lớn (vượt `MAX_EXPORT_PAYLOAD_BYTES` = 8 MB)
   bị từ chối 400 ngay tại đây.
3. Đẩy job `q.report-export` với `jobId = operationId` (đẩy lại là no-op) rồi trả 202 kèm `Location`
   trỏ `statusUrl` (api.md §6.4).
4. Worker `reportExportJob` đọc hàng `operations`, ghi CSV/XLSX bằng bộ sinh thuần
   (`export/{csv,xlsx,storage}.ts`), đóng dấu `SUCCEEDED` + `result_path` + `result_expires_at`
   (`EXPORT_TTL_SECONDS` = 15 phút) và **xoá `result_json`** (không giữ dữ liệu thêm một chỗ).
   Job chỉ nhận hàng `PENDING` ⇒ chạy lại không ghi tệp lần hai; lỗi ⇒ `FAILED` + `error_code`
   `E_GEN_SERVICE_UNAVAILABLE` (message đã lược chi tiết nội bộ, không PII).
5. `GET /operations/{id}` trả `operationStatusViewSchema`; `resultRef` chỉ xuất hiện khi tệp còn hạn.
   Tuyến này kiểm **quyền hiện tại**: người yêu cầu phải còn phạm vi cơ sở bao phủ `property_scope` đã
   chụp lúc yêu cầu, nếu không thì 403 kể cả khi thao tác đã xong (api.md §6.4, BR-RBAC-02).
   `GET /operations/{id}/download` yêu cầu **bearer token của chính người yêu cầu** (hoặc OWNER) **và**
   chữ ký `expires`/`signature` (HMAC-SHA256 trên `operationId:expires`). Sai chữ ký ⇒ 403; hết hạn ⇒ 404.

## Chống trùng lệnh ghi (BR-GEN-08)

`POST /reports/export` gắn `@Idempotent(ReportExportAccess)`:
- `access.ts` kiểm quyền hiện tại + `exportInput` **trước claim** nên lệnh sai định dạng 400 và không để
  lại bản ghi khoá; thiếu/sai `Idempotency-Key` ⇒ 400 `E_GEN_VALIDATION_FAILED`.
- `service.request(tx, …)` ghi `operations` + audit bằng `tx` của `IdempotencyContext`, nên cùng khoá +
  cùng thân lệnh trả lại đúng `operationId` cũ (kèm `Location`) mà không tạo hàng `operations`/job thứ hai;
  khác thân lệnh ⇒ 409 `E_SYS_IDEMPOTENCY_KEY_REUSED`.
- Ảnh chụp báo cáo vẫn đọc qua `PrismaClient` (kết nối riêng của `ReportsService`, `RepeatableRead`):
  `Prisma.TransactionClient` không có `$transaction` nên không truyền client của interceptor vào đây được;
  câu đọc chạy trước mọi câu ghi nên không phá tính nguyên tử của phần ghi.
- `Location` do `ReportExportLocationInterceptor` đặt: `IdempotencyValidator` (HB-029) cấm tham số response
  (`@Res`) trên lệnh idempotent; interceptor chạy trong transaction nên header được lưu và phát lại.
- **Rủi ro đã biết**: `queue.enqueue()` nằm trong transaction nên chạy trước commit — rollback sau đó để lại
  job mồ côi, worker coi hàng `operations` không tồn tại là no-op. Chưa có outbox (HB-130) nên giữ nguyên
  vị trí phát, không dời ra sau commit.
- **Trần thời gian đã biết**: vì `service.request(tx, …)` chạy trong transaction của interceptor (timeout
  10 giây của `IdempotencyStore`), ảnh chụp báo cáo cũng phải xong trong ngưỡng đó; quá ngưỡng ⇒ lệnh hỏng,
  claim được bù nên gọi lại **cùng khoá** là an toàn. Giới hạn này nằm trong cùng ràng buộc "truy vấn chạy
  trong request" đã ghi ở mục quyết định (HB-175/HB-177 phải đưa truy vấn sang worker).


## Quyết định tự đưa ra (ghi để lead/QA đối chiếu)

- **Ảnh chụp kết quả tính tại lúc yêu cầu, không tính trong worker.** Lý do: giữ *một* nguồn công thức
  (module `rep/reports`) nên không có nguy cơ lệch số giữa tệp và màn hình, và không phải mở đường gọi
  API-từ-worker (chưa có cơ chế service token) hay nhân bản SQL. **Giới hạn đã biết:** trần 8 MB và thời
  gian truy vấn vẫn nằm trong request ⇒ mốc “100.000 dòng ≤ 60 giây” của HB-163 AC2 **chưa nghiệm thu**;
  muốn đạt cần đưa truy vấn sang worker qua gói dùng chung hoặc lưu trữ đối tượng (HB-175/HB-177).
- **Ký bằng `JWT_ACCESS_SECRET`** thay vì thêm biến môi trường mới; link vẫn phải qua bearer token.
- **Tệp nằm trong `EXPORT_DIR`** (mặc định `<tmpdir>/pinehill-exports`): worker ghi, API đọc ⇒ hai tiến
  trình phải trỏ cùng thư mục (API chặn mọi đường dẫn ngoài thư mục này trước khi đọc).
- **Dọn tệp theo hạn ở lúc đọc** + `result_expires_at`; chưa có job quét dọn định kỳ — khi làm HB-179
  (sao lưu) nên dùng chung bảng `operations` và thêm job dọn.
- Bảng `operations` đọc/ghi bằng **SQL thô** (không khai trong `prisma/schema.prisma`) để tránh phải sinh
  lại Prisma client trong cùng PR; mọi truy vấn nằm gọn trong module này.
