---
id: HB-311
title: Đợt 4 frontend — nhân trang nội dung lên 3 trang ga + 5 trang hạng, khớp cơ sở theo slug (TD-82 phần frontend)
risk: R1
owner: claude
max_lines: 2500
allow:
  - apps/customer-web/src/**
  - apps/customer-web/test/**
  - tests/e2e/scr80-trang-noi-dung.spec.ts
  - tests/e2e/scr85-nhan-trang-ga-va-hang.spec.ts
  - docs/04-thiet-ke/ke-hoach-phat-trien-giao-dien-tiep-theo.md
  - docs/07-ban-giao/no-ky-thuat.md
  - docs/08-thi-cong/tickets/HB-311-nhan-trang-ga-va-hang.md
unlock:
  - docs/08-thi-cong/tickets/HB-311-nhan-trang-ga-va-hang.md
---

# HB-311 — Ba trang ga, năm trang hạng, khớp theo slug

> Đặc tả do frontend lead soạn theo đợt 4 [kế hoạch phát triển giao diện](../../04-thiet-ke/ke-hoach-phat-trien-giao-dien-tiep-theo.md). Dựng trên HB-310 (khuôn trang), HB-313 (sáu ngôn ngữ), HB-318 (khối "Giá đã gồm") và HB-319 (`slug` trong `GET /public/properties`).

## Vấn đề

- Mới có một trang ga (Đà Lạt) và một trang hạng (Deluxe). Phan Thiết, Vũng Tàu, Standard, Superior, Family, Dorm chưa có trang.
- Trang ga và khối tìm phòng khớp cơ sở do API trả bằng chuỗi có trong tên (`apiNameIncludes`). Đổi tên cơ sở ở back-office thì trang ga mất giờ nhận/trả và CTA không chọn sẵn ga (TD-82).

## Thay đổi

1. **Khớp theo `slug`:** bỏ `apiNameIncludes`. Bảng giờ trang ga, `matchPropertyId`, khối tìm phòng (`/?ga=<slug>`) so `slug` chính xác.
2. **Trang ga:** thêm `phan-thiet`, `vung-tau` (khoá trang + câu chữ sáu ngôn ngữ). Thông số ga vẫn lấy từ nội dung trang chủ.
3. **Trang hạng:** thêm STD, SUP, FAM, DOR. Số chỗ ngủ theo BR-PROP-04 (2, 2, 4, 6). Dorm nói rõ giường có rèm, đèn, ổ cắm, tủ khoá, phòng tắm dùng chung, theo `docs/02-nghiep-vu/tien-nghi-trong-gia.md`.
4. **Gói nội dung:** phần trang ga + trang hạng của zh-CN, ja, ko, ru tách sang `locale-packs/<locale>-pages.ts` để mỗi tệp dưới 400 dòng.
5. Nội dung tả nơi chốn vẫn là minh hoạ (`illustrative: true`). Không có giá, diện tích, view hay tiện nghi ngoài điều khoản.

## Tiêu chí nghiệm thu

1. Unit:
   - Đủ năm hạng, số chỗ ngủ đúng BR-PROP-04; ba ga trên tuyến đều có trang.
   - Mọi locale có câu chữ, không có số tiền hay diện tích.
   - Khớp cơ sở theo `slug`; tên chứa chuỗi không còn khớp.
2. E2E `scr85`:
   - Ba trang ga hiện giờ lấy từ API theo `slug`; API giả cố ý đặt tên không chứa tên ga.
   - CTA chọn sẵn đúng cơ sở.
   - Năm trang hạng đúng sức chứa, không giá.
   - Khối "Giá đã gồm" có mục Dorm chỉ ở hạng Dorm.
   - Bản en/ru đúng; axe sạch; 360px không cuộn ngang.
3. `scr80`: hai ca giả định "chỉ có trang mẫu" đổi theo phạm vi mới; ý kiểm giữ nguyên.
4. Toàn bộ E2E customer web, typecheck, lint đạt trên bản build; `impeccable detect` sạch trên trang mới.

## Ngoài phạm vi (HB-322)

- Trang ga sâu hơn (CONT-02: thông số định danh, "Một ngày tại ga", tiện ích dùng chung, lịch mùa).
- Bảng chặng đến ga (UX-05).
- Trang hạng sâu hơn (CONT-01: bố cục khoang, ảnh nhiều góc).
- Trang cấp chuỗi và menu "Khám phá": HB-311b.
