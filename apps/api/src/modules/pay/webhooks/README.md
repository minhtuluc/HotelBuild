# Webhook PSP — hộp thư vào bền, verify trước dedup (HB-095)

Đường nhận callback của cổng thanh toán (api.md §5.2):

| Tuyến                                         | Cổng      | Định dạng                                                             |
| --------------------------------------------- | --------- | --------------------------------------------------------------------- |
| `GET /api/v1/integrations/psp/vnpay/callback` | VNPay IPN | query string đã URL-encode; ACK `200 {"RspCode":"..","Message":".."}` |
| `POST /api/v1/integrations/psp/momo/callback` | MoMo IPN  | JSON; ACK `204` thân rỗng khi đã ghi nhận                             |

`@Public()`: nguồn gọi là cổng, không phải phiên nhân viên/khách; bảo vệ bằng **chữ ký giao thức**
(constant-time) của adapter `pay/psp` — **cùng** adapter/cấu hình với `POST /payments/online` (HB-094),
không có bộ ký thứ hai.

**Chặn cấu hình mô phỏng (P0).** Bộ khoá mô phỏng của `pay/psp` nằm công khai trong repo, nên chữ ký
xác minh bằng nó **không chứng minh được gì**. Khi `settings[method].mode !== 'live'`, tuyến từ chối
**trước cả verify**: `503` + `{"code":"E_PSP_NOT_PRODUCTION"}`, không ghi inbox, không ghi tiền (không có
payload chưa xác thực nào chạm CSDL). Chọn cách này thay vì "verify rồi mới bỏ qua" vì với khoá công
khai thì bước verify là vô nghĩa và hàng inbox do kẻ gọi tự do kiểm soát sẽ thành bề mặt tấn công.

## Vòng đời một callback

```
cổng ──▶ verify (pay/psp, constant-time; sai ⇒ từ chối, KHÔNG ghi gì)
      ──▶ webhook_inbox: INSERT (provider, provider_account_id, event_id) + payload_hash
                          transaction riêng, COMMIT  ← mốc "đã nhận"
      ──▶ xử lý (transaction riêng): CAS claim bằng lease → khoá sổ tiền (HB-093)
                          → payments / refund_requests / audit → inbox = PROCESSED
      ──▶ ACK theo cổng (VNPay RspCode / MoMo 204)
```

- **Ghi bền rồi mới ACK** (ADR-017 §3/§5): lỗi CSDL khi ghi inbox ⇒ `RspCode 99` (VNPay) / `HTTP 500`
  (MoMo) — _không_ success-ACK, để cổng gửi lại (AC3).
- **Dedup hai tầng**: `webhook_inbox` UNIQUE `(provider, provider_account_id, event_id)` chặn bản phát
  lại của _sự kiện_; `payments` UNIQUE `(method, provider_txn_id)` chặn cộng tiền lần hai của _giao
  dịch_ (sống lâu hơn TTL idempotency — ADR-017 §1). 5 callback trùng ⇒ 1 Payment (TC-PAY-22).
- **`PENDING`/`FAILED` không phải "đã xử lý"**: hàng inbox còn dở được `claim` lại và áp dụng ngay ở
  lần gửi sau — kể cả khi payload lần này khác payload gốc (điều kiện tiên quyết là chữ ký/đơn/số tiền
  của cổng, không phải hash của inbox). Chỉ `PROCESSED`/`DEAD_LETTER`/đang giữ lease mới lặp lại ACK cũ.
  Payload gốc **không** bao giờ bị ghi đè; sai khác payload ghi vào `audit_logs`
  (`PAYMENT_WEBHOOK_PAYLOAD_MISMATCH` kèm `storedPayloadHash`/`incomingPayloadHash`/`reapplied`) chứ
  **không** ghi đè `last_error` của hàng — `last_error` là trạng thái phát lại, không phải chỗ cảnh báo.
- **Cùng event_id khác payload mà hàng đã xong**: lặp ACK "đã xử lý" (`02`/`204`), không cộng tiền,
  để đối soát qua vết audit (`PAYLOAD_HASH_MISMATCH`) — không ghi đè payload gốc (csdl §3).
- **Kết quả chỉ tăng** (BR-PAY-11): `PENDING → FAILED` khi cổng từ chối; `PENDING/FAILED → SUCCEEDED`
  khi cổng báo thu thành công, kể cả trước đó FAILED do timeout cục bộ. `SUCCEEDED` **không** bị hạ.
- **Không đổi trạng thái booking**: nhận tiền không xác nhận/hạ booking. Booking đang chờ mà hold đã
  hết hiệu lực (dù job HB-078 chưa chạy) hoặc booking đã kết thúc ⇒ lập `refund_requests` hoàn **100%**
  riêng khoản thu muộn (`PAYMENT_TIMEOUT`, SYSTEM) và giữ hạn mức bằng `refund_allocations`; còn hạn thì
  phân bổ vào nghĩa vụ còn thiếu rồi đồng bộ projection của sổ.
- **ACK theo mã cũ khi trùng**: `RspCode 02`/`204` — không gửi lỗi làm cổng retry vô ích.

## Xử lý lại và đối soát

`webhook_inbox` là bằng chứng và là hàng đợi: `FAILED` = lỗi tạm thời (có `available_at`), được chiếm
lại khi cổng gửi lại hoặc khi có bộ phát lại; `DEAD_LETTER` = sai nghiệp vụ (`ORDER_UNKNOWN`,
`AMOUNT_MISMATCH`, `DUPLICATE_CHARGE`, `PROVIDER_TXN_REUSED`) cần đối soát tay, `last_error` giữ mã lý
do và cũng là mã ACK lặp lại cho bản phát lại. Lỗi khi **áp dụng** (sau khi đã bền) trả mã lỗi
retryable để cổng gửi lại, đồng thời mở hàng về `FAILED` — an toàn vì lần áp dụng luôn idempotent và
lần gửi sau của cùng sự kiện **được áp dụng lại** thay vì bị coi là bản trùng.

## Kiểm thử

`apps/api/test/webhook-psp/**` (app thật + PostgreSQL 16 + Redis DB `/7`, chạy bằng
`pnpm --filter @pinehill/api test`): chữ ký sai, thân sai định dạng, 5 callback trùng, SUCCEEDED sau
FAILED, decline muộn, tiền vào hold hết hạn, lỗi CSDL khi ghi inbox, redelivery sau lỗi áp dụng (payload
đổi) và **từ chối khi còn khoá mô phỏng**. Hai ca lỗi CSDL dùng `test/webhook-psp/db-fault.ts` — đổi tên
bảng thật (`webhook_inbox`, `payment_allocations`) trong lúc chạy nên lỗi là **thật**, không mock tầng nào.

**Không** lưu số thẻ/CVV/ngày hết hạn ở bất kỳ đâu (BR-PAY-04, NFR-SEC-02); payload inbox chỉ có mã
giao dịch, số tiền, trạng thái, thời điểm; audit đi qua `AuditWriter` (che PII) và không ghi tham số thô.
