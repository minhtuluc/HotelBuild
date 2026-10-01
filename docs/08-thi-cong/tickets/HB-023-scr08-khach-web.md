---
id: HB-023
title: SCR-08 — đăng ký/đăng nhập/quên mật khẩu khách (customer web)
risk: R1
owner: deepseek
max_lines: 600
allow:
  - apps/customer-web/src/app/(guest)/account/**
  - apps/customer-web/src/app/(guest)/layout.tsx
  - apps/customer-web/src/session/**
  - apps/customer-web/test/account/**
  - tests/e2e/guest-auth.spec.ts
  - tests/e2e/fake-api/guest/**
---

# HB-023 — SCR-08 khách trên web

## Mục tiêu

Khách đăng ký, đăng nhập, đăng xuất, quên/đặt lại mật khẩu trên customer web; khách không có email hoặc SĐT đã có hồ sơ được hướng dẫn liên hệ lễ tân.

## Căn cứ

- [thiết kế màn hình](../../04-thiet-ke/thiet-ke-man-hinh.md) SCR-08, §8.1; UC-AUTH-03; BR-CRM-01; FR-AUTH-07
- [QĐ-03](../../05-ke-hoach/nhat-ky/QD-03-dinh-danh-phien-f1.md) quyết định 2, 3, 10; T7, T11; client phiên HB-019 (`guest`)

## Tiêu chí nghiệm thu

1. Tuyến `/account/register`, `/account/login`, `/account/forgot-password`, `/account/reset-password?token=…`.
2. Đăng ký: họ tên, SĐT (chấp nhận `0…` và `+84…`, hiển thị dạng chuẩn), email tuỳ chọn, mật khẩu ≥ 8, ô đồng ý nhận tiếp thị **không tích sẵn**, gửi `consentVersion`. `E_AUTH_PHONE_REGISTERED` → thông báo "SĐT đã có hồ sơ tại khách sạn, vui lòng liên hệ lễ tân" kèm thông tin liên hệ cấu hình được.
3. Quên mật khẩu: luôn hiện cùng một thông báo sau khi gửi ("nếu SĐT có email đăng ký, bạn sẽ nhận thư"), kèm dòng "không có email? liên hệ lễ tân". Không có OTP.
4. Đặt lại: mật khẩu mới 2 lần khớp; `E_AUTH_RESET_TOKEN_INVALID` → hướng dẫn yêu cầu lại.
5. Đầu trang hiện trạng thái đăng nhập + đăng xuất; không có idle timeout (phiên 7 ngày).
6. E2E với API giả: đăng ký, SĐT đã có hồ sơ, đăng nhập, khoá tài khoản, quên + đặt lại mật khẩu; axe; 360 px.
7. `pnpm run ci` + `pnpm test:e2e` xanh.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:e2e`
