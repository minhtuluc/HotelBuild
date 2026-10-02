---
id: HB-022
title: SCR-56 — đăng nhập + đặt/nhập PIN + secure storage (operations Android)
risk: R1
owner: deepseek
max_lines: 900 # login + đổi mật khẩu + đặt PIN + màn chính + session/storage; lead nâng từ 600 (PR #22)
allow:
  - apps/operations-android/app/**
  - apps/operations-android/src/**
  - apps/operations-android/test/**
  - apps/operations-android/package.json
  - pnpm-lock.yaml
---

# HB-022 — SCR-56 Android vận hành

## Mục tiêu

Nhân viên đăng nhập trên Android, giữ phiên 7 ngày trong secure storage, đặt PIN lần đầu, mở khoá thao tác cần PIN; mất mạng thì báo cần kết nối.

## Căn cứ

- [thiết kế màn hình](../../04-thiet-ke/thiet-ke-man-hinh.md) SCR-56, §8.1, §8.3; UC-AUTH-01; BR-RBAC-05; TC-AUTH-03
- [QĐ-03](../../05-ke-hoach/nhat-ky/QD-03-dinh-danh-phien-f1.md) quyết định 1, 4, 5, 6, 9; hợp đồng HB-011 (`clientSurface: OPS_ANDROID`, `PUT /auth/pin`, `pin/verify`)

## Tiêu chí nghiệm thu

1. `expo-secure-store` giữ **chỉ** refresh token; access token và `pinToken` chỉ trong bộ nhớ. Mô-đun lưu trữ trong `src/storage/` có interface để test bằng bộ nhớ giả.
2. Luồng: đăng nhập → (đổi mật khẩu nếu `mustChangePassword`) → chưa có PIN thì đặt PIN 2 lần khớp → chọn cơ sở nếu nhiều → màn chính. Mở lại app: refresh im lặng; refresh 401 → về đăng nhập, xoá secure storage.
3. Hàm `withPin(purpose, bookingId?)` hiện bàn phím PIN, gọi `pin/verify`, trả `pinToken` cho `api-client`; `E_AUTH_PIN_LOCKED` hiện thời gian chờ; demo bằng một nút "thử thao tác cần PIN" trên màn chính (gọi endpoint giả trong test).
4. Mất mạng (NetInfo): màn đăng nhập/PIN hiện "cần kết nối", không gửi request.
5. Nút/ô nhập có nhãn trợ năng; PIN che ký tự.
6. Test logic (Vitest như hiện có): lưu/xoá storage, chuỗi refresh, đặt PIN, khoá PIN, offline. Bundle Hermes build được.
7. `pnpm run ci` xanh. Smoke trên thiết bị: ghi `BLOCKED` nếu môi trường không có emulator (như F0), không tự nhận đạt.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci`
