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
  - apps/api/test/password-reset/reset-confirm.spec.ts
  - apps/api/test/password-reset/reset-controls.spec.ts
  - apps/api/test/password-reset/reset-data.ts
  - apps/api/test/password-reset/reset-mail.ts
  - apps/api/test/password-reset/reset-oracle.fixture.ts
  - apps/api/test/password-reset/reset-request.spec.ts
locked_sha:
  - a97efee4b82b65a8c4a011971adf1cb0e202fbddb8ab8b695afe7fc1af03c3fc apps/api/test/password-reset/reset-confirm.spec.ts
  - 2f91a6e2108636a7458a7905ea2e652502cb5e94b11a3c99fe99e3e1980b4c0b apps/api/test/password-reset/reset-controls.spec.ts
  - 8fd072ffc775970e6ff832563136835bd19e58866e7fe6fcfe3d720a613bc005 apps/api/test/password-reset/reset-data.ts
  - 40c0667a2a1e5518e2f13a570dc75f915e19f4d25405aa46511ad799e5410944 apps/api/test/password-reset/reset-mail.ts
  - bffde9298e6d9977bd71241f4ac38c9cc7a3c1adf009c237e9531175dbef9a00 apps/api/test/password-reset/reset-oracle.fixture.ts
  - e71c8d15ae4ceb70a8e2d921d3bea9bb3804b92e583a271c6ef223e909f782dc apps/api/test/password-reset/reset-request.spec.ts
---

# HB-028 — Quên mật khẩu qua email

## Mục tiêu

Khách có email nhận link đặt lại mật khẩu; khách không có email được hướng dẫn liên hệ lễ tân. Không lộ việc SĐT có tài khoản hay không.

## Căn cứ

- [QĐ-03](../../05-ke-hoach/nhat-ky/QD-03-dinh-danh-phien-f1.md) quyết định 10; T7; bảng `guest_password_resets` (HB-010)
- NFR-SEC-03, NFR-SEC-05; Mailpit trong `infra/docker-compose.yml`

## Hai giai đoạn

- **A — Codex** (nhánh ứng viên `ticket/HB-028-quen-mat-khau-a`, ghim bởi Opus 23/10; **ghim lại `reset-request.spec.ts` 24/10** — xem ghi chú cuối mục): `reset-request.spec.ts`, `reset-confirm.spec.ts`, `reset-controls.spec.ts` + `reset-data.ts`, `reset-mail.ts`, `reset-oracle.fixture.ts` dùng Mailpit thật (API `http://127.0.0.1:8025/api/v1`) hoặc cổng mail giả có ghi nhận. Ca: SĐT có tài khoản + email → 202, đúng 1 thư chứa link; SĐT không tồn tại / không có email → **cùng** 202, 0 thư; token dùng hai lần → lần hai `E_AUTH_RESET_TOKEN_INVALID`; quá 30 phút → bị từ chối; đặt lại xong → mọi phiên khách bị thu hồi, đăng nhập bằng mật khẩu mới được; quá 3 yêu cầu/giờ/SĐT → 429; token không có trong log.
- **B — DeepSeek** (`ticket/HB-028-quen-mat-khau`): hiện thực tới khi test khoá xanh.

> **Ghim lại oracle 24/10 (Opus, QĐ-07 mục 6).** Ba ca khoá ngầm buộc việc gửi thư phải **chặn** phản hồi (đọc `audit_logs`/`mailCount` ngay sau phản hồi), nên khi thư gửi **sau** phản hồi chúng phải **đợi có giới hạn** cho hiệu ứng phụ của chính mình: *(a)* ca `request cannot alter existing guest credential or active sessions` đợi thư của mình (`tokenFromMail`) trước khi kết thúc — nếu không thư còn bay sẽ rơi vào ca sau; *(b)* ca `real SMTP refusal…` đợi tới khi hàng `audit_logs` **là** lỗi gửi. **Mọi điều được khẳng định giữ nguyên** (202, token đã commit, không thư cho SĐT lạ/không email/hỏng giao dịch, audit + log gửi lỗi, mức ≥ 40); chỉ bỏ yêu cầu **ngầm** về thời điểm. Năm tệp khoá còn lại giữ nguyên hash.

## Tiêu chí nghiệm thu

1. Cổng `Mailer` + adapter SMTP (`nodemailer`) đọc `SMTP_URL`; link dùng biến `GUEST_WEB_BASE_URL` (thêm vào config, không ghi cứng).
2. Gửi thư **sau** khi commit; lỗi gửi thì log + audit, response vẫn 202.
3. Test khoá xanh; `pnpm run ci` xanh.

## Ngoài phạm vi

- Thông báo qua outbox/worker (module NOTI ở F8), SMS/OTP.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:integration`
