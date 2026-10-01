---
id: HB-024
title: SCR-71 — đăng ký/đăng nhập khách (customer Android)
risk: R1
owner: deepseek
max_lines: 550
allow:
  - apps/customer-android/app/**
  - apps/customer-android/src/**
  - apps/customer-android/test/**
  - apps/customer-android/package.json
  - pnpm-lock.yaml
---

# HB-024 — SCR-71 khách trên Android

## Mục tiêu

Khách đăng ký, đăng nhập, khôi phục phiên và yêu cầu quên mật khẩu trên customer Android, cùng hành vi với HB-023.

## Căn cứ

- [thiết kế màn hình](../../04-thiet-ke/thiet-ke-man-hinh.md) SCR-71, §8.1, §8.3; UC-AUTH-03; BR-CRM-01
- [QĐ-03](../../05-ke-hoach/nhat-ky/QD-03-dinh-danh-phien-f1.md) quyết định 1, 2, 6, 10; T11; hợp đồng HB-011 (`clientSurface: GUEST_ANDROID`)

## Tiêu chí nghiệm thu

1. `expo-secure-store` giữ chỉ refresh token; mở lại app refresh im lặng; refresh 401 → xoá storage, về đăng nhập.
2. Đăng ký/đăng nhập/quên mật khẩu với cùng quy tắc, thông điệp và hướng dẫn "liên hệ lễ tân" như HB-023 mục 2, 3. Đặt lại mật khẩu làm trên web (link trong thư mở trình duyệt) — Android chỉ gửi yêu cầu.
3. Mất mạng → "cần kết nối". Nhãn trợ năng đủ.
4. Test logic (Vitest): storage, refresh, chuẩn hoá SĐT hiển thị, nhánh lỗi 409/401/429. Bundle Hermes build được.
5. `pnpm run ci` xanh. Smoke thiết bị: `BLOCKED` nếu không có emulator.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci`
