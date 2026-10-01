---
id: HB-028
title: Khách quên mật khẩu qua email (request/confirm, gửi SMTP)
risk: R2
owner: deepseek # giai đoạn B; giai đoạn A do Codex viết test khoá
max_lines: 450
allow:
  - apps/api/src/modules/auth/guest/password-reset/**
  - apps/api/src/infrastructure/mail/**
  - apps/api/src/config/**
  - apps/api/package.json
  - apps/api/test/password-reset/**
  - pnpm-lock.yaml
locked:
  - apps/api/test/password-reset/password-reset.locked.spec.ts
---

# HB-028 — Quên mật khẩu qua email

## Mục tiêu

Khách có email nhận link đặt lại mật khẩu; khách không có email được hướng dẫn liên hệ lễ tân. Không lộ việc SĐT có tài khoản hay không.

## Căn cứ

- [QĐ-03](../../05-ke-hoach/nhat-ky/QD-03-dinh-danh-phien-f1.md) quyết định 10; T7; bảng `guest_password_resets` (HB-010)
- NFR-SEC-03, NFR-SEC-05; Mailpit trong `infra/docker-compose.yml`

## Hai giai đoạn

- **A — Codex** (`lead/HB-028-test-khoa`): `password-reset.locked.spec.ts` dùng Mailpit thật (API `http://127.0.0.1:8025/api/v1`) hoặc cổng mail giả có ghi nhận. Ca: SĐT có tài khoản + email → 202, đúng 1 thư chứa link; SĐT không tồn tại / không có email → **cùng** 202, 0 thư; token dùng hai lần → lần hai `E_AUTH_RESET_TOKEN_INVALID`; quá 30 phút → bị từ chối; đặt lại xong → mọi phiên khách bị thu hồi, đăng nhập bằng mật khẩu mới được; quá 3 yêu cầu/giờ/SĐT → 429; token không có trong log.
- **B — DeepSeek** (`ticket/HB-028-quen-mat-khau`): hiện thực tới khi test khoá xanh.

## Tiêu chí nghiệm thu

1. Cổng `Mailer` + adapter SMTP (`nodemailer`) đọc `SMTP_URL`; link dùng biến `GUEST_WEB_BASE_URL` (thêm vào config, không ghi cứng).
2. Gửi thư **sau** khi commit; lỗi gửi thì log + audit, response vẫn 202.
3. Test khoá xanh; `pnpm run ci` xanh.

## Ngoài phạm vi

- Thông báo qua outbox/worker (module NOTI ở F8), SMS/OTP.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:integration`
