# HB-028 — Đặt lại mật khẩu khách qua email

`POST /guest-auth/password-reset/request` (202, luôn) và `/confirm` (204). Công khai, không `@Idempotent`: thư phải
gửi **sau commit** (ngoài transaction idempotency); chống lặp bằng token một lần + hạn mức 3 yêu cầu/giờ/SĐT.

- **Token**: 32 byte ngẫu nhiên (hex 64), CSDL chỉ giữ SHA-256 trong `guest_password_resets.token_hash`; hiệu lực 30 phút theo `Clock`; token mới thay thế token còn hiệu lực của khách.
- **Không lộ tồn tại tài khoản**: SĐT lạ / không email / không có tài khoản mật khẩu ⇒ cùng 202 và 0 thư, vẫn bị đếm hạn mức. Khác biệt còn lại là thời gian (có SMTP) — xem rủi ro trong PR.
- **Lỗi gửi thư**: log `PASSWORD_RESET_EMAIL_FAILED` (chỉ mã lỗi) + audit cùng tên; phản hồi vẫn 202.
- **Confirm**: khoá dòng token → đổi băm Argon2id, xoá khoá đăng nhập sai → thu hồi mọi phiên của khách → token (và token khác còn hiệu lực) đã dùng → audit; một transaction.
- Cấu hình: `SMTP_URL`, `SMTP_FROM`, `GUEST_WEB_BASE_URL` (thiếu ⇒ `MAIL_NOT_CONFIGURED` được log + audit).
- Phụ thuộc HB-017: ca khoá `reset204` đăng nhập lại bằng `/guest-auth/login` nên chỉ xanh khi HB-017 đã có trên cùng cây mã.
