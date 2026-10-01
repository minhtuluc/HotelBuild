# QĐ-03 — Quyết định F1: định danh, phiên, phân quyền

**Ngày:** 02/10/2026 · **Phạm vi:** pha F1 của [lộ trình thi công](../lo-trinh-thi-cong-web-android.md) · **Người lập:** lead (Opus), người dùng chốt các mục 1–10 · **Thay thế:** đề xuất F1-a…F1-d của [QĐ-02](QD-02-nen-tang-backend.md) · **Ticket:** [backlog](../../08-thi-cong/backlog.md)

## 1. Quyết định của người dùng (phỏng vấn 02/10/2026)

| # | Quyết định | Căn cứ / ghi chú |
|---|---|---|
| 1 | Web (customer + operations) giữ refresh token trong cookie `HttpOnly; Secure; SameSite=Strict; Path=/api/session` của **chính app Next.js**; route handler đóng vai BFF mỏng gọi `/api/v1/auth/*`. Access token chỉ ở bộ nhớ trình duyệt. Android dùng `expo-secure-store` | Không đổi hợp đồng `/api/v1`; JS trên trang không đọc được refresh token |
| 2 | Hết phiên khi nhàn rỗi 15 phút **chỉ** áp cho operations web. Phiên khách giữ 7 ngày; thao tác nhạy cảm của khách đòi đăng nhập lại (làm ở F5) | BR-RBAC-05 |
| 3 | Khoá 5 lần sai liên tiếp trong 15 phút áp cho **cả** nhân viên lẫn khách. Thêm giới hạn 10 lần đăng nhập/phút/IP | BR-RBAC-06, NFR-SEC-05 |
| 4 | PIN sai 3 lần liên tiếp → khoá thao tác cần PIN 15 phút; thao tác không cần PIN vẫn dùng được | Giả định dùng tạm (TC-AUTH-03), chưa có BR riêng |
| 5 | Nhân viên tự đặt PIN ở lần đăng nhập Android đầu tiên. Quên PIN: MANAGER của cơ sở hoặc SYSADMIN **xoá** PIN để nhân viên đặt lại. PIN chỉ lưu hash, không ai xem được | |
| 6 | F1 bắt buộc có mạng để đăng nhập và mở khoá PIN trên Android; mất mạng báo "cần kết nối". Chưa có chế độ offline | OPEN-02 vẫn mở cho pha sau |
| 7 | OWNER gán mọi vai trò. SYSADMIN gán mọi vai trò **trừ** OWNER và SYSADMIN. Không ai đổi vai trò/phạm vi của chính mình. Không vô hiệu OWNER đang hoạt động cuối cùng | BR-RBAC-01; api.md §2.1 |
| 8 | OWNER đầu tiên của môi trường thật tạo bằng lệnh chạy một lần đọc tên đăng nhập + mật khẩu tạm từ biến môi trường; buộc đổi mật khẩu ở lần đăng nhập đầu. Dev dùng 7 tài khoản giả cho 7 vai trò | |
| 9 | Nhân viên nhiều cơ sở chọn **một cơ sở đang làm việc** sau đăng nhập, đổi được trên thanh đầu trang không cần đăng nhập lại. Máy chủ vẫn cưỡng chế toàn bộ phạm vi được cấp | BR-RBAC-02 |
| 10 | Khách: SĐT + mật khẩu (≥ 8 ký tự theo hợp đồng). OTP để sau khi có nhà cung cấp SMS. **Quên mật khẩu qua email** đưa vào F1 (Mailpit cho dev); khách không có email thì hiện "liên hệ lễ tân" | BR-CRM-01 |

## 2. Quyết định kỹ thuật của lead

| # | Quyết định | Lý do | Phương án bị loại |
|---|---|---|---|
| T1 | Băm mật khẩu và PIN bằng **Argon2id** (`@node-rs/argon2`, bản dựng sẵn). Token JWT ký HS256 bằng `jose` | NFR-SEC-03; không cần node-gyp trong image | `bcrypt`: không phải Argon2id |
| T2 | Phiên lưu ở PostgreSQL (`auth_sessions`). Mỗi lần refresh tạo dòng mới cùng `family_id`, dòng cũ ghi `rotated_at`. Trình refresh token đã xoay → thu hồi cả family | api.md §6.3 (reuse thu hồi family) | Chỉ lưu Redis: mất Redis là mất khả năng thu hồi |
| T3 | Idle 15 phút của operations web đo bằng `last_seen_at`, cập nhật tối đa 1 lần/60 giây/phiên khi có request đã xác thực; refresh của phiên `OPS_WEB` bị từ chối nếu `last_seen_at` cũ hơn 15 phút | Không ghi DB mỗi request | Chỉ dựa tuổi JWT: không phải "nhàn rỗi" |
| T4 | Đếm sai mật khẩu: tài khoản tồn tại dùng `failed_login_count`/`locked_until` trong DB; định danh không tồn tại dùng bộ đếm Redis cùng ngưỡng, để phản hồi giống hệt nhau (không lộ tài khoản có tồn tại) | NFR-SEC-05; chống dò tài khoản | Trả lỗi khác nhau cho "không tồn tại"/"sai mật khẩu" |
| T5 | Thêm 7 mã lỗi: `E_AUTH_ACCOUNT_LOCKED` (401, kèm `retryAfterSeconds`), `E_AUTH_PIN_LOCKED` (403), `E_AUTH_PASSWORD_CHANGE_REQUIRED` (403), `E_AUTH_USERNAME_TAKEN` (409), `E_AUTH_PHONE_REGISTERED` (409), `E_AUTH_RESET_TOKEN_INVALID` (400), `E_GEN_RATE_LIMITED` (429, header `Retry-After`). Bảng api.md §4.2 thành 61 mã | Không có mã nào cho các tình huống của quyết định 3, 4, 7, 8, 10 | Dùng `E_AUTH_INVALID_CREDENTIALS` cho mọi trường hợp: người dùng không biết phải làm gì |
| T6 | Thêm endpoint: `GET /users`, `POST /users`, `POST /auth/password` (đổi mật khẩu của mình), `PUT /auth/pin` (đặt PIN của mình), `DELETE /users/{userId}/pin` (xoá PIN), `POST /guest-auth/password-reset/request`, `POST /guest-auth/password-reset/confirm`. `tokenPair` thêm trường tuỳ chọn `mustChangePassword` | Quyết định 5, 7, 8, 10 và màn hình SCR-15 cần | — |
| T7 | `password-reset/request` luôn trả `202` dù SĐT/email có tồn tại hay không; token 32 byte ngẫu nhiên, lưu hash, hiệu lực 30 phút, dùng một lần; đặt lại xong thì thu hồi mọi phiên của khách | Chống dò tài khoản | — |
| T9 | `POST /users` ở F1 **chưa** có middleware idempotency (bảng `idempotency_keys`, ADR-017); trùng `username` trả 409 nên gửi lặp không tạo hai tài khoản. Middleware làm thành ticket riêng trước F4 | Hạ tầng idempotency phục vụ chủ yếu F4–F5; không chặn F1 | Làm middleware trong F1: kéo dài F1 mà không có use case tiền/tồn để kiểm |
| T10 | `loginRequest` thêm trường tuỳ chọn `clientSurface` (`OPS_WEB` mặc định, `OPS_ANDROID`); guest dùng `GUEST_WEB`/`GUEST_ANDROID`. **Rủi ro chấp nhận:** client tự khai bề mặt nên có thể né idle 15 phút bằng cách khai `OPS_ANDROID`; giảm thiểu bằng audit đăng nhập theo bề mặt | Không có cách tin cậy để máy chủ phân biệt app với trình duyệt khi chưa có chứng thực thiết bị | Header tự do không ghi trong hợp đồng |
| T11 | **Không có OTP nên không chứng minh được chủ SĐT.** Đăng ký bằng SĐT đã có hồ sơ khách (do lễ tân tạo) trả `409 E_AUTH_PHONE_REGISTERED` + hướng dẫn "liên hệ lễ tân"; không tự gắn tài khoản vào hồ sơ cũ, tránh chiếm lịch sử đặt phòng của người khác. Lễ tân gắn tài khoản cho khách ở pha sau | Hệ quả trực tiếp của quyết định 10 | Tự gắn vào hồ sơ có sẵn: ai biết SĐT là đọc được booking của người khác |
| T8 | Gói dùng chung (`contracts`, `domain`) phải nạp được ở runtime Node trong image api/worker trước khi API import giá trị từ chúng (HB-027) | Hiện export `./src/index.ts`; review HB-006 | — |
