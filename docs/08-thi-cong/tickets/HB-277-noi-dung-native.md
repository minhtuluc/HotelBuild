---
id: HB-277
title: Nội dung trang khách dùng chung web + app — @pinehill/content; app khách có tab Khám phá và 7 màn nội dung native
risk: R1
owner: claude
max_lines: 1500
allow:
  - packages/content/**
  - apps/customer-web/src/content/**
  - apps/customer-web/src/i18n/catalogs/**
  - apps/customer-web/src/**
  - apps/customer-web/test/**
  - apps/customer-web/package.json
  - apps/customer-web/next.config.mjs
  - apps/customer-android/**
  - .env.example
  - docs/07-ban-giao/van-hanh/bien-moi-truong.md
  - pnpm-lock.yaml
  - docs/08-thi-cong/tickets/HB-277-noi-dung-native.md
unlock:
  - docs/08-thi-cong/tickets/HB-277-noi-dung-native.md
---

# HB-277 — Nội dung native cho app khách (dự án con D)

> Đặc tả do Claude soạn ngày 20/11/2026; người dùng đã duyệt chia dự án con: màn native, dùng chung dữ liệu. **Xếp chồng** lên #363 (HB-276).

## Vấn đề

- Web khách có trang ga, hạng phòng, ăn uống, trải nghiệm, giá theo số đêm, đường đến và thư viện ảnh (HB-310…HB-323). App khách không có trang nào trong số này.
- Dữ liệu và câu chữ 6 ngôn ngữ nằm trong `customer-web/src`, nên app không dùng lại được.

## Thay đổi

1. **`packages/content`:**
   - Chuyển nguyên `customer-web/src/content/**` và 6 catalog `i18n/catalogs/*/content.ts` sang (`git mv`, giữ lịch sử).
   - Kiểu `Locale` lấy từ `@pinehill/i18n`.
   - Web chỉ đổi đường dẫn import (37 file), không đổi hành vi.
2. **App khách:**
   - `src/content/text.ts`: `ct()` dịch bằng chính khoá `guest.*` của web theo ngôn ngữ đang chọn.
   - `src/content/photos.ts` + `EXPO_PUBLIC_WEB_ORIGIN`:
     - ảnh lấy bản `-640w.webp` từ `/images/pine-hill/` của web, không đóng gói 8 MB ảnh vào app;
     - tải lỗi hoặc thiếu origin thì ẩn ô, như web.
   - `src/content/parts.tsx`: ảnh có khung "ảnh kẹp", mục, đoạn văn, dòng thông số in trên vé.
   - Tab **Khám phá**: ba bảng ga (ba ga, hạng phòng, trang chuyến đi).
   - **Trang ga:**
     - áp phích, tóm tắt, nút xem phòng trống;
     - bảng ga (độ cao, khí hậu, mùa đẹp);
     - chuyện về ga, chặng đến ga, một ngày tại ga;
     - lịch mùa (tháng theo ngôn ngữ), ảnh, các hạng phòng.
   - **Trang hạng phòng:** "mặt sau vé" in thông số có nguồn, bố cục khoang, ga có hạng này.
   - **Ăn uống:** ba khung giờ trên bảng ga, trạng thái bằng chữ, "Giá đã gồm" trên giấy vé, gợi ý quanh ga.
   - **Trải nghiệm:** theo ga, tháng đẹp hoặc "quanh năm".
   - **Giá theo số đêm:** hệ số theo số đêm và bốn gói giá.
   - **Đường đến:** chặng từng ga, khách quốc tế, cổng e-visa.
   - **Thư viện ảnh:** lọc theo nhóm.
   - Tiêu đề màn: 8 khoá `screen.*` lấy y nguyên câu chữ menu Khám phá của web cho cả 6 ngôn ngữ.
3. **Tài liệu:** `EXPO_PUBLIC_WEB_ORIGIN` ghi vào `.env.example` và `bien-moi-truong.md`.

## Tiêu chí nghiệm thu

1. Test mới đỏ trước khi sửa:
   - `packages/content` (3 test): đủ khoá en; mọi ga/hạng có câu chữ ở 6 ngôn ngữ; ô ảnh tham chiếu có thật.
   - App `test/content.spec.ts` (4 test): `ct()` theo ngôn ngữ; origin web hợp lệ; URL ảnh 640w, mã ô lạ thì không dựng; mã ga → slug.
   - `routes.spec.ts`: mọi route mới có tiêu đề trong catalog.
   - `navigation.spec.ts`: thêm tab Khám phá.
2. App khách: tsc, eslint, vitest (172 test) xanh. Web: tsc xanh, vitest 249 test xanh.
3. Máy thật: **chưa chạy** vì điện thoại rớt USB. Sẽ kiểm khi máy cắm lại, với `adb reverse tcp:3001` cho ảnh từ web dev.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci`
