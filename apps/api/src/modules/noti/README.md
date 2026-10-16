# NOTI — thông báo đã gửi & gửi lại (HB-168)

`GET /api/v1/notifications` (danh sách, che PII) và `POST /api/v1/notifications/{notificationId}/resend`
(gửi lại có giới hạn) — api.md §2.11, BR-SYS-06. Worker gửi thật ở `apps/worker/src/noti/`.

## Quy ước đã chốt trong mã

1. **Che PII ở máy chủ** (`mask.ts`): email → giữ 1 ký tự đầu phần local + `***` + domain
   (`n***@gmail.com`, khớp ví dụ hợp đồng HB-160); SĐT/Zalo/Push → giữ 4 ký tự cuối + `****`, cùng quy
   ước `maskString` của AuditWriter (HB-009). Danh sách **không bao giờ** trả `recipient` thô.
2. **Vai trò**: `FRONT_DESK`, `RESERVATION_AGENT`, `MANAGER`, `OWNER` cho cả đọc và gửi lại (api.md ghi
   `FRONT_DESK` là vai trò tối thiểu; mở rộng theo tiền lệ `guests.read/create` HB-149).
3. **Phạm vi** (BR-RBAC-02): `notifications` không có cột cơ sở nên nhân viên chỉ thấy/gửi lại bản ghi
   gắn booking thuộc `propertyScope`; bản ghi `booking_id IS NULL` chỉ OWNER. Lọc `bookingId` trỏ ra
   ngoài phạm vi (hoặc không tồn tại) trả `403` thay vì danh sách rỗng — không lộ sự tồn tại đối tượng.
4. **Trạng thái `CANCELLED`** không có trong hợp đồng HB-160 ⇒ không trả ở danh sách và không gửi lại
   được (400).
5. **Hạn mức gửi lại đếm bằng nhật ký kiểm toán** (`NOTIFICATION_RESEND_REQUESTED`, tối đa 3 — HB-005
   đóng băng schema nên bảng không có cột đếm riêng). Mốc 5 phút so với `updated_at` (trigger
   `fn_touch_updated_at` của CSDL đặt mỗi lần chạm hàng) và đồng hồ tiêm vào. Vi phạm:
   - quá 3 lượt → `400 E_GEN_VALIDATION_FAILED` (catalogue chưa có mã `E_NOTI_*`;
     `E_SYS_REQUEST_IN_PROGRESS` được api.md mô tả cho khoá idempotency nên không mượn);
   - chưa đủ 5 phút → `429 E_GEN_RATE_LIMITED` + `retryAfterSeconds`/`Retry-After`.
   Mỗi lượt gửi lại mở **chu kỳ thử mới**: `status = PENDING`, `sent_at`/`error_message` xoá,
   `retry_count = 0`, ghi audit người yêu cầu + lý do (bắt buộc).
6. **`retry_count`** = số lần gửi tự động đã thất bại trong chu kỳ hiện tại (worker tăng, trần 3).

## Vì sao gọi trực tiếp sau commit (chưa có outbox HB-130)

`NotificationGateway.record(tx, …)` ghi bản ghi `PENDING` **trong** transaction của luồng nghiệp vụ;
`publish(id)` phát job BullMQ **sau** khi transaction commit. Mẫu dùng:

```ts
const id = await db.$transaction((tx) => gateway.record(tx, dispatch));
await gateway.publish(id); // hoặc gateway.notify(dispatch) khi luồng chưa tự mở transaction
```

- Khi HB-130 (outbox relay) có mặt, thay `publish` bằng bản ghi outbox rồi để relay phát job.
- **Khoảng trống đã biết**: `publish` lỗi (Redis hỏng) được ghi log lỗi an toàn (`NOTIFICATION_ENQUEUE_FAILED`
  + mã lỗi, không payload/PII) và bản ghi giữ `PENDING` — theo ADR-004 PostgreSQL là nguồn bền, Redis chỉ
  tăng tốc. Hiện chưa có relay quét `PENDING` nên lượt gửi đó chỉ chạy khi có thao tác/quét lại.
- `publish` **chờ** `queue.add` (không fire-and-forget) rồi mới trả response; job chạy nền nên request
  không chờ việc gửi thật.
- Job phát với `attempts = 3` (`NOTIFICATION_MAX_ATTEMPTS = NOTIFICATION_MAX_RESENDS`) và
  `backoff {fixed, 5 phút}` để hàng đợi giữ nhịp "cách nhau ≥ 5 phút" (BR-SYS-06). Số lượt BullMQ thử
  bằng đúng số lượt gửi thật: worker đánh `FAILED` ngay ở lượt gửi thứ ba thất bại (`retry_count` chạm
  trần 3) rồi ném lỗi để kết thúc job; lượt thứ tư chỉ gặp hàng `FAILED` và thoát mà không gửi gì.

## Gửi lại là lệnh ghi có idempotency (BR-GEN-08)

`POST /notifications/{notificationId}/resend` gắn `@Idempotent(NotificationResendAccess)`:

- `access.ts` kiểm quyền vai trò + `notificationId`/`resendInput` + bản ghi còn tồn tại + phạm vi cơ sở
  **trước claim/phát lại**; hạn mức 3 lượt và mốc 5 phút là trạng thái nghiệp vụ nên nằm trong handler —
  bản phát lại cùng khoá trả lại đúng kết quả đã commit dù đã quá 5 phút hay đã cạn lượt.
- Thiếu/sai `Idempotency-Key` ⇒ 400 `E_GEN_VALIDATION_FAILED`; cùng khoá khác thân lệnh ⇒ 409
  `E_SYS_IDEMPOTENCY_KEY_REUSED`. `notifications` + audit + bản ghi khoá cùng commit (một transaction).
- Lý do tự do đi qua `maskOperationalText` trước khi ghi `audit_logs.reason` (cột này không được
  `AuditWriter` che — HB-009); phản hồi cho khách là `NotificationSummary`, không có trường `reason` nên
  lời văn trả về không đổi.
- **Rủi ro đã biết**: `gateway.publish(id)` nằm trong transaction của interceptor nên chạy trước commit —
  rollback sau đó để lại job mồ côi, worker coi hàng `notifications` không tồn tại là no-op. Chưa có outbox
  (HB-130) nên giữ nguyên vị trí phát, không dời ra sau commit.
- `NotificationGateway.notify()` (đường tắt cho luồng chưa tự mở transaction) **không** nằm sau
  interceptor này, nên vẫn ghi + phát theo mẫu cũ.

## Bàn giao sang worker

- Handler: `export const notificationSendJob: JobHandler` — `apps/worker/src/noti/send.job.ts` (người tích
  hợp đăng ký vào `JOB_HANDLERS['q.notification-send']`). Bản có tham số: `createNotificationSendJob(senders)`
  (dùng để bơm kênh giả trong test).
- Payload: `{ notificationId: uuid }` — gương ở `apps/worker/src/noti/payload.ts`.
- Kênh: EMAIL qua SMTP tự chứa (`NOTI_SMTP_URL`, `NOTI_SMTP_FROM`; `smtp://`/`smtps://` + `AUTH LOGIN`,
  **không** STARTTLS); SMS/ZALO_OA/PUSH là adapter giả lập có chủ ý (HB-168 AC3, không gọi mạng). Thiếu
  cấu hình SMTP ⇒ lỗi `EMAIL_NOT_CONFIGURED` (không giả vờ đã gửi).
- Cảnh báo nhân viên (BR-SYS-06): `status = FAILED` + `error_message` mã ổn định + bản ghi audit
  `NOTIFICATION_DELIVERY_FAILED` (actor SYSTEM) đọc qua `GET /audit-logs` (MANAGER/OWNER).

## Kiểm thử

```
DATABASE_MIGRATION_URL=… DATABASE_URL=… REDIS_URL=… pnpm --filter @pinehill/api exec vitest run test/notifications --no-file-parallelism
DATABASE_MIGRATION_URL=… pnpm --filter @pinehill/worker exec vitest run test/notification-send.spec.ts
```

## Khoảng trống / nợ kỹ thuật

- Chưa có relay quét `PENDING` (HB-130) — xem mục "vì sao gọi trực tiếp sau commit".
- HB-028 (`apps/api/src/infrastructure/mail/**`) chưa có trong nhánh này và worker không import được
  `apps/api`, nên kênh email tự chứa trong `apps/worker/src/noti/smtp.ts`; khi HB-028 xong có thể thay
  sau cổng `ChannelSender` mà không đổi handler.
- `NOTI_SMTP_*` đọc trong `smtp.ts` (worker không được sửa `config/env.ts` ở ticket này): nên chuyển vào
  `WorkerConfig` + `.env.example`.
- Chưa có test kênh email thật qua SMTP server giả nội bộ và test hàng đợi BullMQ đầu-cuối cho handler.
