---
id: HB-274
title: App vận hành Android dùng theme "vé tàu" dùng chung — header bảng ga, font thương hiệu, nút mực in như operations web
risk: R1
owner: claude
max_lines: 120
allow:
  - apps/operations-android/src/theme.ts
  - apps/operations-android/app/_layout.tsx
  - apps/operations-android/test/screen-titles.spec.ts
  - docs/08-thi-cong/tickets/HB-274-app-van-hanh-ve-tau.md
unlock:
  - docs/08-thi-cong/tickets/HB-274-app-van-hanh-ve-tau.md
---

# HB-274 — App vận hành theo hệ "vé tàu"

> Đặc tả do Claude soạn ngày 20/11/2026; dự án con A, phần áp vào app vận hành. Spec: `docs/superpowers/specs/2026-11-20-android-theme-dong-bo-web-design.md`.
> **Xếp chồng** lên #360 (HB-273). PR đó dùng `useStatusBarStyle` và nằm trên #359 + #353.

## Thay đổi

1. `src/theme.ts` chỉ còn `createTheme('ops')`:
   - nền làm việc #F3F2EE, thẻ giấy in;
   - nút chính mực xanh;
   - tiêu đề chữ thân (quy tắc back-office của DESIGN.md);
   - font Be Vietnam Pro.
2. Layout gốc:
   - nạp font thương hiệu;
   - header bảng ga chữ sáng;
   - thanh trạng thái chữ sáng (`useStatusBarStyle('light-content')`).

## Tiêu chí nghiệm thu

1. `screen-titles.spec.ts` (đỏ trước khi sửa): layout gọi `useStatusBarStyle('light-content')` và `useBrandFonts()`; `theme.ts` chỉ còn `createTheme('ops')`.
2. App vận hành: tsc, eslint và vitest (408 test) xanh.
3. Máy thật (20/11): màn chính và màn khách đến hiện header bảng ga, chữ thanh trạng thái sáng, nút mực xanh, dấu tiếng Việt đúng.

## Ngoài phạm vi (dự án con E)

Bố cục từng màn so với màn web tương ứng; đổi các nút tự dựng sang `Button`.
