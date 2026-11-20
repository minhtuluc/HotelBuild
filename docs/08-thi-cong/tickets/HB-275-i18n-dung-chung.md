---
id: HB-275
title: Ngôn ngữ dùng chung — @pinehill/i18n; app khách Android 6 ngôn ngữ như web khách, có ô chọn ngôn ngữ
risk: R1
owner: claude
max_lines: 3200
allow:
  - packages/i18n/**
  - packages/ui-web/package.json
  - apps/customer-web/src/i18n/locales.ts
  - apps/customer-web/src/i18n/format.ts
  - apps/customer-web/next.config.mjs
  - apps/customer-web/package.json
  - apps/customer-android/**
  - pnpm-lock.yaml
  - docs/08-thi-cong/tickets/HB-275-i18n-dung-chung.md
unlock:
  - docs/08-thi-cong/tickets/HB-275-i18n-dung-chung.md
---

# HB-275 — Ngôn ngữ dùng chung (dự án con B)

> Đặc tả do Claude soạn ngày 20/11/2026. Dự án con B trong yêu cầu "đồng bộ hai app Android với web"; người dùng đã duyệt thiết kế.
> **Xếp chồng** lên #360 (HB-273), #346 (HB-260) và #352 (HB-266), để bản dịch phủ cả khoá của hai PR đó.

## Vấn đề

- Web khách có 6 ngôn ngữ (vi, en, zh-CN, ja, ko, ru; HB-309…HB-313). App khách Android chỉ có tiếng Việt.
- Định dạng tiền và ngày của app viết cứng theo `vi-VN`.
- Vài câu chữ lộ mã nội bộ cho khách ("BR-RATE-17", "engine", "PATCH /guests/me", "HB-079").

## Thay đổi

1. **`packages/i18n`:**
   - `locales.ts` và `format.ts` chuyển nguyên từ `customer-web/src/i18n`; web chỉ còn re-export, không đổi hành vi.
   - Thêm `matchLocale(tag)`: khớp thẻ ngôn ngữ của máy; tiếng Trung phồn thể về tiếng Việt.
   - `ui-web` thêm lối `./format`, để bundle Android không kéo theo component web.
2. **App khách:**
   - `src/i18n/locale.ts`: ngôn ngữ đang dùng. Lần đầu theo máy; lựa chọn đã lưu thắng ngôn ngữ máy; kho lưu lỗi hoặc giá trị lạ thì không chặn app.
   - `t()`, `paymentText()`, `phaseText()` đọc catalog theo ngôn ngữ.
   - 5 catalog dịch (en, zh-CN, ja, ko, ru) cho khoảng 360 câu: app, `stateMessages`, thanh toán, trạng thái thanh toán. Kiểu `Record` nên thiếu khoá thì báo lỗi lúc biên dịch.
   - Layout gốc khôi phục ngôn ngữ trước khi vẽ và vẽ lại cả cây khi đổi.
   - Tab Tài khoản có ô chọn ngôn ngữ: tên ngôn ngữ viết bằng chính nó, không dùng cờ, giống web.
   - Tiền, ngày lịch, giờ VN và số giờ theo ngôn ngữ; tiếng Việt giữ nguyên đầu ra cũ.
   - Bỏ 5 khoá không còn dùng; sửa 4 câu lộ mã nội bộ.

## Tiêu chí nghiệm thu

1. Test mới đỏ trước khi sửa:
   - `packages/i18n` (4 test): khớp ngôn ngữ máy; định dạng vi và en.
   - App khách `test/i18n.spec.ts`:
     - 6 ngôn ngữ đủ đúng bộ khoá, giữ nguyên biến `{...}`, không chuỗi rỗng, không câu nào lộ mã nội bộ;
     - đổi ngôn ngữ thì đổi câu chữ và định dạng;
     - lựa chọn đã lưu thắng ngôn ngữ máy;
     - kho lưu lỗi thì về ngôn ngữ máy.
   - `routes.spec.ts`: layout khôi phục ngôn ngữ và đặt `key={locale}`; tab Tài khoản có ô chọn ngôn ngữ.
2. App khách: tsc, eslint, vitest (162 test) xanh. Customer web: tsc xanh, vitest 249 test xanh.
3. Máy thật: **chưa chạy** vì điện thoại rớt USB giữa phiên. Sẽ kiểm khi máy cắm lại: đổi sang English/日本語 ở tab Tài khoản, mở lại app vẫn giữ ngôn ngữ.

## Ghi chú

Bản dịch zh/ja/ko/ru do Claude soạn; nên có người bản ngữ đọc lại trước khi phát hành, như HB-313 của web.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci`
