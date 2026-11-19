---
id: HB-261
title: App vận hành có đường vào cảnh báo quá tải và đổi phòng (SCR-67/SCR-63) từ màn chính
risk: R1
owner: claude
max_lines: 120
allow:
  - apps/operations-android/app/home.tsx
  - apps/operations-android/app/index.tsx
  - apps/operations-android/src/strings.ts
  - apps/operations-android/test/home-nav.spec.ts
  - docs/08-thi-cong/tickets/HB-261-van-hanh-vao-canh-bao.md
unlock:
  - docs/08-thi-cong/tickets/HB-261-van-hanh-vao-canh-bao.md
---

# HB-261 — Đường vào cảnh báo quá tải

> Đặc tả do Claude soạn ngày 19/11/2026 khi rà đủ chức năng app vận hành Android.

## Vấn đề

- SCR-67 (cảnh báo quá tải) và SCR-63 (đổi phòng) đã có route `(f6)/alerts` và `(f6)/relocation` (HB-139).
- Màn chính không có nút nào dẫn tới, nên chỉ mở được bằng deep link; lễ tân và quản lý trên thực tế không dùng được.

## Thay đổi

- Màn chính thêm thẻ "Cảnh báo quá tải & đổi phòng" (`open-alerts`).
- Luồng chính gọi `router.push('/alerts')`; nút Back của Stack quay về màn chính.
- SCR-63 mở từ nút "Xử lý" trong SCR-67 như cũ.

## Tiêu chí nghiệm thu

1. `apps/operations-android/test/home-nav.spec.ts` (đỏ trước khi sửa).
2. Máy thật: từ màn chính mở được danh sách cảnh báo, rồi Back về màn chính. Chưa thử được vì điện thoại mất kết nối adb trong phiên.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci`
