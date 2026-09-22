# ADR-017 — Idempotency bền, inbox độc lập và phát sự kiện ít nhất một lần

**Trạng thái:** Đã chấp nhận cho thiết kế · **Ngày rà soát:** 2026-09-22. Thay phần idempotency/khoá Redis trong ADR-004; bổ sung ADR-008/009.

## Bối cảnh

Redis TTL và việc check-then-insert không bảo vệ request đồng thời hoặc retry sau crash. Webhook chưa xác minh có thể chiếm khoá dedup của giao dịch thật. Ghi outbox là “đã publish” ngay khi enqueue làm mất việc nếu Redis mất dữ liệu trước khi consumer xử lý.

## Quyết định

1. Lệnh API có unique `(principalId, operation, idempotencyKey)` tại PostgreSQL, hash payload canonical gồm resource và precondition. Xác thực, permission cụ thể và object/property scope trước replay; không so role theo thứ bậc. Cùng key/hash trả kết quả đã commit; khác hash báo conflict. Principal khách/session do server xác lập, không tin ID client gửi. Key tồn tại 24 giờ theo BR-GEN-08; uniqueness của providerTxnId/externalRef/quote acceptance/refund leg vẫn bền sau khi key hết TTL.
2. Claim key và commit tác động + response cùng transaction cho lệnh cục bộ. Concurrent request chờ unique/row lock trong timeout giới hạn; bản đã commit trả lại, bản đang xử lý trả trạng thái pending/retry theo API. Nếu dùng lease cho việc dài, CAS theo owner/version và phục hồi từ operation bền. Redis chỉ cache kết quả đã hoàn tất; mất Redis không cho phép thực hiện lần hai.
3. Webhook: giữ raw bytes → adapter verify chữ ký, nguồn/account và các kiểm tra replay mà provider hỗ trợ → chuẩn hoá → ghi `WebhookInbox`. Không ghi khoá dedup thành công trước xác minh. Inbox có provider/account, event ID hoặc khoá canonical provider, payload hash, receivedAt, trạng thái xử lý, attempts và kết quả. Unique sự kiện không thay unique giao dịch: provider có thể gửi nhiều event ID cho cùng transaction.
4. Worker hoặc request handler lấy inbox đã xác minh, khoá aggregate và kiểm lại orderRef/amount/currency, ghi tài chính/booking + audit/outbox + đánh dấu inbox applied cùng transaction. Event không match hoặc đến sai thứ tự đưa vào exception/reconciliation, không biến thành thành công nghiệp vụ. Không cần chữ ký mới khi xử lý lại bản inbox đã xác minh có kiểm soát; mọi lần nhận HTTP mới vẫn phải verify trước dedup.
5. ACK qua `adapter.ack(outcome)`, đúng mã/body hợp đồng **từng provider**. Chỉ ACK khi thông tin đã bền hoặc đã áp dụng nếu provider đòi business result; duplicate trả ACK hợp lệ tương ứng. Không áp một `200 JSON` chung và không gửi `E_PAY_CALLBACK_DUPLICATE` như lỗi khiến PSP retry. API spec sở hữu chi tiết ACK. Mất DB → không ACK như đã nhận. Giới hạn xử lý request theo NFR, không chờ notification/OTA.
6. `OutboxEvent` chỉ cho sự kiện **đi ra**. Commit sự kiện cùng thay đổi. Relay claim hàng bằng lease, publish rồi đánh dấu; crash có thể publish lặp. Mỗi consumer lưu unique `(consumer,eventId)` và cập nhật projection/tạo external intent trong một TX. External I/O theo operation idempotent, không trong TX consumer. Không hứa exactly-once qua mạng.
7. Theo dõi giao hàng bền từng consumer bằng bảng hạ tầng `event_deliveries` (unique `(consumer,eventId)`, status và lease; không thêm thực thể miền): enqueued không đồng nghĩa completed. Reconciler quét delivery chưa hoàn tất/lease hết hạn và enqueue lại kể cả Redis bị xoá. Chỉ dọn outbox khi mọi consumer bắt buộc có completion bền hoặc hồ sơ dead-letter được giải quyết; retention không xoá sự kiện tài chính còn treo.
8. Event chứa eventId, schemaVersion, aggregateId, aggregateVersion, occurredAt, correlationId, causationId. Consumer bỏ bản cũ theo version; phát hiện khoảng trống thì reload primary/replay. Channel sync gửi ảnh tồn mới nhất theo key và version, không cộng/trừ delta theo thứ tự message. Notification lỗi chỉ retry notification; không đổi trạng thái booking/move.

## Phương án và hệ quả

Chọn at-least-once + idempotent consumer thay vì distributed transaction PostgreSQL–Redis–PSP. Thêm inbox/delivery/operation bền, đổi lại có thể phục hồi theo dấu vết khi tiến trình chết tại mọi ranh giới. Phân biệt permission với role: thao tác phê duyệt/chi/cấu hình/đối soát là các quyền khác nhau, worker mang service principal với quyền tối thiểu.

## Kiểm chứng và đồng bộ

DB cần unique scoped idempotency, inbox, delivery receipt/lease và provider business keys bền. API cần hash conflict, pending replay, verify-before-dedup và ACK theo provider. Ca bắt buộc: hai request cùng key đồng thời; cùng key khác principal/operation; replay sau mất Redis; chữ ký sai dùng cùng event ID với webhook thật; hai event ID cùng receipt; crash trước/sau commit; queue mất sau enqueue; hai worker cùng event; out-of-order success/failure; retry quá 24 giờ không ghi tiền lần hai.

**Tham chiếu:** BR-GEN-08, BR-PAY-03, BR-CHAN-03/06/07, [kiến trúc](../kien-truc.md), [sequence](../sequence-diagram.md). Phát lặp và consumer idempotent theo [AWS — Transactional outbox pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html); lựa chọn isolation/khoá theo [PostgreSQL 16 — Transaction Isolation](https://www.postgresql.org/docs/16/transaction-iso.html).
