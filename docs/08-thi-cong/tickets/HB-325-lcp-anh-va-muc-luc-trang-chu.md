---
id: HB-325
title: Đo Lighthouse mobile các trang nội dung (LCP < 2,5 s), ảnh nhiều cỡ cho ảnh đầu trang, mục lục bám cuộn trang chủ (UX-06)
risk: R1
owner: claude
max_lines: 1200
allow:
  - apps/customer-web/src/**
  - apps/customer-web/test/**
  - apps/customer-web/public/images/pine-hill/**
  - apps/customer-web/scripts/**
  - apps/customer-web/public/fonts/**
  - apps/customer-web/next.config.mjs
  - packages/web-session/src/**
  - packages/web-session/package.json
  - docs/07-ban-giao/no-ky-thuat.md
  - tests/e2e/scr90-lcp-va-muc-luc-trang-chu.spec.ts
  - docs/04-thiet-ke/ke-hoach-phat-trien-giao-dien-tiep-theo.md
  - docs/04-thiet-ke/do-lighthouse-trang-noi-dung.md
  - docs/04-thiet-ke/anh-trang-khach.md
  - docs/08-thi-cong/tickets/HB-325-lcp-anh-va-muc-luc-trang-chu.md
unlock:
  - docs/08-thi-cong/tickets/HB-325-lcp-anh-va-muc-luc-trang-chu.md
---

# HB-325 — LCP trang nội dung và mục lục trang chủ

> Đặc tả do frontend lead soạn. Chủ dự án giao ngày 16/11/2026. Chồng trên HB-324 (#326).

## Vấn đề

- Tiêu chí nghiệm thu đợt 3 của [kế hoạch](../../04-thiet-ke/ke-hoach-phat-trien-giao-dien-tiep-theo.md) ghi "LCP ảnh đầu trang dưới 2,5 s trên cấu hình Lighthouse mobile" nhưng chưa ai đo.
- Đo thử `/stays/da-lat`: LCP 5,7 s. Phần tử LCP là ảnh áp phích ga: file gốc 1200×1600 khoảng 320 KB, trong khi trên điện thoại chỉ hiện chừng 360 CSS px.
- Mục lục bám cuộn (UX-06) mới có ở trang ga; trang chủ hoãn chờ đo.

## Thay đổi

1. **Đo:** Lighthouse 13 cấu hình mobile mặc định (giả lập thiết bị, mạng 4G chậm, CPU ×4) trên bản `next build`. Mỗi trang đo 3 lần, lấy trung vị. Đo 14 trang: trang chủ, 3 trang ga, 5 trang hạng, `/dining`, `/getting-here`, `/experiences`, `/offers`, `/gallery`.
   - Ghi trước/sau vào `docs/04-thiet-ke/do-lighthouse-trang-noi-dung.md`: LCP, FCP, CLS, TBT, phần tử LCP.
   - Ghi kèm cách chạy lại.
2. **Ảnh nhiều cỡ:**
   - Script `apps/customer-web/scripts/photo-variants.mjs` (`sharp`, đã có trong repo) sinh bản `-640w`, `-960w` cạnh mỗi ảnh gốc trong `public/images/pine-hill/`.
   - Máy chủ chỉ ghép `srcset`/`sizes` khi bản nhỏ có thật trên đĩa; ảnh mới chưa chạy script vẫn hiện bằng ảnh gốc. `src` giữ nguyên ảnh gốc.
   - Áp cho ảnh đầu trang (áp phích ga trên trang ga và trang chủ) và các ô ảnh khác dùng `Photo`.
3. **Sửa thêm** những gì phép đo chỉ ra làm LCP vượt 2,5 s, nếu sửa được trong frontend.
4. **Mục lục bám cuộn trang chủ** (UX-06): dải neo dưới khối tìm phòng. Gồm ba ga, hạng phòng, giá, trả vé, bốn bước, hỏi đáp. Nhãn ngắn, đủ sáu ngôn ngữ; `aria-current` theo mục đang đọc; dùng lại `PageToc` của HB-323.

## Tiêu chí nghiệm thu

1. Trung vị LCP của mọi trang nội dung dưới 2,5 s trên Lighthouse mobile; bảng trước/sau trong tài liệu đo.
2. Unit:
   - `srcset` chỉ gồm bản có thật;
   - mọi ảnh gốc trong `public/images/pine-hill/` có đủ bản nhỏ (script đã chạy);
   - mục lục trang chủ chỉ trỏ tới mục có trên trang.
3. E2E `scr90`:
   - ảnh áp phích ga có `srcset` và trình duyệt điện thoại tải bản nhỏ;
   - mục lục trang chủ có `aria-current` khi cuộn;
   - không cuộn ngang ở 360 px; axe sạch.
4. Toàn bộ E2E customer web, typecheck, lint đạt trên bản build.

## Ngoài phạm vi

- TBT (JS chạy lâu trên CPU chậm): ghi số đo, không đặt ngưỡng ở ticket này.
- Đổi ảnh minh hoạ sang ảnh thật: chờ chủ dự án.
