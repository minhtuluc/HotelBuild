---
id: HB-017
title: Guest auth — đăng ký/đăng nhập/refresh theo SĐT chuẩn hoá, consent, khoá tài khoản
risk: R2
owner: deepseek # giai đoạn B; giai đoạn A do Codex viết test khoá
max_lines: 450
allow:
  - apps/api/src/modules/auth/guest/**
  - apps/api/test/guest-auth/**
locked:
  - apps/api/test/guest-auth/guest-auth.locked.spec.ts
---

# HB-017 — Guest auth

## Mục tiêu

Khách đăng ký và đăng nhập bằng SĐT + mật khẩu, giữ phiên 7 ngày, bị khoá như nhân viên khi sai 5 lần; không chiếm được hồ sơ khách có sẵn khi chưa chứng minh chủ SĐT.

## Căn cứ

- [QĐ-03](../../05-ke-hoach/nhat-ky/QD-03-dinh-danh-phien-f1.md) quyết định 2, 3, 10; T4, T11
- BR-CRM-01; FR-AUTH-07; UC-AUTH-03; bảng `guests` (`uq_guests_phone`), `guest_credentials`, `auth_sessions`

## Hai giai đoạn

- **A — Codex** (`lead/HB-017-test-khoa`): `guest-auth.locked.spec.ts`. Ca: SĐT `0912345678` và `+84912345678` là một khách (chuẩn hoá); SĐT sai mẫu → 422 `E_CRM_PHONE_INVALID`; đăng ký lưu `consent_marketing`/`consent_at`/`consent_version`; SĐT đã có hồ sơ **không** có tài khoản → 409 `E_AUTH_PHONE_REGISTERED`, hồ sơ cũ không bị sửa; SĐT đã có tài khoản → 409 cùng mã; đăng nhập/refresh/khoá 5 lần như nhân viên; khách bị `blacklisted` vẫn đăng nhập được (chặn ở nghiệp vụ đặt phòng, không ở auth); token khách không gọi được route nhân viên (403/404 theo HB-014).
- **B — DeepSeek** (`ticket/HB-017-guest-auth`): hiện thực tới khi test khoá xanh.

## Tiêu chí nghiệm thu

1. Dùng lại dịch vụ băm, phiên, khoá, rate limit của HB-013 — không chép code.
2. Đăng ký tạo `guests` + `guest_credentials` + phiên trong một transaction; audit.
3. Test khoá xanh; `pnpm run ci` xanh.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:integration`
