---
id: HB-267
title: Chữ thanh trạng thái tối trên hai app Android (giao diện luôn sáng) — hết giờ/pin trắng trên nền sáng
risk: R1
owner: claude
max_lines: 150
allow:
  - packages/ui-native/src/status-bar.ts
  - packages/ui-native/src/index.ts
  - packages/ui-native/test/status-bar.spec.ts
  - apps/customer-android/app/_layout.tsx
  - apps/customer-android/test/routes.spec.ts
  - apps/operations-android/app/_layout.tsx
  - apps/operations-android/test/screen-titles.spec.ts
  - docs/08-thi-cong/tickets/HB-267-chu-thanh-trang-thai.md
unlock:
  - docs/08-thi-cong/tickets/HB-267-chu-thanh-trang-thai.md
---

# HB-267 — Chữ thanh trạng thái

> Đặc tả do Claude soạn ngày 19/11/2026 từ máy thật (OnePlus PLQ110, ColorOS 16). Đây là việc còn mở ở HB-252.

## Vấn đề

- Hai app luôn dùng giao diện sáng, nhưng giờ/pin trên thanh trạng thái màu **trắng** nên gần như không đọc được.
- Edge-to-edge (RN 0.86 / Expo SDK 57) đặt màu chữ theo chế độ sáng/tối của **máy**. Snapshot của task ghi `mUiMode=0x21` (máy để chế độ tối) và `mAppearance=0`.
- Lần đặt `dark-content` lúc mount bị ghi đè ngay sau đó, nên HB-252 thử `<StatusBar>` và `statusBarStyle` của native stack đều không có tác dụng.

## Thay đổi

- `@pinehill/ui-native` thêm `useDarkStatusBar()`: đặt `dark-content` ngay, rồi đặt lại sau 1,5 giây.
- Logic thuần nằm ở `applyDarkStatusBar`, kèm hàm huỷ nhịp đặt lại.
- Layout gốc của cả hai app gọi hook này một lần.

## Tiêu chí nghiệm thu

1. `packages/ui-native/test/status-bar.spec.ts`: đặt ngay, đặt lại sau một nhịp, huỷ được.
2. Test mức mã nguồn ở mỗi app: layout gốc gọi `useDarkStatusBar()`.
3. Máy thật, máy để chế độ tối:
   - Điểm tối nhất trên vùng giờ ở thanh trạng thái là (25, 25, 24) trên nền (251, 250, 247), ở cả hai app.
   - Vẫn giữ màu tối khi mở lại app từ nền và khi chuyển tab.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci`
