---
id: HB-010
title: Bảng phiên, credential khách, PIN, pinToken, đặt lại mật khẩu (csdl §3 + migration 0002)
risk: R2
owner: codex
max_lines: 450
allow:
  - apps/api/prisma/**
  - apps/api/test/migration/**
  - tests/database.test.mjs
unlock:
  - docs/04-thiet-ke/csdl.md
---

# HB-010 — Lược đồ định danh F1

## Mục tiêu

csdl §3 và migration mô tả đủ dữ liệu cho phiên, khoá tài khoản, PIN và đặt lại mật khẩu theo [QĐ-03](../../05-ke-hoach/nhat-ky/QD-03-dinh-danh-phien-f1.md). Hiện csdl §3 không có bảng phiên/PIN và `guests` không có mật khẩu.

## Căn cứ

- QĐ-03 quyết định 3, 4, 5, 8, 10; T2, T3, T4, T7
- [QĐ-02](../../05-ke-hoach/nhat-ky/QD-02-nen-tang-backend.md) mục 3 (sửa §3 + migration tiến trong cùng PR)
- [csdl](../../04-thiet-ke/csdl.md) §3 (`users`, `guests`, `uq_guests_phone`), §3.5, §8; api.md §6.3; NFR-SEC-03

## Tiêu chí nghiệm thu

1. csdl §3 thêm (đặt đúng thứ tự FK, sau `guests`), và migration `0002_auth_sessions` chứa **đúng** phần thêm này:
   - `users`: thêm `must_change_password boolean NOT NULL DEFAULT false`, `password_changed_at timestamptz`.
   - `guest_credentials` (`guest_id` PK → `guests` ON DELETE CASCADE, `password_hash`, `failed_login_count` ≥ 0, `locked_until`, `password_changed_at`, `created_at`/`updated_at`).
   - `auth_sessions` (`id`, `principal_type` IN `USER`/`GUEST`, `user_id` → `users`, `guest_id` → `guests`, CHECK đúng một khoá theo `principal_type`; `surface` IN `OPS_WEB`/`OPS_ANDROID`/`GUEST_WEB`/`GUEST_ANDROID`, CHECK khớp `principal_type`; `family_id`; `token_hash` UNIQUE; `created_at`, `last_seen_at`, `expires_at` > `created_at`; `rotated_at`, `revoked_at`, `revoke_reason`; `ip inet`, `user_agent`). Chỉ mục `(family_id)` và chỉ mục từng phần phiên còn hiệu lực theo `user_id`/`guest_id`.
   - `user_pins` (`user_id` PK → `users` ON DELETE CASCADE, `pin_hash`, `failed_count` ≥ 0, `locked_until`, `set_at`).
   - `pin_grants` (`id`, `token_hash` UNIQUE, `user_id`, `session_id` → `auth_sessions`, `purpose`, `booking_id uuid NULL`, `created_at`, `expires_at` ≤ `created_at + 5 phút` bằng CHECK, `consumed_at`).
   - `guest_password_resets` (`id`, `guest_id`, `token_hash` UNIQUE, `created_at`, `expires_at`, `consumed_at`).
   - Không bảng nào lưu mật khẩu/PIN/token dạng rõ: chỉ cột `*_hash`. Quyền `app_rw` theo khối §3.5 (default privileges đã phủ).
2. `schema.prisma` sinh lại bằng `db pull`; kiểm lệch xanh; test so schema migration ↔ §3 (HB-005) vẫn xanh.
3. Test DB (`tests/database.test.mjs` và test migration): ca âm/dương cho từng CHECK (sai `principal_type`/`surface`, thiếu khoá, `pin_grants` quá 5 phút, `token_hash` trùng, đếm âm).
4. csdl §8.1 ghi migration 0002. `npm run check` + `pnpm run ci` xanh.

## Ngoài phạm vi

- Logic phiên/khoá ở ứng dụng (HB-013 trở đi), seed (HB-018).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `npm run check` · `pnpm test:integration`
