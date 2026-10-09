# HB-116 — API giả HTTP F5

Plugin dùng chung server HB-019, booking HB-079 và DTO/client HB-090. Chạy bằng `pnpm test:e2e`; cấu hình `E2E_API_BASE_URL`, `E2E_CUSTOMER_WEB_PORT`, `E2E_OPERATIONS_WEB_PORT` giống F4. Native Node, trình duyệt và hai client Android đều gọi cùng HTTP `/api/v1`.

## Khởi tạo kịch bản

1. Đăng nhập guest (`guest-auth/login`, hoặc SessionClient qua Next BFF); tạo quote và booking F4 của guest đó, property `journey-standard`.
2. Dùng `createPaymentApi`, `createRefundApi`, `createBookingApi` từ `@pinehill/api-client`. Web lấy bearer từ SessionClient trong bộ nhớ; Android dùng cơ chế phiên của app. Response được parse theo contracts, UI hiển thị số tiền từ server.
3. Test gọi control dưới đây bằng bearer đang còn hiệu lực, guest sở hữu booking hoặc staff có scope. Control là API **chỉ dành cho fixture loopback**, không có trong OpenAPI sản phẩm.

```ts
await fetch(`${fixtureOrigin}/__control/f5/bookings/${bookingId}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
  body: JSON.stringify({ event: 'payment-timeout', paymentId }),
});
// Đọc lại bằng paymentApi.status(paymentId), bookingApi.get(bookingId), refundApi.list({ bookingId }).
```

`POST /__control/f5/bookings/{bookingId}` nhận strict `{event, paymentId?}`:

| event                              | Kết quả                                                                                                                                                                                                                                                                                             |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `payment-success`                  | Payment SUCCEEDED, cộng khoản thu đúng một lần. Booking còn hạn đủ cọc → CONFIRMED. Sau EXPIRED/CANCELLED/NO_SHOW giữ trạng thái kết thúc, hoàn 100% riêng khoản thu muộn, phí 0. Booking đang hoạt động có tiền dư → yêu cầu SYSTEM chỉ cho phần dư của Payment đó, trừ các khoản đã hoàn/đang giữ |
| `payment-failed`                   | Payment FAILED; không lùi SUCCEEDED và không đổi booking đã xác nhận                                                                                                                                                                                                                                |
| `payment-timeout`                  | Payment FAILED cục bộ; HELD/PENDING_PAYMENT chỉ → EXPIRED khi holdExpiresAt đã tới; còn hạn giữ nguyên để callback muộn có thể xác nhận. CONFIRMED giữ nguyên                                                                                                                                       |
| `hold-boundary`                    | Đặt holdExpiresAt đúng hiện tại; callback kế tiếp không xác nhận lại/reclaim phòng                                                                                                                                                                                                                  |
| `expire`, `cancel`, `no-show`      | Ép booking về trạng thái kết thúc để kiểm tra callback muộn; không thay lệnh cancel sản phẩm                                                                                                                                                                                                        |
| `gateway-error`, `gateway-timeout` | Lần tạo online trả 502 E_PAY_GATEWAY_ERROR / 504 E_PAY_GATEWAY_TIMEOUT; không tạo Payment                                                                                                                                                                                                           |
| `clear-error`                      | Xoá lỗi gateway/PIN/đổi ngày đang ép                                                                                                                                                                                                                                                                |
| `pin-locked`                       | PIN verify trả 403 E_AUTH_PIN_LOCKED                                                                                                                                                                                                                                                                |
| `reschedule-conflict`              | Đổi ngày trả 409 E_INV_ROOM_TAKEN                                                                                                                                                                                                                                                                   |
| `unconfirmed-partial`              | Seed riêng một Payment CASH SUCCEEDED 250499 VND trên booking chưa có Payment, giữ HELD; huỷ hoàn đúng 250499, không làm tròn                                                                                                                                                                       |

Ba event `payment-*` cần `paymentId` thuộc **đúng booking**. Control từ guest khác trả 404; bearer thiếu/đã rotate/đã logout hoặc từ server khác trả 401. Trường lạ bị từ chối 400. Mọi map, replay và PIN nằm trong context của từng server.

## Staff / PIN / các trạng thái hoàn

Staff đăng nhập fixture mặc định FRONT_DESK, scope `journey-standard`. Test có thể cấu hình **actor staff hiện tại**, không sửa token:

```ts
await fetch(`${fixtureOrigin}/__control/f5/actor`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
  body: JSON.stringify({ role: 'MANAGER', propertyIds: ['journey-standard'] }),
});
```

- GUEST: online VNPAY/MOMO, status/balance, preview/cancel/reschedule của chính mình; đọc/rút yêu cầu do mình tạo. Lệnh cancel tạo RefundRequest; guest không POST trực tiếp `/refund-requests`, không DELETE booking.
- FRONT_DESK/RESERVATION_AGENT: lập yêu cầu hoàn; thu CASH/BANK_TRANSFER với PIN (RESERVATION_AGENT chỉ DEPOSIT). MANAGER/OWNER: lập, duyệt hoặc từ chối, khác người lập. ACCOUNTANT: chi khi APPROVED, về phương thức gốc; CASH hoàn BANK_TRANSFER kèm bankNote. Quyền và scope được kiểm trước replay.
- `POST /auth/pin/verify`: strict `{pin:'123456', bookingId}` → token giả trong bộ nhớ, hết hạn sau 5 phút, gắn actor + booking, chỉ tiêu thụ khi lệnh thành công. Retry cùng Idempotency-Key được trả snapshot cũ sau kiểm phiên/quyền/scope; token không cấp lệnh mới hoặc booking khác. Đây là PIN **synthetic**, không phải mật khẩu hay cơ chế xác thực sản phẩm.
- Tạo hoàn → PENDING. Duyệt → APPROVED, chưa chi tiền. Chi → PAID, tăng refundedAmount đúng một lần. Từ chối → REJECTED hoặc rút → CANCELLED, giải phóng reservation và không hồi sinh booking.
- `GET /refund-requests`: bộ lọc bookingId/propertyId/status và cursor/limit; meta luôn có total. Fixture đủ các trạng thái để UI render bằng DTO server.
- Lệnh ghi yêu cầu UUIDv4 Idempotency-Key (ApiClient tự sinh); cùng key/body canonical phát lại snapshot ban đầu, khác body trả 409 E_SYS_IDEMPOTENCY_KEY_REUSED. DELETE replay vẫn 204 sau khi booking đã bị xoá, chỉ đúng principal/scope.

## Giá/policy fixture và giới hạn

Giá F4 đóng băng 1.000.000 VND/phòng/đêm, cọc 30%. Online/cash chỉ DEPOSIT hoặc BALANCE đúng số server trả. Ordinary cancel dùng một Payment nguồn: chưa xác nhận hoàn đúng số thu; confirmed có mẫu FLEX7 96 giờ/50%, SAVER3 96 giờ/100%, LONGSTAY14 200 giờ/50%, NONREF 96 giờ/0%; phí 0. Đây là mẫu tier cố định từ bảng đã duyệt, không tính theo wall clock, không phải CancellationPolicyEngine hoặc bảng policy đầy đủ. Fee/early-checkout/partial-cancel/force-majeure phải dùng dữ liệu backend/engine đúng rule; special reasons/bookingRoomIds không được fixture này xử lý thành công, không silently huỷ hết phòng.

Reschedule mô phỏng kỳ mới còn tồn, giữ trạng thái/cọc/cam kết cũ, total = max(total cũ, giá synthetic kỳ mới), tăng count, không tạo hoàn. Cho phép một lần trên HELD/PENDING_PAYMENT/CONFIRMED; NONREF có phí riêng chưa mô phỏng. Mốc thời gian, snapshots lịch sử/transaction và kiểm tồn thật thuộc backend. Delete chỉ FRONT_DESK đúng scope, DRAFT/HELD chưa từng có Payment và có reason.

`paymentUrl` là endpoint loopback `/__test/f5/payments/{id}` để đi/đọc thử; truy cập hay query `result=success` **không** xác nhận tiền. **Không** dựng giả VNPay/MoMo IPN trên route production: các route callback PSP vẫn 404, chỉ control test mô phỏng thứ tự đến. Không chứng minh chữ ký, merchant, ACK PSP, sandbox, ledger, locks PostgreSQL, payout worker hoặc tính nguyên tử thật.

## Bằng chứng chạy

Vitest chạy ApiClient/factories thật qua socket HTTP, kiểm phiên/scope/role/PIN/replay và các trạng thái trên. Playwright `f5.spec.ts` chạy cả hai Next app đã build, SessionClient qua cookie HttpOnly/Secure/Strict rồi bearer memory qua CORS đến API giả; không `page.route` F5. Asset `/__test/f5-client.js` chỉ bundle lại client/factories sản phẩm cho browser test, không phải code cho frontend import.

E2E này kiểm plumbing phiên/client/fixture trên shell hiện có. Các màn F5 chưa thi công và chưa có Maestro cho màn F5, nên không nhận đã nghiệm thu UI F5 hoặc thiết bị Android. Làn UI có thể dùng fixture ngay khi HB-116 land, tiếp tục chạy bộ test màn riêng theo ticket.

## Read models dùng chung (bổ sung HB-116)

- `GET /bookings`: xác thực guest/staff; guest chỉ đơn của mình, staff chỉ cơ sở trong phạm vi và vai trò được đọc booking. Hỗ trợ `limit`, `cursor`, `propertyId`, `status`, `channelCode`, `q` (mã đơn), `from`/`to` (ngày đến), `sort=createdAt|-createdAt`. Cursor thuộc kết quả sau lọc; sai cursor trả 400. Đọc collection cùng các lệnh cancel/reschedule/delete, không dựng danh sách độc lập.
- `GET /guests/me`, `/guests/me/loyalty`: chỉ phiên guest; hồ sơ synthetic theo actor, cùng guestId với đơn tạo mới. Không sao chép phone/token đăng nhập vào hồ sơ giả.
- Fake PIN/counter payment/refund maker-checker đã có để thi công UI_ONLY HB-109/110. Đây không phải bằng chứng cho backend HB-015/096/099/100; binding purpose/amount và payout thật chưa được fake xác nhận.

- `GET /auth/me`: staff-only identity dùng cùng actorId với `RefundRequest.requestedBy`, role/propertyScope theo cấu hình fixture; PIN mặc định synthetic `123456` được phản ánh bằng `hasPin=true`. Dùng để HB-110 ẩn tự duyệt, không giải mã token để lấy ID. Guest bị403, thiếu phiên401.
