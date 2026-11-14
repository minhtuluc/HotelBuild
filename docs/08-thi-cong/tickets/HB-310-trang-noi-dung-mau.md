---
id: HB-310
title: Đợt 3 frontend — trang nội dung mẫu /stays/da-lat (tờ giới thiệu ga) và /room-types/DLX (hạng khoang), gallery có lightbox, cuống vé dính đáy, metadata
risk: R1
owner: claude
max_lines: 2500
allow:
  - apps/customer-web/src/**
  - apps/customer-web/test/**
  - tests/e2e/scr80-trang-noi-dung.spec.ts
  - DESIGN.md
  - docs/04-thiet-ke/ke-hoach-phat-trien-giao-dien-tiep-theo.md
  - docs/07-ban-giao/no-ky-thuat.md
  - docs/08-thi-cong/tickets/HB-310-trang-noi-dung-mau.md
unlock:
  - docs/08-thi-cong/tickets/HB-310-trang-noi-dung-mau.md
---

# HB-310 — Đợt 3 frontend: trang nội dung mẫu

> Đặc tả do frontend lead soạn theo [kế hoạch phát triển giao diện](../../04-thiet-ke/ke-hoach-phat-trien-giao-dien-tiep-theo.md) (đợt 3) và §3–§7 [kế hoạch nội dung tĩnh](../../04-thiet-ke/ke-hoach-noi-dung-web-tinh.md). Thiết kế theo mục "Content Pages (HB-310)" trong [DESIGN.md](../../../DESIGN.md). Chồng trên HB-309 (dùng `src/i18n/`).

## Vấn đề

- Trang khách chỉ có trang chủ và luồng đặt phòng. Khách muốn tìm hiểu một cơ sở hay một hạng phòng trước khi chọn ngày thì không có trang nào để đọc hoặc chia sẻ.
- Đợt 3 làm **một** trang mỗi loại để chốt khuôn trang, component và cách nối vào luồng đặt phòng. Đợt 4 (HB-311) nhân ra cho đủ.

## Thay đổi

1. **Nội dung** (`src/content/`):
   - `property-pages.ts` (Đà Lạt) và `room-type-pages.ts` (DLX), theo locale, chỉ `vi`.
   - Thông số lấy từ nội dung trang chủ và dữ liệu seed: tên ga, độ cao, khí hậu, sức chứa, số chỗ ngủ, có ở ga nào.
   - Không có diện tích, view, tiện nghi, giá hay giải thưởng.
   - Nội dung tả nơi chốn đánh dấu `illustrative: true` trong dữ liệu; trang không hiện nhãn (quyết định Q1).
2. **`/stays/[slug]`** — tờ giới thiệu ga:
   - Đầu trang: đường dẫn, mã ga, `h1`, tóm tắt, áp phích (ảnh LCP).
   - Bảng giờ nhận/trả phòng lấy từ `GET /public/properties`, khớp cơ sở theo tên ga vì API công khai chưa có slug (ghi nợ kỹ thuật).
   - Sơ đồ tuyến đánh dấu ga đang xem.
   - Thân trang: đoạn kể, "Đến ga", gallery, các hạng phòng ở ga.
3. **`/room-types/[code]`** — hạng khoang:
   - Đầu trang: tem mã hạng, `h1`, tóm tắt.
   - "Mặt sau vé": các thông số có nguồn.
   - Có ở ga, gallery, các hạng khác.
4. **Component** (`src/components/content/`):
   - `Breadcrumbs`, `GalleryGrid` với lightbox `<dialog>` dùng được bằng bàn phím, `StickyBookingStub` (dưới 760 px).
   - `RouteMap` tách khỏi trang chủ để dùng chung.
   - `JsonLd`.
5. **Nối vào luồng đặt phòng:**
   - CTA "Xem phòng trống" về `/?ga={slug}#search-block`.
   - Khối tìm phòng chọn sẵn cơ sở khớp ga; không khớp thì giữ mặc định.
   - Không tự bịa ngày, tồn hay giá.
6. **Metadata:**
   - `title`, `description`, canonical, Open Graph (ảnh áp phích/hạng).
   - JSON-LD `Hotel` / `HotelRoom` + `BreadcrumbList`.
   - `metadataBase` lấy từ origin công khai của app (`SESSION_APP_ORIGIN`).
7. **Liên kết vào trang mới:**
   - Ga Đà Lạt trên trang chủ có link "Đọc thêm về ga".
   - Hạng DLX ở dải hạng phòng có link sang trang hạng.
   - Ga và hạng chưa có trang thì không có link.

## Tiêu chí nghiệm thu

1. Unit test `test/content/content-pages.spec.ts`:
   - Mọi trang có nội dung đủ locale.
   - `galleryIds` trỏ tới ô ảnh có thật.
   - Hạng phòng nổi bật tồn tại.
   - Cơ sở khớp theo tên.
   - CTA mang đúng slug.
2. E2E `tests/e2e/scr80-trang-noi-dung.spec.ts`:
   - Trang ga: `h1`, giờ nhận/trả phòng từ API, `aria-current` trên sơ đồ tuyến.
   - Lightbox mở bằng Enter, đổi ảnh bằng phím ←/→, Esc đóng và trả tiêu điểm.
   - CTA về trang chủ chọn sẵn ga.
   - Trang hạng: thông số, có ở ga.
   - 360 px không cuộn ngang, cuống vé dính không che nội dung cuối.
   - axe không có lỗi serious/critical.
   - Slug không có trả 404.
3. Typecheck, lint (`complexity`, `max-lines`) đạt; không có cast `as` mới; `impeccable detect` không có lỗi.
4. Không có giá, tồn, mốc huỷ cố định hay quy tắc nghiệp vụ mới ở frontend.

## Ngoài phạm vi

- Hai ga còn lại, bốn hạng còn lại, năm trang cấp chuỗi (HB-311).
- Slug cơ sở trong API công khai (ghi nợ kỹ thuật).
- Giữ ngữ cảnh ngày từ trang nội dung sang SCR-03 (khi trang nội dung có ô ngày, đợt 4).
