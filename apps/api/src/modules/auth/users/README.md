# HB-016: quản lý người dùng nội bộ

`GET /users`, `POST /users`, `PUT /users/{userId}/access` (api.md §2.1; QĐ-03 quyết định 5, 7, T6, T9).

## Quyết định

- **`version`/ETag**: không có cột version; `version = micro-giây epoch của users.updated_at` (đọc bằng SQL thô vì Prisma chỉ trả
  mili-giây), `ETag = "<version>"`. Trigger `trg_users_touch` đặt `updated_at := now()` ở mọi UPDATE nên đăng nhập/khoá do sai mật khẩu
  cũng đổi version (UI nhận 412 rồi tải lại). `GET /users` trả `ETag` của trang (băm id+version+phân trang).
- **Thu hồi phiên**: cùng transaction với thay đổi vai trò/phạm vi/trạng thái (chỉ khi có thay đổi thật); đặt `revoked_at` cho **mọi** phiên
  của người đó. `AuthGuard` đọc `auth_sessions.revoked_at` ở mỗi request nên access token cũ bị từ chối ngay — **không có cache (TTL 0)**.
- **Khoá**: `SELECT … WHERE id IN {đích, người gọi} OR (OWNER hoạt động) ORDER BY id FOR UPDATE` (ADR-014). Sau khoá kiểm lại người gọi
  còn hoạt động và phiên chưa thu hồi (thua cuộc đua ⇒ 401), kiểm quyền theo vai trò **hiện tại** của người gọi, rồi `If-Match`.
- **Idempotency**: `PUT` dùng `@Idempotent` (HB-029). `POST /users` **không** (QĐ-03 T9, ca khoá "same-key retry is username conflict"):
  gửi lặp ⇒ 409 `E_AUTH_USERNAME_TAKEN`, nên không tạo hai tài khoản và thân lệnh chứa mật khẩu tạm không bị lưu.
- **Luật gán** (`rules.ts`): OWNER gán mọi vai trò; SYSADMIN không gán OWNER/SYSADMIN; không ai sửa chính mình; không vô hiệu/hạ OWNER
  hoạt động cuối. **Đọc chặt hơn chữ của quyết định 7**: SYSADMIN cũng không sửa tài khoản đang giữ OWNER/SYSADMIN.
- Vai trò toàn cục (OWNER/SYSADMIN) phải có `propertyScope = []`; vai trò nghiệp vụ phải có ≥ 1 cơ sở tồn tại (400 nếu sai).
- Mật khẩu tạm: Argon2id qua `infrastructure/crypto/passwords.ts` (HB-013), `must_change_password = true`; không vào audit/log/phản hồi.
- MANAGER chỉ thấy người có cơ sở trong phạm vi của mình; `propertyId` ngoài phạm vi ⇒ 403 `E_AUTH_OUT_OF_SCOPE`.
