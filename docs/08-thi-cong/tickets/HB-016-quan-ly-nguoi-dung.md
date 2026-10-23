---
id: HB-016
title: Quản lý người dùng — GET/POST /users, PUT access, luật gán vai trò, thu hồi phiên
risk: R2
owner: deepseek # giai đoạn B; giai đoạn A do Codex viết test khoá
max_lines: 500
allow:
  - apps/api/src/modules/auth/users/**
  - apps/api/test/users/**
locked:
  - apps/api/test/users/users-access.spec.ts
  - apps/api/test/users/users-controls.spec.ts
  - apps/api/test/users/users-oracle.fixture.ts
  - apps/api/test/users/users-oracle.spec.ts
locked_sha:
  - c6d4cb9c8fb80f66718089411c873a13626dea6999fe61879c41c540bb8465c9 apps/api/test/users/users-access.spec.ts
  - 0f5316c4a5d3d72e40dbb6fc5a9b292696777833cdcc29e4ad4083651c18b3f7 apps/api/test/users/users-controls.spec.ts
  - dd31cb5e1e7adb418a510d50cba1bab3bb2e9634722977b73fbbfb3b2c72a7dd apps/api/test/users/users-oracle.fixture.ts
  - e7814489449678b427701d4d9971709d8bd2cdd7219d36e0533f70aaefd96df8 apps/api/test/users/users-oracle.spec.ts
---

# HB-016 — Quản lý người dùng

## Mục tiêu

OWNER/SYSADMIN xem, tạo người dùng và gán vai trò/phạm vi/trạng thái đúng luật của [QĐ-03](../../05-ke-hoach/nhat-ky/QD-03-dinh-danh-phien-f1.md) quyết định 7; thay đổi quyền có hiệu lực ngay trên mọi phiên.

## Căn cứ

- BR-RBAC-01, BR-RBAC-02; FR-AUTH-02, FR-AUTH-03, FR-AUTH-06; UC-AUTH-02; TC-AUTH-06, TC-AUTH-10
- api.md §2.1 (`PUT /users/{userId}/access`, If-Match), §6.3; QĐ-03 T6, T9

## Hai giai đoạn

- **A — Codex** (nhánh ứng viên `ticket/HB-016-users-a`, ghim bởi Opus 23/10): `users-access.spec.ts`, `users-controls.spec.ts`, `users-oracle.spec.ts` + `users-oracle.fixture.ts`. Ca: SYSADMIN gán `OWNER` hoặc `SYSADMIN` → 403; ai đó sửa chính mình → 403; vô hiệu OWNER hoạt động cuối → 403 (hai yêu cầu song song vô hiệu hai OWNER cuối: đúng một thành công); thiếu `If-Match` → 428, `version` cũ → 412; đổi phạm vi/vai trò/vô hiệu → mọi phiên của người đó bị thu hồi, access token cũ bị từ chối ở request kế tiếp (TC-AUTH-10); `POST /users` trùng `username` → 409, tạo xong `mustChangePassword=true`; `GET /users` lọc đúng và không trả `password_hash`; mọi thay đổi có audit với before/after.
- **B — DeepSeek** (`ticket/HB-016-users`): hiện thực tới khi test khoá xanh.

## Tiêu chí nghiệm thu

1. `version` lấy từ `updated_at` hoặc cột version — ghi rõ lựa chọn; ETag trả về ở GET/PUT.
2. Thu hồi phiên cùng transaction với thay đổi quyền; access token bị chặn bằng kiểm `revoked_at` của phiên trong guard (đã có cache thì TTL ≤ 60 giây — ghi rõ).
3. Không xoá cứng người dùng.
4. Test khoá xanh; `pnpm run ci` xanh.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:integration`
