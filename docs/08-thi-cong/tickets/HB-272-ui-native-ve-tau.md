---
id: HB-272
title: ui-native theo hệ thiết kế "vé tàu" của web — token, font thương hiệu, thành phần dùng chung, createTheme
risk: R1
owner: claude
max_lines: 1450
allow:
  - packages/ui-native/**
  - pnpm-lock.yaml
  - docs/superpowers/specs/2026-11-20-android-theme-dong-bo-web-design.md
  - docs/superpowers/plans/2026-11-20-android-theme-ve-tau.md
  - docs/08-thi-cong/tickets/HB-272-ui-native-ve-tau.md
unlock:
  - docs/08-thi-cong/tickets/HB-272-ui-native-ve-tau.md
---

# HB-272 — Nền giao diện "vé tàu" cho Android

> Đặc tả do Claude soạn ngày 20/11/2026; dự án con A trong yêu cầu "đồng bộ hai app Android với web".
> Spec: `docs/superpowers/specs/2026-11-20-android-theme-dong-bo-web-design.md`. Kế hoạch: `docs/superpowers/plans/2026-11-20-android-theme-ve-tau.md`.

## Vấn đề

Web đã có hệ thiết kế "vé tàu" (DESIGN.md, ADR-019): ba vật liệu giấy vé hồng, bảng ga đen chữ hổ phách và nền mẫu biểu; font Be Vietnam Pro và Barlow Condensed; bốn vai nút. Hai app Android mới chỉ có màu cơ bản; giao diện vẫn là thẻ trắng, font hệ thống, và hai file `theme.ts` giống hệt nhau.

## Thay đổi

1. **Token:**
   - Thêm `worldInk` (sao y web).
   - `radius` đổi theo web (3/6/10).
   - Thêm kiểu chữ `label` (12sp, sàn của native) và `board`.
   - Thêm `fontFamily`, mỗi độ đậm một họ chữ vì Android không tổng hợp `fontWeight` cho font tự nạp.
2. **Font (lối riêng `@pinehill/ui-native/fonts`):**
   - `fontAssets` và `useBrandFonts()` qua `expo-font`. `expo-font` đã autolink trong gói `expo`, nên không phải build lại dev client.
   - Hai gói `@expo-google-fonts` (giấy phép OFL) được nhập theo từng độ đậm, chỉ đóng gói 6 tệp.
   - Không export từ `index`, vì `.ttf` làm hỏng vitest chạy trong node.
3. **Thành phần:**
   - `Button` (vai `accent`/`primary`/`outline`/`danger`, cỡ 48/56dp; khi không bấm được thì đổi màu nền, không dùng opacity).
   - `Paper`, `Ticket` (kèm ngữ cảnh Ticket Ink), `Board`/`BoardRow`, `Field`, `Money`, `StatusBadge`, `ScreenTitle`, `Step`.
   - Style là các hàm thuần trong `components/styles.ts`, test được trong node.
4. **`createTheme('guest' | 'ops')`:**
   - Giữ đủ khoá cũ của `theme.ts` hai app, thêm `ticket`, `label`, `board`.
   - Kèm `stackScreenOptions` và `tabScreenOptions` cho header/tab bảng ga.

Hai app chưa đổi trong PR này; HB-273 và HB-274 áp theme vào từng app.

## Tiêu chí nghiệm thu

1. Test mới đỏ trước khi sửa, xanh sau khi sửa (30 test của package):
   - `tokens-ve-tau.spec.ts`: màu và bo góc trùng web, họ chữ.
   - `components-style.spec.ts`: vai, cỡ, trạng thái không bấm được (không opacity), nhấn, Ticket Ink, bảng ga, ô nhập, tương phản AA.
   - `theme.spec.ts`: hai mặt cùng tập khoá và bao khoá cũ; màu theo mặt; không đặt `fontWeight`.
2. `tsc` và `eslint` của `packages/ui-native` xanh.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci`
