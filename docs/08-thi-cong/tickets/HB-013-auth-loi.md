---
id: HB-013
title: Auth lõi nhân viên — login/refresh/logout/đổi mật khẩu, khoá tài khoản, rate limit, idle 15 phút
risk: R2
owner: deepseek # giai đoạn B; giai đoạn A do Codex viết test khoá
max_lines: 700
allow:
  - apps/api/src/modules/auth/**
  - apps/api/src/common/guards/**
  - apps/api/src/common/actor/**
  - apps/api/src/infrastructure/crypto/**
  - apps/api/src/infrastructure/redis/**
  - apps/api/src/infrastructure/prisma/**
  - apps/api/src/app.module.ts
  - apps/api/src/config/**
  - apps/api/package.json
  - apps/api/test/auth/**
  - pnpm-lock.yaml
locked:
  - apps/api/test/auth/staff-auth.locked.spec.ts
---

# HB-013 — Auth lõi nhân viên

## Mục tiêu

Nhân viên đăng nhập, xoay phiên, đăng xuất và đổi mật khẩu đúng hợp đồng HB-011; khoá sau 5 lần sai, giới hạn tần suất theo IP, hết phiên operations web sau 15 phút nhàn rỗi. Mọi route khác có guard xác thực mặc định (deny by default).

## Căn cứ

- [QĐ-03](../../05-ke-hoach/nhat-ky/QD-03-dinh-danh-phien-f1.md) quyết định 2, 3, 8; T1–T5, T10
- BR-RBAC-05, BR-RBAC-06; NFR-SEC-01, NFR-SEC-03, NFR-SEC-05; UC-AUTH-01
- TC-AUTH-01, TC-AUTH-02; api.md §1.2, §6.3; bảng `users`, `auth_sessions` (HB-010)

## Hai giai đoạn

- **A — Codex** (`lead/HB-013-test-khoa`, merge trước, đỏ lúc merge): `staff-auth.locked.spec.ts` chạy Supertest trên PG16 + Redis thật, thời gian qua `Clock` giả. Ca tối thiểu: đăng nhập đúng trả `tokenPair` hợp lệ theo schema; sai 5 lần liên tiếp → lần 6 trả `E_AUTH_ACCOUNT_LOCKED` kèm `retryAfterSeconds`, kể cả khi mật khẩu đúng, mở lại sau 15 phút (TC-AUTH-01); tài khoản không tồn tại trả **cùng** mã/thông điệp/thời gian phản hồi xấp xỉ với sai mật khẩu; 11 lần/phút từ một IP → `E_GEN_RATE_LIMITED`; refresh xoay token, dùng lại refresh cũ → 401 và cả family bị thu hồi; phiên `OPS_WEB` im lặng 15 phút → refresh 401 (TC-AUTH-02), phiên `OPS_ANDROID` vẫn refresh được tới 7 ngày; logout thu hồi family; `mustChangePassword` → mọi route trừ `/auth/password`, `/auth/logout` trả `E_AUTH_PASSWORD_CHANGE_REQUIRED`; route không gắn `@Public()` mà thiếu token → 401; tài khoản `is_active=false` không đăng nhập được.
- **B — DeepSeek** (`ticket/HB-013-auth-loi`): hiện thực tới khi test khoá xanh.

## Tiêu chí nghiệm thu

1. Argon2id cho mật khẩu (tham số ghi trong code, theo khuyến nghị OWASP hiện hành); JWT HS256 bằng `jose`, `exp` 15 phút, claims đúng `accessTokenClaimsSchema`; refresh token 32 byte ngẫu nhiên, DB chỉ lưu SHA-256.
2. Guard toàn cục: xác thực bearer → nạp `ActorContext` (mở rộng bản HB-009) → cập nhật `last_seen_at` tối đa 1 lần/60 giây. `@Public()` cho login/refresh/health.
3. Mọi đăng nhập thành công/thất bại/khoá/đổi mật khẩu ghi audit qua `AuditWriter` (HB-009), không ghi mật khẩu/token.
4. Thời gian/ID qua `Clock`/`IdGenerator`; không `new Date()` rải rác.
5. `GET /api/v1/auth/me` theo hợp đồng HB-012 (role, phạm vi cơ sở, `hasPin`, `mustChangePassword`) — trả từ DB, không chỉ từ claims của token.
6. Test khoá xanh trong job `backend`; `pnpm run ci` xanh.

## Ngoài phạm vi

- Ma trận quyền (HB-014), PIN (HB-015), quản lý người dùng (HB-016), khách (HB-017).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:integration`
