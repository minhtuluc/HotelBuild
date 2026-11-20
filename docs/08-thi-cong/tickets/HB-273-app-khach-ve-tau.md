---
id: HB-273
title: App khách Android dùng theme "vé tàu" dùng chung — header/tab bảng ga, font thương hiệu, nút cam kết dấu bấm
risk: R1
owner: claude
max_lines: 220
allow:
  - apps/customer-android/src/theme.ts
  - apps/customer-android/app/_layout.tsx
  - apps/customer-android/app/(tabs)/_layout.tsx
  - apps/customer-android/app/(tabs)/search.tsx
  - apps/customer-android/app/booking/confirm.tsx
  - apps/customer-android/test/routes.spec.ts
  - packages/ui-native/src/status-bar.ts
  - packages/ui-native/test/status-bar.spec.ts
  - docs/08-thi-cong/tickets/HB-273-app-khach-ve-tau.md
unlock:
  - docs/08-thi-cong/tickets/HB-273-app-khach-ve-tau.md
---

# HB-273 — App khách theo hệ "vé tàu"

> Đặc tả do Claude soạn ngày 20/11/2026; dự án con A, phần áp vào app khách. Spec: `docs/superpowers/specs/2026-11-20-android-theme-dong-bo-web-design.md`.
> **Xếp chồng** lên #359 (HB-272, `ui-native`) và #353 (HB-267, thanh trạng thái). Gộp hai PR đó trước.

## Thay đổi

1. `src/theme.ts` chỉ còn `createTheme('guest')`. Mọi màn tự đổi sang nền mẫu biểu, thẻ giấy in, font Be Vietnam Pro và Barlow Condensed.
2. Layout gốc:
   - Nạp font thương hiệu (`useBrandFonts`).
   - Thanh trạng thái chữ sáng cho hợp header bảng ga. `useStatusBarStyle` là bản tổng quát của `useDarkStatusBar` (HB-267), giữ nguyên cơ chế đặt lại sau 1,5 giây.
3. Tab bar và header dùng `tabScreenOptions`: nền bảng ga, chữ hổ phách, nhãn chữ hẹp.
4. Nút cam kết dùng dấu bấm đỏ đúng DESIGN.md:
   - "Tìm phòng" dùng `theme.buttonAccent`.
   - "Giữ chỗ & xác nhận" dùng `Button role="accent" size="lg"`.
   - Nút tiện ích (Tra cứu, đăng nhập) giữ mực xanh.

## Tiêu chí nghiệm thu

1. `routes.spec.ts` (đỏ trước khi sửa): layout gọi `useStatusBarStyle('light-content')` và `useBrandFonts()`; `theme.ts` chỉ còn `createTheme('guest')`.
2. `status-bar.spec.ts`: đặt chữ sáng ngay, rồi đặt lại sau một nhịp.
3. App khách: tsc, eslint và vitest (150 test) xanh.
4. Máy thật OnePlus, 20/11, đã chụp các màn tìm phòng, kết quả, chi tiết phòng, xác nhận, đơn của tôi và chi tiết đơn. Kiểm được:
   - Header và tab bảng ga chữ hổ phách; chữ thanh trạng thái sáng.
   - Dấu tiếng Việt hiện đúng với Be Vietnam Pro và Barlow.
   - Nút cam kết đỏ, nút tiện ích xanh.

## Ngoài phạm vi (dự án con B/C)

- Một số ô chữ tự đặt style riêng nên vẫn dùng font hệ thống.
- Câu chữ lộ mã nội bộ ("BR-RATE-17", "chờ ticket hợp đồng").
- "Tiếp tục xác nhận" ở chi tiết phòng đang là link, chưa phải nút cam kết.
- Ngày dạng ISO ở chi tiết phòng.
