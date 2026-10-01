---
id: HB-015
title: PIN 6 số — đặt, xác thực, pinToken dùng một lần, khoá sau 3 lần sai, xoá PIN
risk: R2
owner: deepseek # giai đoạn B; giai đoạn A do Codex viết test khoá
max_lines: 450
allow:
  - apps/api/src/modules/auth/pin/**
  - apps/api/test/pin/**
locked:
  - apps/api/test/pin/pin.locked.spec.ts
---

# HB-015 — PIN

## Mục tiêu

Nhân viên Android đặt PIN, xác thực PIN để nhận `pinToken` 5 phút dùng một lần cho thao tác tài chính; sai 3 lần thì khoá thao tác cần PIN 15 phút; MANAGER/SYSADMIN xoá PIN để đặt lại.

## Căn cứ

- [QĐ-03](../../05-ke-hoach/nhat-ky/QD-03-dinh-danh-phien-f1.md) quyết định 4, 5; BR-RBAC-05; TC-AUTH-03
- api.md §1.2 (pinToken), §6.3; bảng `user_pins`, `pin_grants` (HB-010)

## Hai giai đoạn

- **A — Codex** (`lead/HB-015-test-khoa`): `pin.locked.spec.ts`. Ca: `PUT /auth/pin` sai `currentPassword` → 401; đặt rồi `pin/verify` đúng → `pinToken` theo schema; dùng `pinToken` hai lần → lần hai bị từ chối; quá 5 phút → bị từ chối; token cấp cho `bookingId` A không dùng được cho B; sai 3 lần → `E_AUTH_PIN_LOCKED`, vẫn gọi được endpoint không cần PIN; mở sau 15 phút; MANAGER cơ sở khác xoá PIN → `E_AUTH_OUT_OF_SCOPE`; MANAGER đúng cơ sở xoá → `hasPin=false`, verify trả `E_AUTH_PIN_REQUIRED`; PIN không xuất hiện trong log/audit.
- **B — DeepSeek** (`ticket/HB-015-pin`): hiện thực tới khi test khoá xanh.

## Tiêu chí nghiệm thu

1. PIN băm Argon2id; `pinToken` 32 byte, DB lưu SHA-256; tiêu thụ token bằng `UPDATE … SET consumed_at WHERE consumed_at IS NULL AND expires_at > now` (một câu, không đua).
2. Hàm `requirePinToken(purpose, bookingId?)` dùng chung cho endpoint 🔒 sau này; có unit test.
3. Đặt/xoá/khoá PIN ghi audit.
4. Test khoá xanh; `pnpm run ci` xanh.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:integration`
