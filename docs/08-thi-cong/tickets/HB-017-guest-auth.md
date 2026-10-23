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
  - apps/api/test/guest-auth/guest-controls.spec.ts
  - apps/api/test/guest-auth/guest-data.ts
  - apps/api/test/guest-auth/guest-oracle.fixture.ts
  - apps/api/test/guest-auth/guest-register.spec.ts
  - apps/api/test/guest-auth/guest-sessions.spec.ts
locked_sha:
  - 6d0aec679e773359f1f17f21afbaa03488c1f7c7ff19670e69e2238b20e9948f apps/api/test/guest-auth/guest-controls.spec.ts
  - ad5c5128701b85578d027c036827564e2001a09947fce974263ef5b9bcf1440d apps/api/test/guest-auth/guest-data.ts
  - 27d4e2ee513b58d33d16a1718e59af7837299dee5325088d3cd85934dbf55c55 apps/api/test/guest-auth/guest-oracle.fixture.ts
  - 5bd11df4012bb81e6e283dc4891719aa3310384fec8b6c2b9d841f79c8dbf194 apps/api/test/guest-auth/guest-register.spec.ts
  - dbeff4da31ac891aa584b9b18cef1d8ad3f4f821751ad4860c13770a799da069 apps/api/test/guest-auth/guest-sessions.spec.ts
---

# HB-017 — Guest auth

## Mục tiêu

Khách đăng ký và đăng nhập bằng SĐT + mật khẩu, giữ phiên 7 ngày, bị khoá như nhân viên khi sai 5 lần; không chiếm được hồ sơ khách có sẵn khi chưa chứng minh chủ SĐT.

## Căn cứ

- [QĐ-03](../../05-ke-hoach/nhat-ky/QD-03-dinh-danh-phien-f1.md) quyết định 2, 3, 10; T4, T11
- BR-CRM-01; FR-AUTH-07; UC-AUTH-03; bảng `guests` (`uq_guests_phone`), `guest_credentials`, `auth_sessions`

## Hai giai đoạn

- **A — Codex** (nhánh ứng viên `ticket/HB-017-guest-auth-a`, ghim bởi Opus 23/10): `guest-register.spec.ts`, `guest-sessions.spec.ts`, `guest-controls.spec.ts` + `guest-data.ts`, `guest-oracle.fixture.ts`. Ca: SĐT `0912345678` và `+84912345678` là một khách (chuẩn hoá); SĐT sai mẫu → 422 `E_CRM_PHONE_INVALID`; đăng ký lưu `consent_marketing`/`consent_at`/`consent_version`; SĐT đã có hồ sơ **không** có tài khoản → 409 `E_AUTH_PHONE_REGISTERED`, hồ sơ cũ không bị sửa; SĐT đã có tài khoản → 409 cùng mã; đăng nhập/refresh/khoá 5 lần như nhân viên; khách bị `blacklisted` vẫn đăng nhập được (chặn ở nghiệp vụ đặt phòng, không ở auth); token khách không gọi được route nhân viên (403/404 theo HB-014).
- **B — DeepSeek** (`ticket/HB-017-guest-auth`): hiện thực tới khi test khoá xanh.

## Tiêu chí nghiệm thu

1. Dùng lại dịch vụ băm, phiên, khoá, rate limit của HB-013 — không chép code.
2. Đăng ký tạo `guests` + `guest_credentials` + phiên trong một transaction; audit.
3. Đăng ký và đăng nhập nhận `clientSurface` (`GUEST_WEB` mặc định, `GUEST_ANDROID`) theo HB-012; phiên lưu đúng `surface`.
4. Test khoá xanh; `pnpm run ci` xanh.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:integration`
